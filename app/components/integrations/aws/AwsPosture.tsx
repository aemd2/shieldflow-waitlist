"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, RefreshCw, Copy, CircleDollarSign } from "lucide-react";
import { syncAWS, updateAwsAccount, updateAwsSettings, removeAwsAccount } from "@/app/actions/aws";
import { createCheckException, deleteCheckException } from "@/app/actions/check-exceptions";
import { AWS_CHECKS, AWS_CHECK_BY_KEY, fillFix, type AwsCheckDef } from "@/lib/aws/catalog";
import type { AwsCheckResult, AwsResource, CheckArea } from "@/lib/aws/types";
import type { AwsView, AwsAccountView, CheckExceptionView } from "@/lib/aws/view";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AwsConnect } from "@/components/integrations/aws/AwsConnect";

const NETWORK = "Network problem — check your connection and try again.";

const AREAS: { area: CheckArea; title: string }[] = [
  { area: "identity", title: "Identity & access" },
  { area: "exposure", title: "Internet exposure" },
  { area: "logging", title: "Audit logging" },
  { area: "detection", title: "Threat detection" },
  { area: "encryption", title: "Encryption at rest" },
  { area: "patching", title: "Patching & support" },
  { area: "vulnerabilities", title: "Vulnerabilities" },
  { area: "backups", title: "Backups" },
  { area: "residency", title: "Data residency" },
];

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

function resultBadge(r: AwsCheckResult["result"]): { variant: BadgeVariant; label: string } {
  if (r === "pass") return { variant: "success", label: "Pass" };
  if (r === "fail") return { variant: "critical", label: "Fail" };
  return { variant: "neutral", label: "Can't tell" };
}

/** The resource's own id inside our account-qualified one: "acct:region:type/ID" → "ID". */
function nativeId(res: AwsResource): string {
  return res.id.slice(res.id.indexOf("/") + 1).replace(/#\d+$/, "");
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function CopyBlock({ text }: { text: string }) {
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

function FixTabs({ def, res, accountId }: { def: AwsCheckDef; res: AwsResource | null; accountId: string }) {
  const tabs = (["terraform", "cli", "console"] as const).filter((t) => def.fix[t]);
  const [tab, setTab] = useState(tabs[0]);
  const vars = { id: res ? nativeId(res) : undefined, region: res?.region ?? null, account: accountId };
  const text = fillFix(def.fix[tab]!, vars);
  return (
    <div className="space-y-2">
      <SegmentedControl
        options={tabs.map((t) => ({ value: t, label: t === "cli" ? "AWS CLI" : t === "terraform" ? "Terraform" : "Console" }))}
        value={tab}
        onChange={setTab}
      />
      {tab === "console" ? <p className="text-sm text-muted-foreground">{text}</p> : <CopyBlock text={text} />}
      {def.fix.cost && <p className="text-xs text-muted-foreground">Cost of the fix: {def.fix.cost}</p>}
    </div>
  );
}

function ExceptionForm({ def, res, onDone }: { def: AwsCheckDef; res: AwsResource; onDone: () => void }) {
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
        placeholder="Why this is fine — e.g. public website assets served through CloudFront"
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
  account,
  exceptions,
  canWrite,
}: {
  def: AwsCheckDef;
  result: AwsCheckResult;
  account: AwsAccountView;
  exceptions: CheckExceptionView[];
  canWrite: boolean;
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
                    <button type="button" className="underline text-muted-foreground" onClick={() => removeException(exc.id)}>
                      remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {result.result !== "pass" && <FixTabs def={def} res={result.resources[0] ?? null} accountId={account.accountId} />}
      <p className="text-[11px] text-muted-foreground">Reads: {def.apiCalls.join(", ")}</p>
    </div>
  );
}

function CheckRow(props: {
  def: AwsCheckDef;
  result: AwsCheckResult;
  account: AwsAccountView;
  exceptions: CheckExceptionView[];
  canWrite: boolean;
  open: boolean;
  onToggle: () => void;
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

function AccountSettings({ account, canWrite }: { account: AwsAccountView; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [alias, setAlias] = useState(account.alias ?? "");
  const [regions, setRegions] = useState((account.regions ?? []).join(", "));
  const save = async (patch: Record<string, unknown>) => {
    const r = await updateAwsAccount({ id: account.id, ...patch }).catch(() => ({ error: NETWORK }));
    if ("error" in r && r.error) return toast("error", r.error);
    toast("success", "Saved");
    router.refresh();
  };
  if (!canWrite || account.id === "legacy") return null;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Name" className="input max-w-[12rem]" />
        <Button size="sm" variant="outline" onClick={() => save({ alias: alias || null })}>Rename</Button>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={account.inScope} onChange={(e) => save({ inScope: e.target.checked })} />
          In audit scope
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="Regions to scan — blank = every region in use" className="input max-w-md" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => save({ regions: regions.split(/[\s,]+/).filter(Boolean) })}
        >
          Save regions
        </Button>
      </div>
      <button
        type="button"
        className="text-xs text-destructive underline"
        onClick={async () => {
          if (!confirm(`Remove account ${account.alias ?? account.accountId}? Its evidence stays in the vault.`)) return;
          const r = await removeAwsAccount(account.id).catch(() => ({ error: NETWORK }));
          if ("error" in r && r.error) return toast("error", r.error);
          router.refresh();
        }}
      >
        Remove this account
      </button>
    </div>
  );
}

export function AwsPosture({ view, canWrite }: { view: AwsView; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const scanned = view.accounts.filter((a) => a.scan);
  const [accountId, setAccountId] = useState<string>((scanned.find((a) => a.inScope) ?? scanned[0] ?? view.accounts[0])?.id ?? "");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(!view.accounts.length);
  const [retention, setRetention] = useState(String(view.logRetentionDays));
  const [restoreDays, setRestoreDays] = useState(String(view.settings.restoreTestDays));

  const account = view.accounts.find((a) => a.id === accountId) ?? null;
  const byKey = useMemo(() => new Map((account?.scan?.results ?? []).map((r) => [r.key, r])), [account]);

  const thisWeek = useMemo(
    () =>
      AWS_CHECKS.filter((d) => !d.informational && byKey.get(d.key)?.result === "fail")
        .map((d) => ({ d, r: byKey.get(d.key)! }))
        .sort((a, b) => SEVERITY_RANK[a.d.severity] - SEVERITY_RANK[b.d.severity] || b.r.failingCount - a.r.failingCount)
        .slice(0, 5),
    [byKey],
  );
  const totalCost = account?.scan?.results.reduce((n, r) => n + (r.costPerMonth ?? 0), 0) ?? 0;

  async function scan() {
    setBusy(true);
    const res = await syncAWS().catch(() => ({ error: NETWORK }));
    setBusy(false);
    if ("error" in res && res.error) toast("error", res.error);
    else if ("ok" in res) toast("success", `Scanned: ${res.fail} failing, ${res.pass} passing, ${res.inconclusive} can't tell`);
    router.refresh();
  }

  function jump(key: string) {
    setOpen(key);
    requestAnimationFrame(() => document.getElementById(`check-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  if (adding) {
    return (
      <div className="card space-y-3">
        <h2 className="text-sm font-semibold">Connect an AWS account</h2>
        <AwsConnect onDone={() => setAdding(false)} />
        {view.accounts.length > 0 && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setAdding(false)}>Cancel</button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Accounts */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {view.accounts.length > 1 ? (
            <SegmentedControl
              options={view.accounts.map((a) => ({ value: a.id, label: `${a.alias ?? a.accountId}${a.inScope ? "" : " (out of scope)"}` }))}
              value={accountId}
              onChange={(v) => { setAccountId(v); setOpen(null); }}
            />
          ) : (
            <span className="text-sm font-semibold">{account?.alias ?? account?.accountId}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {account?.scan
              ? `Scanned ${ago(account.scan.scannedAt)} · ${account.scan.regions.scanned.join(", ") || "no active regions"} · ${Math.round(account.scan.durationMs / 1000)} s`
              : "Not scanned yet"}
          </span>
          <span className="ml-auto flex gap-2">
            {canWrite && (
              <>
                <Button size="sm" onClick={scan} disabled={busy} leftIcon={<RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />}>
                  {busy ? "Scanning…" : "Scan now"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>Add account</Button>
              </>
            )}
          </span>
        </div>
        {account && !account.inScope && (
          <p className="text-xs text-muted-foreground">
            This account is out of audit scope: its results are shown here, but never raise alerts or count toward your frameworks.
          </p>
        )}
        {account?.authKind === "key" && (
          <p className="text-xs text-warning">Connected with an access key. Switch to a read-only role (Add account → same account) so no long-lived key is stored.</p>
        )}
        {account?.lastError && <p className="text-xs text-destructive">{account.lastError}</p>}
        {account?.scan?.regions.unscanned.length ? (
          <p className="text-xs text-warning">
            Not scanned this time: {account.scan.regions.unscanned.map((u) => `${u.region} (${u.reason})`).join(", ")}.
          </p>
        ) : null}
      </div>

      {account?.scan ? (
        <>
          {/* This week */}
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
              <p className="card text-sm text-muted-foreground">Nothing failing in this account. 🎉</p>
            )}
            {totalCost > 0 && (
              <p className="text-xs text-muted-foreground">
                Unsupported versions are costing an estimated <strong>${totalCost}/month</strong> in AWS extended-support charges — upgrading removes it.
              </p>
            )}
          </section>

          {/* All checks by area */}
          {AREAS.map(({ area, title }) => {
            const defs = AWS_CHECKS.filter((d) => d.area === area && !d.informational && byKey.has(d.key));
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
                <ul className="divide-y divide-border">
                  {defs.map((d) => (
                    <CheckRow
                      key={d.key}
                      def={d}
                      result={byKey.get(d.key)!}
                      account={account}
                      exceptions={view.exceptions}
                      canWrite={canWrite}
                      open={open === d.key}
                      onToggle={() => setOpen(open === d.key ? null : d.key)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}

          {/* Informational */}
          <section className="card space-y-1">
            <h2 className="text-sm font-semibold">
              Good to know <span className="text-xs font-normal text-muted-foreground">never raises an alert or holds back a framework</span>
            </h2>
            <ul className="divide-y divide-border">
              {AWS_CHECKS.filter((d) => d.informational && byKey.has(d.key)).map((d) => (
                <CheckRow
                  key={d.key}
                  def={d}
                  result={byKey.get(d.key)!}
                  account={account}
                  exceptions={view.exceptions}
                  canWrite={canWrite}
                  open={open === d.key}
                  onToggle={() => setOpen(open === d.key ? null : d.key)}
                />
              ))}
            </ul>
          </section>

          {/* Inventory */}
          <section className="card text-xs text-muted-foreground">
            In this account: {account.scan.inventory.instances} instances, {account.scan.inventory.volumes} volumes,{" "}
            {account.scan.inventory.databases} databases, {account.scan.inventory.functions} functions,{" "}
            {account.scan.inventory.tables} DynamoDB tables, {account.scan.inventory.clusters} EKS clusters,{" "}
            {account.scan.inventory.buckets} S3 buckets — filed daily as your asset inventory.
          </section>
        </>
      ) : (
        <p className="card text-sm text-muted-foreground">
          {canWrite ? "Run the first scan to see this account's checks." : "This account hasn't been scanned yet."}
        </p>
      )}

      {/* Settings */}
      {canWrite && (
        <section className="card space-y-4">
          <h2 className="text-sm font-semibold">Settings</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Keep audit logs at least</span>
            <input type="number" min={30} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} className="input w-24" />
            <span>days</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const r = await updateAwsSettings({ logRetentionDays: Number(retention) }).catch(() => ({ error: NETWORK }));
                if ("error" in r && r.error) toast("error", r.error);
                else toast("success", "Saved — applies from the next scan");
              }}
            >
              Save
            </Button>
            <span className="text-xs text-muted-foreground">NIS2 sets no fixed number; 365 days is common.</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Test a restore at least every</span>
            <input type="number" min={30} max={730} value={restoreDays} onChange={(e) => setRestoreDays(e.target.value)} className="input w-24" />
            <span>days</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const r = await updateAwsSettings({ restoreTestDays: Number(restoreDays) }).catch(() => ({ error: NETWORK }));
                if ("error" in r && r.error) toast("error", r.error);
                else toast("success", "Saved — applies from the next scan");
              }}
            >
              Save
            </Button>
            <span className="text-xs text-muted-foreground">Yearly is what most SOC 2 policies say; quarterly is stricter.</span>
          </div>
          {account && <AccountSettings key={account.id} account={account} canWrite={canWrite} />}
        </section>
      )}
    </div>
  );
}
