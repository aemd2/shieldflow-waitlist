"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ShieldCheck, CircleAlert, CircleHelp } from "lucide-react";
import { updateAwsSettings } from "@/app/actions/aws";
import { createCheckException } from "@/app/actions/check-exceptions";
import type { AwsView, ChangeRow, PersonRow } from "@/lib/aws/view";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AwsPosture } from "@/components/integrations/aws/AwsPosture";

const NETWORK = "Network problem — check your connection and try again.";

type Tab = "posture" | "people" | "changes" | "backups" | "facts";
const TABS: { value: Tab; label: string }[] = [
  { value: "posture", label: "Posture" },
  { value: "people", label: "People" },
  { value: "changes", label: "Changes" },
  { value: "backups", label: "Backups" },
  { value: "facts", label: "Facts" },
];

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function verdictBadge(result: string | undefined): { variant: BadgeVariant; label: string } {
  if (result === "pass") return { variant: "success", label: "Pass" };
  if (result === "fail") return { variant: "critical", label: "Fail" };
  return { variant: "neutral", label: result ? "Can't tell" : "Not run yet" };
}

export function AwsWorkspace({ view, canWrite }: { view: AwsView; canWrite: boolean }) {
  const [tab, setTab] = useState<Tab>("posture");
  // Deep links: /integrations/aws#people opens that tab.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.some((t) => t.value === h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const pick = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", t === "posture" ? window.location.pathname : `#${t}`);
  };
  const scanned = view.accounts.some((a) => a.scan);

  return (
    <div className="space-y-6">
      {scanned && <SegmentedControl options={TABS} value={tab} onChange={pick} />}
      {tab === "posture" || !scanned ? (
        <AwsPosture view={view} canWrite={canWrite} />
      ) : tab === "people" ? (
        <People view={view} />
      ) : tab === "changes" ? (
        <Changes view={view} canWrite={canWrite} />
      ) : tab === "backups" ? (
        <Backups view={view} />
      ) : (
        <Facts view={view} canWrite={canWrite} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ people

const MATCH: Record<PersonRow["match"], { variant: BadgeVariant; label: (p: PersonRow) => string }> = {
  leaver: { variant: "critical", label: (p) => `Left${p.person?.endedAt ? ` ${day(p.person.endedAt)}` : ""} — still has access` },
  unknown: { variant: "warning", label: () => "Nobody in Personnel" },
  matched: { variant: "success", label: (p) => p.person?.name ?? "In Personnel" },
  dismissed: { variant: "neutral", label: () => "Marked not a person" },
  machine: { variant: "neutral", label: () => "Machine user (keys only)" },
  inactive: { variant: "neutral", label: () => "Disabled" },
};

function People({ view }: { view: AwsView }) {
  const p = view.people;
  if (!p) return <p className="card text-sm text-muted-foreground">People haven&apos;t been read yet — run a scan.</p>;
  const check = (key: string) => view.workspaceChecks.find((c) => c.key === key);
  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <span className="text-2xl font-semibold">{p.production}</span>{" "}
            <span className="text-sm text-muted-foreground">{p.production === 1 ? "login reaches" : "logins reach"} production</span>
          </div>
          <div>
            <span className="text-2xl font-semibold">{p.admins}</span>{" "}
            <span className="text-sm text-muted-foreground">with administrator rights</span>
          </div>
          <Link href="/access-reviews" className="ml-auto text-sm underline">
            Review this access →
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          {p.identityCenter === "seen"
            ? "IAM Identity Center users with their permission sets (directly or through a group), plus IAM users in your production accounts."
            : "IAM users in your production accounts."}{" "}
          Production means the accounts you&apos;ve marked in audit scope. In an access review, pick “AWS (production accounts)” to snapshot exactly this list.
        </p>
        {p.blindSpot && (
          <p className="flex items-start gap-2 text-xs text-warning">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This list may be incomplete: {p.blindSpot}.
          </p>
        )}
        <ul className="space-y-1.5 border-t border-border pt-3">
          {[
            { key: "aws.offboarding_drift", title: "Leavers have no AWS access" },
            { key: "aws.untracked_accounts", title: "Every AWS login belongs to someone you know" },
          ].map(({ key, title }) => {
            const c = check(key);
            const b = verdictBadge(c?.result);
            return (
              <li key={key} className="flex flex-wrap items-start gap-2 text-sm">
                <Badge variant={b.variant}>{b.label}</Badge>
                <span className="font-medium">{title}</span>
                {c?.detail && <span className="w-full text-xs text-muted-foreground sm:w-auto">{c.detail}</span>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Matched to <Link href="/personnel" className="underline">Personnel</Link> by email; an IAM user called “jane” matches the one person whose email
          starts “jane@”. Unknown logins can be dismissed as “not a person” on the Personnel page.
        </p>
      </section>

      <section className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Login</th>
              <th className="px-4 py-2 font-medium">Personnel</th>
              <th className="px-4 py-2 font-medium">Access</th>
              <th className="px-4 py-2 font-medium">Sign-in</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {p.rows.map((r) => {
              const m = MATCH[r.match];
              return (
                <tr key={r.id} className={r.active ? "" : "opacity-60"}>
                  <td className="px-4 py-2 align-top">
                    <div className="font-medium">{r.email ?? r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.kind === "sso" ? "Identity Center" : "IAM user"}
                      {r.email && r.name !== r.email ? ` · ${r.name}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-2 align-top">
                    <Badge variant={m.variant}>{m.label(r)}</Badge>
                  </td>
                  <td className="px-4 py-2 align-top">
                    {r.grants.length ? (
                      <ul className="space-y-0.5 text-xs">
                        {r.grants.map((g, i) => (
                          <li key={i} className={g.production ? "" : "text-muted-foreground"}>
                            <span className={g.admin ? "font-semibold" : ""}>{g.role}</span> on {g.account}
                            {g.admin && <span className="ml-1 text-destructive">admin</span>}
                            {g.via && r.kind === "sso" ? <span className="text-muted-foreground"> · {g.via}</span> : null}
                            {!g.production && <span> · out of scope</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">No access to a connected account</span>
                    )}
                  </td>
                  <td className="px-4 py-2 align-top text-xs text-muted-foreground">
                    {r.kind === "iam" ? (
                      <>
                        {r.console ? (r.mfa ? "Console + MFA" : <span className="text-destructive">Console, no MFA</span>) : "No console"}
                        {r.keys ? ` · ${r.keys} key${r.keys === 1 ? "" : "s"}` : ""}
                        <div>Last used {day(r.lastUsed)}</div>
                      </>
                    ) : (
                      "AWS access portal"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------- changes

function RecordWhy({ row, onDone }: { row: ChangeRow; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const label = `${when(row.at)} · ${row.principal ?? "unknown"} · ${row.name}`;
    const r = await createCheckException({ checkKey: "aws.manual_changes", resourceId: row.resourceId, label, reason, expiresAt: null }).catch(() => ({ error: NETWORK }));
    setBusy(false);
    if ("error" in r && r.error) return toast("error", r.error);
    toast("success", "Recorded");
    onDone();
  }
  return (
    <form onSubmit={save} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        minLength={5}
        placeholder="Why by hand — e.g. incident #12, break-glass; codified in PR #340"
        className="input min-w-[16rem] flex-1 text-sm"
      />
      <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Record"}</Button>
      <button type="button" className="text-xs text-muted-foreground underline" onClick={onDone}>Cancel</button>
    </form>
  );
}

function Changes({ view, canWrite }: { view: AwsView; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const unexplained = view.changes.filter((c) => !c.reason).length;
  return (
    <div className="space-y-4">
      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold">Changes made by hand in production</h2>
        <p className="text-muted-foreground">
          Write actions from a console session, and anything the root user did, in your in-scope accounts — read daily from CloudTrail&apos;s event
          history and kept here beyond AWS&apos;s 90 days. Pipelines and Terraform don&apos;t sign in to the console, so they never show up. This is
          your change-management sample: for each one, codify it or record why it was done by hand.
        </p>
        <p className="text-xs text-muted-foreground">
          {view.changesCoverage.length
            ? view.changesCoverage.map((c) => `${c.account}: complete from ${day(c.from)}`).join(" · ")
            : "Not read yet — the next scan reads the last 30 days."}
        </p>
      </section>
      {view.changes.length ? (
        <section className="card space-y-1">
          <h3 className="text-sm font-semibold">
            Last 30 days <span className="font-normal text-muted-foreground">· {view.changes.length} changes, {unexplained} without a recorded reason</span>
          </h3>
          <ul className="divide-y divide-border">
            {view.changes.map((c) => (
              <li key={c.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{when(c.at)}</span>
                  {c.via === "root" ? (
                    <Badge variant="critical">root account</Badge>
                  ) : (
                    <span className="font-medium">{c.principal ?? "unknown"}</span>
                  )}
                  <span className="font-mono text-xs">
                    {c.source}:{c.name}
                  </span>
                  {c.resources && <span className="truncate text-xs text-muted-foreground">{c.resources}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {c.account} · {c.region}
                  </span>
                </div>
                <div className="pl-[7.5rem] text-xs">
                  {c.reason ? (
                    <span className="text-muted-foreground">Recorded: {c.reason}</span>
                  ) : canWrite && open !== c.id ? (
                    <button type="button" className="text-muted-foreground underline" onClick={() => setOpen(c.id)}>
                      Record why…
                    </button>
                  ) : null}
                  {open === c.id && <RecordWhy row={c} onDone={() => { setOpen(null); router.refresh(); }} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="card text-sm text-muted-foreground">No changes made by hand in the last 30 days.</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- backups

function Backups({ view }: { view: AwsView }) {
  const b = view.backups;
  const days = view.settings.restoreTestDays;
  const [now] = useState(() => Date.now());
  const recent = b.restores.filter((r) => now - Date.parse(r.at) <= days * 86_400_000);
  return (
    <div className="space-y-4">
      <section className="card space-y-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <span className="text-2xl font-semibold">{recent.length}</span>{" "}
            <span className="text-muted-foreground">restore {recent.length === 1 ? "test" : "tests"} in the last {days} days</span>
          </div>
          <div>
            <span className="text-2xl font-semibold">{b.testingPlans}</span>{" "}
            <span className="text-muted-foreground">automated restore testing {b.testingPlans === 1 ? "plan" : "plans"}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          We count AWS Backup restore jobs and RDS/DynamoDB restores from CloudTrail, and remember them after AWS forgets. The easiest way to keep this
          green is an AWS Backup restore testing plan — the Terraform is on the Posture tab under “Backups have been restore-tested”.
        </p>
      </section>

      <section className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Production data store</th>
              <th className="px-4 py-2 font-medium">Where</th>
              <th className="px-4 py-2 font-medium">Backups</th>
              <th className="px-4 py-2 font-medium">Encrypted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {b.stores.length ? (
              b.stores.map((s) => (
                <tr key={`${s.account}:${s.region}:${s.id}`}>
                  <td className="px-4 py-2">
                    <div className="font-mono text-xs">{s.id}</div>
                    <div className="text-xs text-muted-foreground">{s.kind === "dynamodb" ? "DynamoDB table" : s.kind === "aurora" ? "Aurora cluster" : "RDS database"}</div>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {s.account} · {s.region}
                  </td>
                  <td className="px-4 py-2 text-xs">{s.backup ?? <span className="text-destructive">none</span>}</td>
                  <td className="px-4 py-2 text-xs">{s.encrypted === false ? <span className="text-destructive">No</span> : s.encrypted ? "Yes" : "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-sm text-muted-foreground">No databases or DynamoDB tables in your production accounts.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card space-y-1">
        <h3 className="text-sm font-semibold">Restores seen</h3>
        {b.restores.length ? (
          <ul className="divide-y divide-border text-sm">
            {b.restores.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{day(r.at)}</span>
                <span>{r.resourceType}</span>
                {r.source && <span className="font-mono text-xs text-muted-foreground">from {r.source}</span>}
                <Badge variant={r.automated ? "success" : "neutral"}>{r.automated ? "automated test" : r.via}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {r.account} · {r.region}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            None yet. If you tested a restore some other way, mark the restore-test check out of scope with the date and attach the write-up as evidence.
          </p>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------- facts

function Facts({ view, canWrite }: { view: AwsView; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const f = view.facts;
  // Show the choice at once; put it back if the save fails.
  const [residency, setResidency] = useState(view.settings.residency ?? "");
  const [onTrust, setOnTrust] = useState(view.settings.showOnTrustCenter);
  const save = async (patch: Record<string, unknown>, undo: () => void) => {
    const r = await updateAwsSettings(patch).catch(() => ({ error: NETWORK }));
    if ("error" in r && r.error) {
      undo();
      return toast("error", r.error);
    }
    toast("success", "Saved — applies from the next scan");
    router.refresh();
  };
  if (!f) return <p className="card text-sm text-muted-foreground">Facts come from your in-scope accounts once they&apos;ve been scanned.</p>;
  return (
    <div className="space-y-4">
      <section className="card space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">What you can tell customers — verified {day(f.verifiedAt)}</h2>
          <a href="/api/aws/facts-sheet" className="ml-auto inline-flex items-center gap-1.5 text-sm underline">
            <Download className="h-4 w-4" /> Supplier data sheet (CSV)
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          Each statement comes from the last scan of your {f.accounts} production {f.accounts === 1 ? "account" : "accounts"} and is only stated as true
          when the checks behind it pass. Questionnaire drafts and Co-Pilot use these; the data sheet is what DORA and NIS2 customers ask suppliers for.
        </p>
      </section>

      <section className="card p-0">
        <ul className="divide-y divide-border">
          {f.facts.map((x) => (
            <li key={x.key} className="flex gap-3 px-5 py-3 text-sm">
              {x.ok === true ? (
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : x.ok === false ? (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              ) : (
                <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <div className="font-medium">{x.title}</div>
                <div className="text-muted-foreground">{x.statement}</div>
                {x.key === "location" && x.proof.length > 0 && (
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {x.proof.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {canWrite && (
        <section className="card space-y-3 text-sm">
          <h3 className="font-semibold">Commitments</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span>We promise customers their data stays in</span>
            <select
              value={residency}
              onChange={(e) => {
                const before = residency;
                setResidency(e.target.value);
                save({ residency: e.target.value || null }, () => setResidency(before));
              }}
              className="input w-auto py-1"
            >
              <option value="">— no residency promise —</option>
              <option value="eu">the EU</option>
              <option value="europe">Europe (EU, UK, Switzerland)</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Set this and every scan checks that no database, bucket, volume or backup copy sits outside it — London and Zurich are in Europe but not the EU.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={onTrust}
              onChange={(e) => {
                const next = e.target.checked;
                setOnTrust(next);
                save({ showOnTrustCenter: next }, () => setOnTrust(!next));
              }}
            />
            <span>
              Show the verified facts on our <Link href="/settings" className="underline">Trust Center</Link>
              <span className="block text-xs text-muted-foreground">
                Only statements that are currently true are shown, dated; one that stops being true disappears at the next scan. Who has access is never shown.
              </span>
            </span>
          </label>
        </section>
      )}
    </div>
  );
}
