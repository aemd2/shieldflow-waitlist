"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, CircleAlert, ExternalLink, Link2, Ban } from "lucide-react";
import { syncGitHub, updateGitHubSettings } from "@/app/actions/github";
import { syncGoogleWorkspace, updateGoogleSettings } from "@/app/actions/integrations";
import { createVendor } from "@/app/actions/vendors";
import { syncMicrosoft, updateMicrosoftSettings } from "@/app/actions/microsoft";
import { createCheckException } from "@/app/actions/check-exceptions";
import { dismissIdentityAccount, restoreIdentityAccount, linkIdentity, unlinkIdentity } from "@/app/actions/identity";
import type { CheckDef } from "@/lib/checks-core";
import type { SettingField } from "@/lib/integrations/registry";
import type { ProviderView, PersonRowView, ChangeRowView, PersonMatch, AppRowView } from "@/lib/integrations/provider-view";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PostureChecks } from "@/components/integrations/checks/CheckList";

const NETWORK = "Network problem — check your connection and try again.";

type ActionResult = { error?: string; ok?: boolean; pass?: number; fail?: number; inconclusive?: number };
type Action = (input?: unknown) => Promise<ActionResult>;

/** Scan and settings actions per provider page. */
const SCAN: Partial<Record<string, Action>> = {
  github: syncGitHub as unknown as Action,
  google_workspace: syncGoogleWorkspace as unknown as Action,
  microsoft: syncMicrosoft as unknown as Action,
};
const SAVE_SETTINGS: Partial<Record<string, Action>> = {
  github: updateGitHubSettings as unknown as Action,
  google_workspace: updateGoogleSettings as unknown as Action,
  microsoft: updateMicrosoftSettings as unknown as Action,
};

type Tab = "posture" | "people" | "apps" | "devices" | "changes" | "vulnerabilities" | "settings";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ProviderWorkspace({
  view,
  title,
  catalog,
  areas,
  settingFields,
  canWrite,
}: {
  view: ProviderView;
  title: string;
  catalog: CheckDef[];
  areas: { area: string; title: string }[];
  settingFields: SettingField[];
  canWrite: boolean;
}) {
  const tabs = useMemo(() => {
    const t: { value: Tab; label: string }[] = [{ value: "posture", label: "Posture" }];
    if (view.people) t.push({ value: "people", label: "People" });
    if (view.apps) t.push({ value: "apps", label: view.provider === "microsoft" ? "App consents" : "Third-party apps" });
    if (view.devices) t.push({ value: "devices", label: "Devices" });
    if (view.changes) t.push({ value: "changes", label: "Changes" });
    if (view.alerts) t.push({ value: "vulnerabilities", label: "Vulnerabilities" });
    if (view.settings && settingFields.length) t.push({ value: "settings", label: "Settings" });
    return t;
  }, [view, settingFields]);
  const [tab, setTab] = useState<Tab>("posture");
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (tabs.some((t) => t.value === h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);
  const pick = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", t === "posture" ? window.location.pathname : `#${t}`);
  };

  if (view.status !== "connected" && view.status !== "error") {
    return (
      <div className="card space-y-2 text-sm">
        <p>{title} isn&apos;t connected yet.</p>
        <Link href="/integrations" className="underline">Connect it on the Integrations page →</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ScanHeader view={view} title={title} canWrite={canWrite} />
      {view.unread.length > 0 && (
        <section className="card space-y-1 text-xs">
          <p className="flex items-center gap-2 font-medium text-warning">
            <CircleAlert className="h-3.5 w-3.5" /> Some areas couldn&apos;t be read, so their checks say &ldquo;can&apos;t tell&rdquo;:
          </p>
          <ul className="list-disc pl-8 text-muted-foreground">
            {view.unread.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>
      )}
      {view.scan && tabs.length > 1 && <SegmentedControl options={tabs} value={tab} onChange={pick} />}
      {!view.scan ? (
        <p className="card text-sm text-muted-foreground">Not scanned yet — run a scan to see every check.</p>
      ) : tab === "people" && view.people ? (
        <People view={view} canWrite={canWrite} title={title} />
      ) : tab === "apps" && view.apps ? (
        <Apps view={view} canWrite={canWrite} />
      ) : tab === "devices" && view.devices ? (
        <Devices view={view} />
      ) : tab === "changes" && view.changes ? (
        <Changes view={view} canWrite={canWrite} />
      ) : tab === "vulnerabilities" && view.alerts ? (
        <Vulnerabilities view={view} />
      ) : tab === "settings" && view.settings ? (
        <Settings view={view} fields={settingFields} canWrite={canWrite} />
      ) : (
        <PostureChecks
          catalog={catalog}
          areas={areas}
          results={view.scan.results}
          vars={{ account: view.account }}
          exceptions={view.exceptions}
          canWrite={canWrite}
          emptyText={`Nothing failing in ${title}. 🎉`}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ header

function ScanHeader({ view, title, canWrite }: { view: ProviderView; title: string; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const scan: Action | undefined = SCAN[view.provider];
  // Back from installing / connecting: say so once, then drop the parameter.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("connected") !== "1") return;
    toast("success", view.scan ? `${title} connected` : `${title} connected — run the first scan`);
    url.searchParams.delete("connected");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [toast, title, view.scan]);
  async function run() {
    if (!scan) return;
    setBusy(true);
    const r = await scan().catch(() => ({ error: NETWORK }) as ActionResult);
    setBusy(false);
    if (r.error) toast("error", r.error);
    else toast("success", `Scanned: ${r.fail ?? 0} failing, ${r.pass ?? 0} passing, ${r.inconclusive ?? 0} can't tell`);
    router.refresh();
  }
  const counts = { pass: 0, fail: 0, inconclusive: 0 };
  for (const r of view.scan?.results ?? []) counts[r.result]++;
  return (
    <section className="card flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{view.account ? (view.provider === "github" ? `@${view.account}` : view.account) : title}</span>
          {view.connection === "app" ? <Badge variant="success">read-only App</Badge> : view.connection === "token" ? <Badge variant="neutral">token</Badge> : null}
          {view.status === "error" && <Badge variant="critical">access stopped working</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {view.scan
            ? `Scanned ${when(view.scan.scannedAt)} in ${Math.max(1, Math.round(view.scan.durationMs / 1000))}s${view.scan.summary.length ? ` · ${view.scan.summary.join(" · ")}` : ""}`
            : "Not scanned yet."}{" "}
          Scans run every morning; run one now after a fix.
        </p>
      </div>
      {view.scan && (
        <div className="flex gap-4 text-sm">
          <span><span className="font-semibold text-destructive">{counts.fail}</span> failing</span>
          <span><span className="font-semibold">{counts.pass}</span> passing</span>
          <span><span className="font-semibold text-muted-foreground">{counts.inconclusive}</span> can&apos;t tell</span>
        </div>
      )}
      {canWrite && scan && (
        <Button variant="outline" onClick={run} disabled={busy} leftIcon={<RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />}>
          {busy ? "Scanning…" : "Scan now"}
        </Button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ people

const MATCH: Record<PersonMatch, { variant: BadgeVariant; label: (r: PersonRowView) => string }> = {
  leaver: { variant: "critical", label: (r) => `${r.person?.name ?? "Leaver"} — left${r.person?.endedAt ? ` ${day(r.person.endedAt)}` : ""}, still has access` },
  unknown: { variant: "warning", label: () => "Nobody in Personnel" },
  matched: { variant: "success", label: (r) => r.person?.name ?? "In Personnel" },
  dismissed: { variant: "neutral", label: () => "Marked not a person" },
  bot: { variant: "neutral", label: () => "Bot" },
  inactive: { variant: "neutral", label: (r) => (r.person ? `${r.person.name} · can't sign in` : "Can't sign in") },
};

function LinkPerson({ row, provider, personnel, onDone }: { row: PersonRowView; provider: string; personnel: ProviderView["personnel"]; onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await linkIdentity({ provider, account: row.account, email }).catch(() => ({ error: NETWORK }));
    setBusy(false);
    if ("error" in r && r.error) return toast("error", r.error);
    toast("success", `Linked — ${row.account} counts as that person from the next scan`);
    onDone();
  }
  return (
    <form onSubmit={save} className="mt-2 flex flex-wrap items-center gap-2">
      <select value={email} onChange={(e) => setEmail(e.target.value)} required className="input w-auto min-w-[14rem] py-1 text-sm">
        <option value="">Who is this?</option>
        {personnel.map((p) => (
          <option key={p.email} value={p.email}>
            {p.name} · {p.email}
            {p.status === "offboarded" ? " (left)" : ""}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={busy || !email}>{busy ? "Saving…" : "Link"}</Button>
      <button type="button" className="text-xs text-muted-foreground underline" onClick={onDone}>Cancel</button>
    </form>
  );
}

function People({ view, canWrite, title }: { view: ProviderView; canWrite: boolean; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const p = view.people!;
  const check = (suffix: string) => view.scan?.results.find((r) => r.key.endsWith(suffix));
  const counts = { leaver: 0, unknown: 0 } as Record<PersonMatch, number>;
  for (const r of p.rows) counts[r.match] = (counts[r.match] ?? 0) + 1;

  async function act(fn: () => Promise<{ error?: string }>, ok: string) {
    const r = await fn().catch(() => ({ error: NETWORK }));
    if (r.error) return toast("error", r.error);
    toast("success", ok);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <span className="text-2xl font-semibold">{p.rows.length}</span> <span className="text-sm text-muted-foreground">accounts in {title}</span>
          </div>
          <div>
            <span className="text-2xl font-semibold text-destructive">{counts.leaver ?? 0}</span> <span className="text-sm text-muted-foreground">leavers with access</span>
          </div>
          <div>
            <span className="text-2xl font-semibold">{counts.unknown ?? 0}</span> <span className="text-sm text-muted-foreground">not matched to anyone</span>
          </div>
          <Link href="/access-reviews" className="ml-auto text-sm underline">Review this access →</Link>
        </div>
        <ul className="space-y-1.5 border-t border-border pt-3">
          {[
            { suffix: ".offboarding_drift", title: `Leavers have no ${title} access` },
            { suffix: ".untracked_accounts", title: `Every ${title} account belongs to someone you know` },
          ].map(({ suffix, title: t }) => {
            const c = check(suffix);
            const b: { variant: BadgeVariant; label: string } =
              c?.result === "pass" ? { variant: "success", label: "Pass" } : c?.result === "fail" ? { variant: "critical", label: "Fail" } : { variant: "neutral", label: c ? "Can't tell" : "Not run yet" };
            return (
              <li key={suffix} className="flex flex-wrap items-start gap-2 text-sm">
                <Badge variant={b.variant}>{b.label}</Badge>
                <span className="font-medium">{t}</span>
                {c?.detail && <span className="w-full text-xs text-muted-foreground sm:w-auto">{c.detail}</span>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">{p.note}</p>
        {p.blindSpot && (
          <p className="flex items-start gap-2 text-xs text-warning">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> This list may be incomplete: {p.blindSpot}.
          </p>
        )}
      </section>

      <section className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Account</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Personnel</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {p.rows.map((r) => {
              const m = MATCH[r.match];
              return (
                <tr key={`${r.where}:${r.account}`}>
                  <td className="px-4 py-2 align-top">
                    <div className="font-medium">{r.account}</div>
                    {r.name && <div className="text-xs text-muted-foreground">{r.name}</div>}
                  </td>
                  <td className="px-4 py-2 align-top text-xs">
                    {r.role} · {r.where}
                    {r.flags.map((f) => (
                      <div key={f.label} className={f.bad ? "text-destructive" : "text-muted-foreground"}>{f.label}</div>
                    ))}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={m.variant}>{m.label(r)}</Badge>
                      {r.linked && <span className="text-xs text-muted-foreground">linked by hand</span>}
                    </div>
                    {canWrite && open !== r.account && (
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {p.linkable && (r.match === "unknown" || r.match === "dismissed" || r.linked) && (
                          <button type="button" className="inline-flex items-center gap-1 underline" onClick={() => setOpen(r.account)}>
                            <Link2 className="h-3 w-3" /> {r.linked ? "Change person" : "This is…"}
                          </button>
                        )}
                        {r.linked && (
                          <button type="button" className="underline" onClick={() => act(() => unlinkIdentity({ provider: view.provider, account: r.account }), "Unlinked")}>
                            Unlink
                          </button>
                        )}
                        {r.match === "unknown" && (
                          <button type="button" className="inline-flex items-center gap-1 underline" onClick={() => act(() => dismissIdentityAccount(r.subject), "Marked as not a person — from the next scan")}>
                            <Ban className="h-3 w-3" /> Not a person
                          </button>
                        )}
                        {r.match === "dismissed" && (
                          <button type="button" className="underline" onClick={() => act(() => restoreIdentityAccount(r.subject), "It will be checked again on the next scan")}>
                            Undo “not a person”
                          </button>
                        )}
                      </div>
                    )}
                    {open === r.account && (
                      <LinkPerson row={r} provider={view.provider} personnel={view.personnel} onDone={() => { setOpen(null); router.refresh(); }} />
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

// -------------------------------------------------------------------- apps

function Apps({ view, canWrite }: { view: ProviderView; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const a = view.apps!;
  const risky = a.rows.filter((r) => r.risky.length);
  const rows = all ? a.rows : risky;
  async function addVendor(r: AppRowView) {
    const res = await createVendor({
      name: r.name.slice(0, 120),
      category: r.vendorCategory,
      risk_level: r.risky.length ? "high" : "medium",
      status: "under_review",
      notes: `Found by ShieldFlow: ${r.audience ?? `${r.people} ${r.people === 1 ? "person" : "people"}`} granted it access${r.risky.length ? ` to ${r.risky.join(", ")}` : ""}. App ID ${r.clientId}.`,
      soc2_status: "none",
      data_sensitivity: r.risky.length ? "pii" : "internal",
    }).catch(() => ({ error: NETWORK }));
    if ("error" in res && res.error) return toast("error", res.error);
    toast("success", `${r.name} added to Vendors — review it there`);
    router.refresh();
  }
  if (a.missing) return <p className="card text-sm text-muted-foreground">{a.missing}</p>;
  return (
    <div className="space-y-4">
      <section className="card space-y-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <span className="text-2xl font-semibold">{a.rows.length}</span> <span className="text-muted-foreground">apps holding access</span>
          </div>
          <div>
            <span className="text-2xl font-semibold text-destructive">{risky.filter((r) => !r.approved).length}</span>{" "}
            <span className="text-muted-foreground">can read mail or all of Drive, not approved</span>
          </div>
          <div>
            <span className="text-2xl font-semibold">{a.rows.filter((r) => r.inVendors).length}</span> <span className="text-muted-foreground">already in Vendors</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{a.note}</p>
      </section>
      <SegmentedControl
        options={[
          { value: "risky", label: "Mail, Drive or admin" },
          { value: "all", label: "All apps" },
        ]}
        value={all ? "all" : "risky"}
        onChange={(v) => setAll(v === "all")}
      />
      {rows.length ? (
        <section className="card p-0">
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.clientId} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  {r.risky.map((x) => (
                    <Badge key={x} variant="high">{x}</Badge>
                  ))}
                  {r.approved && <Badge variant="success">approved</Badge>}
                  {r.inVendors && <Badge variant="neutral">in Vendors</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {r.audience ?? `${r.people} ${r.people === 1 ? "person" : "people"} · last granted ${day(r.lastAuthorized)}`}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.sample.join(", ")}
                  {r.people > r.sample.length ? ` and ${r.people - r.sample.length} more` : ""}
                </div>
                {r.approved && <div className="text-xs text-muted-foreground">Approved: {r.approved}</div>}
                {canWrite && (
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {!r.inVendors && (
                      <button type="button" className="underline" onClick={() => addVendor(r)}>
                        Add to Vendors
                      </button>
                    )}
                    {r.risky.length > 0 && !r.approved && open !== r.clientId && (
                      <button type="button" className="underline" onClick={() => setOpen(r.clientId)}>
                        Approve…
                      </button>
                    )}
                  </div>
                )}
                {open === r.clientId && <ApproveApp row={r} onDone={() => { setOpen(null); router.refresh(); }} />}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="card text-sm text-muted-foreground">{all ? "No third-party app grants." : "No app can read mail, all of Drive or admin settings. 🎉"}</p>
      )}
    </div>
  );
}

function ApproveApp({ row, onDone }: { row: AppRowView; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const label = `${row.name} — ${row.risky.join(", ")}`;
    const expiresAt = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const r = await createCheckException({ checkKey: row.checkKey, resourceId: row.resourceId, label, reason, expiresAt }).catch(() => ({ error: NETWORK }));
    setBusy(false);
    if ("error" in r && r.error) return toast("error", r.error);
    toast("success", "Approved for a year — from the next scan");
    onDone();
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        minLength={5}
        placeholder="Why it's fine — e.g. our CRM, DPA signed, reviewed in Vendors"
        className="input min-w-[16rem] flex-1 text-sm"
      />
      <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Approve"}</Button>
      <button type="button" className="text-xs text-muted-foreground underline" onClick={onDone}>Cancel</button>
    </form>
  );
}

// ----------------------------------------------------------------- devices

function Devices({ view }: { view: ProviderView }) {
  const d = view.devices!;
  if (d.missing) return <p className="card text-sm text-muted-foreground">{d.missing}</p>;
  const unencrypted = d.rows.filter((r) => r.encrypted === false).length;
  const stale = d.rows.filter((r) => r.stale).length;
  const coverage = view.scan?.results.find((r) => r.key.endsWith(".device_coverage"));
  return (
    <div className="space-y-4">
      <section className="card space-y-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div><span className="text-2xl font-semibold">{d.rows.length}</span> <span className="text-muted-foreground">devices in {d.mdm}</span></div>
          <div><span className="text-2xl font-semibold text-destructive">{unencrypted}</span> <span className="text-muted-foreground">not encrypted</span></div>
          <div><span className="text-2xl font-semibold">{stale}</span> <span className="text-muted-foreground">not seen for {d.staleDays}+ days</span></div>
        </div>
        {coverage && <p className="text-xs">{coverage.result === "fail" ? <span className="text-destructive">{coverage.detail}</span> : <span className="text-muted-foreground">{coverage.detail}</span>}</p>}
        <p className="text-xs text-muted-foreground">{d.note}</p>
      </section>
      {d.rows.length ? (
        <section className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Device</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Encrypted</th>
                <th className="px-4 py-2 font-medium">Last check-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 align-top">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.os}{r.osVersion ? ` ${r.osVersion}` : ""}</div>
                  </td>
                  <td className="px-4 py-2 align-top text-xs">
                    {r.person ?? r.owner ?? <span className="text-muted-foreground">nobody</span>}
                    {r.leaver && <div className="text-destructive">has left</div>}
                  </td>
                  <td className="px-4 py-2 align-top text-xs">
                    {r.encrypted === false ? <span className="text-destructive">No</span> : r.encrypted ? "Yes" : <span className="text-muted-foreground">unknown</span>}
                  </td>
                  <td className={`px-4 py-2 align-top text-xs ${r.stale ? "text-warning" : "text-muted-foreground"}`}>{r.lastSeen ? day(r.lastSeen) : "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="card text-sm text-muted-foreground">No devices enrolled yet.</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- changes

function RecordWhy({ row, onDone }: { row: ChangeRowView; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const label = `${row.repo}#${row.number} — ${row.title.slice(0, 80)}`;
    const r = await createCheckException({ checkKey: "github.unreviewed_merges", resourceId: row.resourceId, label, reason, expiresAt: null }).catch(() => ({ error: NETWORK }));
    setBusy(false);
    if ("error" in r && r.error) return toast("error", r.error);
    toast("success", "Recorded — counts as reviewed from the next scan");
    onDone();
  }
  return (
    <form onSubmit={save} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        minLength={5}
        placeholder="e.g. Emergency fix for incident #12, reviewed after by Sam"
        className="input min-w-[16rem] flex-1 text-sm"
      />
      <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Record"}</Button>
      <button type="button" className="text-xs text-muted-foreground underline" onClick={onDone}>Cancel</button>
    </form>
  );
}

function Changes({ view, canWrite }: { view: ProviderView; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [only, setOnly] = useState<"all" | "unreviewed">("all");
  const c = view.changes!;
  const unreviewed = c.rows.filter((r) => !r.independent && !r.reason);
  const rows = only === "unreviewed" ? c.rows.filter((r) => !r.independent) : c.rows;
  const withTicket = c.rows.filter((r) => r.ticket).length;
  return (
    <div className="space-y-4">
      <section className="card space-y-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div><span className="text-2xl font-semibold">{c.rows.length}</span> <span className="text-muted-foreground">changes merged in 90 days</span></div>
          <div><span className="text-2xl font-semibold text-destructive">{unreviewed.length}</span> <span className="text-muted-foreground">without an independent review or a reason</span></div>
          <div><span className="text-2xl font-semibold">{c.rows.length ? Math.round((withTicket / c.rows.length) * 100) : 0}%</span> <span className="text-muted-foreground">linked to a ticket</span></div>
        </div>
        <p className="text-xs text-muted-foreground">{c.note} The check looks at the last {c.windowDays} days.</p>
      </section>
      <div className="flex items-center gap-3">
        <SegmentedControl
          options={[
            { value: "all", label: "All" },
            { value: "unreviewed", label: "No independent approval" },
          ]}
          value={only}
          onChange={(v) => setOnly(v as "all" | "unreviewed")}
        />
        <a href="/evidence" className="text-xs text-muted-foreground underline">Filed lists are in Evidence</a>
      </div>
      {rows.length ? (
        <section className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Merged</th>
                <th className="px-4 py-2 font-medium">Change</th>
                <th className="px-4 py-2 font-medium">Author → merged by</th>
                <th className="px-4 py-2 font-medium">Approved by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-2 align-top text-xs tabular-nums text-muted-foreground">{when(r.mergedAt)}</td>
                  <td className="px-4 py-2 align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                          {r.repo}#{r.number}
                        </a>
                      ) : (
                        <span className="font-medium">{r.repo}#{r.number}</span>
                      )}
                      {r.ticket && <Badge variant="neutral">{r.ticket}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{r.title}</div>
                    {!r.independent && (
                      <div className="text-xs">
                        {r.reason ? (
                          <span className="text-muted-foreground">Recorded: {r.reason}</span>
                        ) : canWrite && open !== r.id ? (
                          <button type="button" className="text-muted-foreground underline" onClick={() => setOpen(r.id)}>Record why…</button>
                        ) : null}
                        {open === r.id && <RecordWhy row={r} onDone={() => { setOpen(null); router.refresh(); }} />}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 align-top text-xs">
                    {r.author ?? "—"} → {r.mergedBy ?? "—"}
                  </td>
                  <td className="px-4 py-2 align-top text-xs">
                    {r.approvers.length ? r.approvers.join(", ") : <span className={r.reason ? "text-muted-foreground" : "text-destructive"}>nobody else</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="card text-sm text-muted-foreground">{only === "unreviewed" ? "Every merged change had an independent approval." : "No merged changes in the last 90 days."}</p>
      )}
    </div>
  );
}

// --------------------------------------------------------- vulnerabilities

const SEV: Record<string, BadgeVariant> = { critical: "critical", high: "high", medium: "warning", moderate: "warning", low: "neutral" };

function Vulnerabilities({ view }: { view: ProviderView }) {
  const a = view.alerts!;
  const overdue = a.rows.filter((r) => r.overdue).length;
  return (
    <div className="space-y-4">
      <section className="card space-y-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div><span className="text-2xl font-semibold">{a.rows.length}</span> <span className="text-muted-foreground">open alerts</span></div>
          <div><span className="text-2xl font-semibold text-destructive">{overdue}</span> <span className="text-muted-foreground">past your fix-by SLA</span></div>
        </div>
        <p className="text-xs text-muted-foreground">{a.note}</p>
      </section>
      {a.rows.length ? (
        <section className="card p-0">
          <ul className="divide-y divide-border">
            {a.rows.slice(0, 300).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <Badge variant={SEV[r.severity] ?? "neutral"}>{r.severity}</Badge>
                <span className="text-xs text-muted-foreground">{r.kind}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{r.repo}</span> · {r.title}
                </span>
                <span className={`text-xs tabular-nums ${r.overdue ? "text-destructive" : "text-muted-foreground"}`}>
                  open {r.ageDays} {r.ageDays === 1 ? "day" : "days"}
                  {r.overdue ? " · past SLA" : ""}
                </span>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open in GitHub">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="card text-sm text-muted-foreground">No open alerts. 🎉</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- settings

function Settings({ view, fields, canWrite }: { view: ProviderView; fields: SettingField[]; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, String(view.settings?.[f.key] ?? "")])));
  const [busy, setBusy] = useState(false);
  const save: Action | undefined = SAVE_SETTINGS[view.provider];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!save) return;
    setBusy(true);
    const r = await save(Object.fromEntries(fields.map((f) => [f.key, Number(values[f.key])]))).catch(() => ({ error: NETWORK }) as ActionResult);
    setBusy(false);
    if (r.error) return toast("error", r.error);
    toast("success", "Saved — applies from the next scan");
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="card max-w-xl space-y-4">
      {fields.map((f) => (
        <label key={f.key} className="block space-y-1 text-sm">
          <span className="font-medium">{f.label}</span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={f.min}
              max={f.max}
              required
              disabled={!canWrite}
              value={values[f.key]}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              className="input w-24"
            />
            <span className="text-muted-foreground">{f.unit}</span>
          </span>
          <span className="block text-xs text-muted-foreground">{f.help}</span>
        </label>
      ))}
      {canWrite && <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>}
    </form>
  );
}
