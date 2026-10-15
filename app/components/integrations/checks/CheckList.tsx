"use client";

/**
 * The check screens every integration shares (extracted from the AWS page):
 * "Fix this week", checks grouped by area, each check's resources with
 * "Out of scope…", the accepted list, and the fix in Terraform / CLI / console.
 * Provider-agnostic: a check is a CheckDef + CheckOutcome, and the fix template
 * is filled from `vars` ({org}, {repo}, {account}, {project}…) plus the resource.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Copy, CircleDollarSign } from "lucide-react";
import { createCheckException, deleteCheckException } from "@/app/actions/check-exceptions";
import { fillFix, nativeId, type CheckDef, type CheckOutcome, type CheckResource } from "@/lib/checks-core";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const NETWORK = "Network problem — check your connection and try again.";
export const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export interface ExceptionLike {
  id: string;
  checkKey: string;
  resourceId: string;
  reason: string;
}

export function resultBadge(r: CheckOutcome["result"] | undefined): { variant: BadgeVariant; label: string } {
  if (r === "pass") return { variant: "success", label: "Pass" };
  if (r === "fail") return { variant: "critical", label: "Fail" };
  return { variant: "neutral", label: r ? "Can't tell" : "Not run yet" };
}

export function CopyBlock({ text }: { text: string }) {
  const toast = useToast();
  return (
    <div className="relative">
      <pre className="overflow-auto rounded-md border border-border bg-secondary/50 p-3 text-[11px] leading-relaxed">{text}</pre>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(text).then(() => toast("success", "Copied"))}
        className="absolute right-2 top-2 rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
        title="Copy"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function FixTabs({ def, res, vars }: { def: CheckDef; res: CheckResource | null; vars: Record<string, string | null | undefined> }) {
  const tabs = (["terraform", "cli", "console"] as const).filter((t) => def.fix[t]);
  const [tab, setTab] = useState(tabs[0]);
  const text = fillFix(def.fix[tab]!, { ...vars, id: res ? nativeId(res.id) : vars.id, region: res?.region ?? vars.region });
  return (
    <div className="space-y-2">
      {tabs.length > 1 && (
        <SegmentedControl
          options={tabs.map((t) => ({ value: t, label: t === "cli" ? "CLI" : t === "terraform" ? "Terraform" : "Console" }))}
          value={tab}
          onChange={setTab}
        />
      )}
      {tab === "console" ? <p className="text-sm text-muted-foreground">{text}</p> : <CopyBlock text={text} />}
      {def.fix.cost && <p className="text-xs text-muted-foreground">Cost of the fix: {def.fix.cost}</p>}
    </div>
  );
}

export function ExceptionForm({ def, res, onDone }: { def: CheckDef; res: CheckResource; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("90");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const expiresAt = days === "never" ? null : new Date(Date.now() + Number(days) * 86_400_000).toISOString();
    const r = await createCheckException({ checkKey: def.key, resourceId: res.id, label: res.label, reason, expiresAt }).catch(() => ({ error: NETWORK }));
    setBusy(false);
    if ("error" in r && r.error) return toast("error", r.error);
    toast("success", "Recorded — it counts as accepted from the next scan");
    onDone();
  }
  return (
    <form onSubmit={save} className="mt-2 space-y-2 rounded-md border border-border p-3">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        minLength={5}
        rows={2}
        placeholder="Why this is fine — an auditor will read this"
        className="input text-sm"
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Review again in</span>
        <select value={days} onChange={(e) => setDays(e.target.value)} className="input w-auto py-1">
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">a year</option>
          <option value="never">never</option>
        </select>
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Mark out of scope"}</Button>
        <button type="button" className="text-xs text-muted-foreground underline" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function CheckPanel({
  def,
  result,
  vars,
  exceptions,
  canWrite,
  extra,
}: {
  def: CheckDef;
  result: CheckOutcome;
  vars: Record<string, string | null | undefined>;
  exceptions: ExceptionLike[];
  canWrite: boolean;
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [excepting, setExcepting] = useState<string | null>(null);
  const exceptionFor = (resId: string) => exceptions.find((e) => e.checkKey === def.key && e.resourceId === resId);

  async function removeException(id: string) {
    const r = await deleteCheckException(id).catch(() => ({ error: NETWORK }));
    if ("error" in r && r.error) return toast("error", r.error);
    toast("success", "Removed — it counts again from the next scan");
    router.refresh();
  }

  return (
    <div className="space-y-3 border-l-2 border-border pl-4 text-sm">
      <p className="text-muted-foreground">{def.why}</p>
      {result.resources.length > 0 && (
        <div>
          <div className="text-xs font-semibold">
            {result.failingCount > result.resources.length ? `First ${result.resources.length} of ${result.failingCount}` : "Affected"}
          </div>
          <ul className="mt-1 space-y-1">
            {result.resources.map((res) => (
              <li key={res.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{res.label}</span>
                  {res.region && <span className="text-xs text-muted-foreground">{res.region}</span>}
                  {canWrite && excepting !== res.id && (
                    <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setExcepting(res.id)}>
                      Out of scope…
                    </button>
                  )}
                </div>
                {excepting === res.id && <ExceptionForm def={def} res={res} onDone={() => { setExcepting(null); router.refresh(); }} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.accepted.length > 0 && (
        <div>
          <div className="text-xs font-semibold">Accepted as out of scope</div>
          <ul className="mt-1 space-y-1">
            {result.accepted.map((res) => {
              const exc = exceptionFor(res.id);
              return (
                <li key={res.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono">{res.label}</span>
                  <span className="text-muted-foreground">— {res.reason}</span>
                  {exc && canWrite && (
                    <button type="button" className="text-muted-foreground underline" onClick={() => removeException(exc.id)}>
                      remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {result.result !== "pass" && <FixTabs def={def} res={result.resources[0] ?? null} vars={vars} />}
      {extra}
      <p className="text-[11px] text-muted-foreground">Reads: {def.apiCalls.join(", ")}</p>
    </div>
  );
}

export function CheckRow(props: {
  def: CheckDef;
  result: CheckOutcome;
  vars: Record<string, string | null | undefined>;
  exceptions: ExceptionLike[];
  canWrite: boolean;
  open: boolean;
  onToggle: () => void;
  extra?: React.ReactNode;
}) {
  const { def, result, open, onToggle } = props;
  const b = resultBadge(result.result);
  return (
    <li id={`check-${def.key}`} className="py-2">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2 text-left">
        {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{def.title}</span>
            <Badge variant={b.variant}>{b.label}</Badge>
            {result.costPerMonth ? (
              <Badge variant="warning" icon={<CircleDollarSign className="h-3 w-3" />}>≈ ${result.costPerMonth}/mo</Badge>
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{result.detail}</span>
        </span>
      </button>
      {open && (
        <div className="mt-2 pl-6">
          <CheckPanel {...props} />
        </div>
      )}
    </li>
  );
}

/**
 * The whole posture view for one provider: Fix this week, then every gating check
 * grouped by area, then the informational ones.
 */
export function PostureChecks({
  catalog,
  areas,
  results,
  vars,
  exceptions,
  canWrite,
  emptyText = "Nothing failing. 🎉",
  extraFor,
}: {
  catalog: CheckDef[];
  areas: { area: string; title: string }[];
  results: CheckOutcome[];
  vars: Record<string, string | null | undefined>;
  exceptions: ExceptionLike[];
  canWrite: boolean;
  emptyText?: string;
  /** Extra content inside a check's panel (e.g. "Create a ticket"). */
  extraFor?: (def: CheckDef, result: CheckOutcome) => React.ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(results.map((r) => [r.key, r])), [results]);
  const thisWeek = useMemo(
    () =>
      catalog
        .filter((d) => !d.informational && byKey.get(d.key)?.result === "fail")
        .map((d) => ({ d, r: byKey.get(d.key)! }))
        .sort((a, b) => SEVERITY_RANK[a.d.severity] - SEVERITY_RANK[b.d.severity] || b.r.failingCount - a.r.failingCount)
        .slice(0, 5),
    [catalog, byKey],
  );
  function jump(key: string) {
    setOpen(key);
    requestAnimationFrame(() => document.getElementById(`check-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  const row = (d: CheckDef) => (
    <CheckRow
      key={d.key}
      def={d}
      result={byKey.get(d.key)!}
      vars={vars}
      exceptions={exceptions}
      canWrite={canWrite}
      open={open === d.key}
      onToggle={() => setOpen(open === d.key ? null : d.key)}
      extra={extraFor?.(d, byKey.get(d.key)!)}
    />
  );
  const informational = catalog.filter((d) => d.informational && byKey.has(d.key));

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Fix this week</h2>
        {thisWeek.length ? (
          <ol className="space-y-2">
            {thisWeek.map(({ d, r }, i) => (
              <li key={d.key} className="card flex flex-wrap items-center gap-3 py-3">
                <span className="text-lg font-semibold text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{d.title}</span>
                    <Badge variant={d.severity === "high" ? "critical" : d.severity === "medium" ? "high" : "neutral"}>{d.severity}</Badge>
                    {r.costPerMonth ? <Badge variant="warning">≈ ${r.costPerMonth}/mo</Badge> : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.resources[0]?.label}
                    {r.failingCount > 1 ? ` and ${r.failingCount - 1} more` : ""}
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => jump(d.key)}>Show the fix</Button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="card text-sm text-muted-foreground">{emptyText}</p>
        )}
      </section>

      {areas.map(({ area, title }) => {
        const defs = catalog.filter((d) => d.area === area && !d.informational && byKey.has(d.key));
        if (!defs.length) return null;
        const failing = defs.filter((d) => byKey.get(d.key)?.result === "fail").length;
        return (
          <section key={area} className="card space-y-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              {title}
              <span className="text-xs font-normal text-muted-foreground">
                {failing ? `${failing} of ${defs.length} failing` : `${defs.length} ${defs.length === 1 ? "check" : "checks"}`}
              </span>
            </h2>
            <ul className="divide-y divide-border">{defs.map(row)}</ul>
          </section>
        );
      })}

      {informational.length > 0 && (
        <section className="card space-y-1">
          <h2 className="text-sm font-semibold">
            Good to know <span className="text-xs font-normal text-muted-foreground">never raises an alert or holds back a framework</span>
          </h2>
          <ul className="divide-y divide-border">{informational.map(row)}</ul>
        </section>
      )}
    </div>
  );
}
