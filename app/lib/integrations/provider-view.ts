import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckOutcome } from "@/lib/checks-core";
import { isProviderScan, settingsOf } from "@/lib/integrations/scan-store";
import type { ProviderEntry } from "@/lib/integrations/registry";
import { GITHUB_DEFAULTS, type GitHubExtra } from "@/lib/integrations/github/scan";
import { prResourceId } from "@/lib/integrations/github/evaluate";
import { GOOGLE_DEFAULTS, type GoogleExtra } from "@/lib/integrations/google/scan";
import { appResource, isLive } from "@/lib/integrations/google/evaluate";
import { riskyScopes } from "@/lib/integrations/google/catalog";

/**
 * Everything one integration page shows, built on the server from the last scan
 * (integrations.last_scan) and the workspace's own records. Sections a provider
 * doesn't have are null and their tab isn't shown.
 */

export type PersonMatch = "leaver" | "unknown" | "matched" | "dismissed" | "bot" | "inactive";

export interface PersonRowView {
  /** The account at the provider ("octocat"), as stored in identity_links. */
  account: string;
  /** The key the leaver / unknown-login checks use ("github:octocat" or an email). */
  subject: string;
  name: string | null;
  role: string;
  where: string;
  /** Short facts shown under the role ("2FA off", "outside collaborator"). */
  flags: { label: string; bad: boolean }[];
  match: PersonMatch;
  person: { name: string; email: string; endedAt: string | null } | null;
  linked: boolean;
}

export interface ChangeRowView {
  id: string;
  resourceId: string;
  repo: string;
  number: number;
  title: string;
  url: string | null;
  author: string | null;
  mergedBy: string | null;
  mergedAt: string;
  approvers: string[];
  independent: boolean;
  ticket: string | null;
  /** Recorded reason if it was accepted as an emergency change. */
  reason: string | null;
}

export interface AlertRowView {
  id: string;
  kind: string;
  repo: string;
  severity: string;
  title: string;
  createdAt: string;
  url: string | null;
  ageDays: number;
  /** Past the workspace SLA for its severity. */
  overdue: boolean;
}

export interface AppRowView {
  clientId: string;
  resourceId: string;
  name: string;
  /** What it can reach that matters ("Gmail", "all of Drive"); empty = nothing sensitive. */
  risky: string[];
  scopes: string[];
  people: number;
  sample: string[];
  lastAuthorized: string;
  /** Recorded approval reason (an exception on google.oauth_apps). */
  approved: string | null;
  inVendors: boolean;
}

export interface ProviderView {
  provider: string;
  status: "connected" | "error" | "disconnected" | null;
  lastSyncedAt: string | null;
  account: string | null;
  connection: string | null;
  scan: { scannedAt: string; durationMs: number; results: CheckOutcome[]; summary: string[] } | null;
  exceptions: { id: string; checkKey: string; resourceId: string; label: string | null; reason: string; expiresAt: string | null; createdAt: string }[];
  people: { rows: PersonRowView[]; note: string; blindSpot: string | null; linkable: boolean } | null;
  apps: { rows: AppRowView[]; note: string; missing: string | null } | null;
  changes: { rows: ChangeRowView[]; windowDays: number; note: string } | null;
  alerts: { rows: AlertRowView[]; note: string } | null;
  settings: Record<string, number> | null;
  /** Personnel with an email, for the "this account is…" picker. */
  personnel: { name: string; email: string; status: string }[];
}

const DAY = 86_400_000;
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export async function loadProviderView(db: SupabaseClient, companyId: string, entry: ProviderEntry): Promise<ProviderView> {
  const [{ data: integ }, { data: exc }, { data: personnel }, { data: dismissed }, { data: findings }, { data: links }] = await Promise.all([
    db.from("integrations").select("status, metadata, last_synced_at, last_scan").eq("company_id", companyId).eq("provider", entry.key).maybeSingle(),
    db
      .from("check_exceptions")
      .select("id, check_key, resource_id, label, reason, expires_at, created_at")
      .eq("company_id", companyId)
      .like("check_key", `${entry.checkPrefix}.%`)
      .order("created_at", { ascending: false }),
    db.from("personnel").select("name, email, status, ended_at").eq("company_id", companyId),
    db.from("identity_exceptions").select("email").eq("company_id", companyId),
    db
      .from("integration_findings")
      .select("check_key, result, detail, raw, observed_at")
      .eq("company_id", companyId)
      .in("check_key", [`${entry.checkPrefix}.offboarding_drift`, `${entry.checkPrefix}.untracked_accounts`])
      .order("observed_at", { ascending: false })
      .limit(20),
    db.from("identity_links").select("account, email").eq("company_id", companyId).eq("provider", entry.checkPrefix),
  ]);

  const meta = (integ?.metadata as Record<string, unknown> | null) ?? {};
  const exceptions = ((exc ?? []) as Record<string, unknown>[]).map((e) => ({
    id: e.id as string,
    checkKey: e.check_key as string,
    resourceId: e.resource_id as string,
    label: (e.label as string | null) ?? null,
    reason: e.reason as string,
    expiresAt: (e.expires_at as string | null) ?? null,
    createdAt: e.created_at as string,
  }));
  const staff = ((personnel ?? []) as { name: string; email: string | null; status: string; ended_at: string | null }[]).filter((p) => p.email);
  const byEmail = new Map(staff.map((p) => [norm(p.email), p]));
  const ignored = new Set(((dismissed ?? []) as { email: string }[]).map((d) => norm(d.email)));
  const linkedAccounts = new Set(((links ?? []) as { account: string }[]).map((l) => norm(l.account)));

  // The roster checks are computed after the scan (they need Personnel), so they
  // live in integration_findings, not in last_scan. Merge the latest of each in.
  const roster: CheckOutcome[] = [];
  const seen = new Set<string>();
  for (const f of (findings ?? []) as { check_key: string; result: CheckOutcome["result"]; detail: string | null }[]) {
    if (seen.has(f.check_key)) continue;
    seen.add(f.check_key);
    roster.push({ key: f.check_key, result: f.result, detail: f.detail ?? "", resources: [], failingCount: 0, accepted: [] });
  }

  const raw = integ?.last_scan as unknown;
  const scan = isProviderScan(raw) ? raw : null;
  const view: ProviderView = {
    provider: entry.key,
    status: (integ?.status as ProviderView["status"]) ?? null,
    lastSyncedAt: (integ?.last_synced_at as string | null) ?? null,
    account: (meta.login as string | undefined) ?? (meta.domain as string | undefined) ?? null,
    connection: (meta.connection as string | undefined) ?? null,
    scan: scan
      ? {
          scannedAt: scan.scannedAt,
          durationMs: scan.durationMs,
          results: [...scan.results.filter((r) => !seen.has(r.key)), ...roster],
          summary: [],
        }
      : null,
    exceptions,
    people: null,
    apps: null,
    changes: null,
    alerts: null,
    settings: null,
    personnel: staff.map((p) => ({ name: p.name, email: norm(p.email), status: p.status })).sort((a, b) => a.name.localeCompare(b.name)),
  };

  const matchOf = (subject: string, addresses: string[]): { match: PersonMatch; person: PersonRowView["person"] } => {
    const hit = addresses.map((a) => byEmail.get(norm(a))).find(Boolean);
    if (hit) {
      return {
        match: hit.status === "offboarded" ? "leaver" : "matched",
        person: { name: hit.name, email: norm(hit.email), endedAt: hit.ended_at },
      };
    }
    return { match: ignored.has(norm(subject)) ? "dismissed" : "unknown", person: null };
  };

  if (entry.key === "github" && scan) {
    const x = scan.extra as GitHubExtra;
    const settings = settingsOf(meta, GITHUB_DEFAULTS);
    view.settings = settings;
    const active = x.repos.filter((r) => !r.archived);
    view.scan!.summary = [
      `${active.length} ${active.length === 1 ? "repository" : "repositories"}${x.reposTruncated ? " (more not read)" : ""}`,
      `${active.filter((r) => r.protection?.prRequired).length} protected`,
      `${x.pulls.length} merged changes in ${settings.windowDays} days`,
      x.personal ? "personal account" : `${x.members.length} people`,
    ];

    // People
    if (!x.personal) {
      const rows: PersonRowView[] = x.members.map((m) => {
        const subject = `github:${m.login.toLowerCase()}`;
        const bot = /\[bot\]$|-bot$/i.test(m.login);
        const { match, person } = matchOf(subject, m.person ? [m.person] : []);
        const flags: PersonRowView["flags"] = [];
        if (m.twoFactor === false) flags.push({ label: "2FA off", bad: true });
        if (m.role === "outside") flags.push({ label: "outside collaborator", bad: false });
        return {
          account: m.login.toLowerCase(),
          subject,
          name: m.name,
          role: m.role === "owner" ? "Owner" : m.role === "outside" ? "Outside collaborator" : "Member",
          where: m.org,
          flags,
          match: bot && match === "unknown" ? "bot" : match,
          person,
          linked: linkedAccounts.has(m.login.toLowerCase()),
        };
      });
      const order: Record<PersonMatch, number> = { leaver: 0, unknown: 1, matched: 2, dismissed: 3, bot: 4, inactive: 5 };
      rows.sort((a, b) => order[a.match] - order[b.match] || a.account.localeCompare(b.account));
      view.people = {
        rows,
        note:
          "GitHub rarely shares a work email, so we match a login to Personnel by name or by a handle that fits exactly one person. Anything we can't place, you link once — every scan uses it from then on.",
        blindSpot: scan.roster?.blindSpot ?? null,
        linkable: true,
      };
    }

    // Changes: the stored population (kept beyond GitHub's own window), newest first.
    const since = new Date(Date.now() - 90 * DAY).toISOString();
    const { data: changes } = await db
      .from("code_changes")
      .select("id, repo, number, title, url, author, merged_by, merged_at, approvers, independent_approval, ticket")
      .eq("company_id", companyId)
      .eq("provider", "github")
      .gte("merged_at", since)
      .order("merged_at", { ascending: false })
      .limit(500);
    const reasons = new Map(exceptions.filter((e) => e.checkKey === "github.unreviewed_merges").map((e) => [e.resourceId, e.reason]));
    view.changes = {
      windowDays: settings.windowDays,
      note:
        "Every pull request merged into a default branch, with who approved it before the merge. This is the population an auditor samples for change management; each day's list is also filed as evidence on “Track every production change”.",
      rows: ((changes ?? []) as Record<string, unknown>[]).map((c) => {
        const resourceId = prResourceId(c.repo as string, c.number as number);
        return {
          id: c.id as string,
          resourceId,
          repo: c.repo as string,
          number: c.number as number,
          title: c.title as string,
          url: (c.url as string | null) ?? null,
          author: (c.author as string | null) ?? null,
          mergedBy: (c.merged_by as string | null) ?? null,
          mergedAt: c.merged_at as string,
          approvers: (c.approvers as string[] | null) ?? [],
          independent: Boolean(c.independent_approval),
          ticket: (c.ticket as string | null) ?? null,
          reason: reasons.get(resourceId) ?? null,
        };
      }),
    };

    // Vulnerabilities
    const now = Date.now();
    const sla: Record<string, number> = { critical: settings.criticalDays, high: settings.highDays };
    const alertRows: AlertRowView[] = [];
    const push = (kind: string, list: GitHubExtra["alerts"]["dependabot"] | null, slaApplies: boolean) => {
      for (const a of list ?? []) {
        const ageDays = Math.floor((now - Date.parse(a.createdAt)) / DAY);
        alertRows.push({
          id: `${kind}:${a.id}`,
          kind,
          repo: a.repo,
          severity: a.severity,
          title: a.title,
          createdAt: a.createdAt,
          url: a.url ?? null,
          ageDays,
          overdue: slaApplies && sla[a.severity] !== undefined && ageDays > sla[a.severity],
        });
      }
    };
    push("Leaked secret", x.alerts.secret, false);
    push("Dependabot", x.alerts.dependabot, true);
    push("Code scanning", x.alerts.code, false);
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, moderate: 2, low: 3 };
    alertRows.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (rank[a.severity] ?? 4) - (rank[b.severity] ?? 4) || b.ageDays - a.ageDays);
    view.alerts = {
      rows: alertRows,
      note: `Open alerts GitHub found in the repositories ShieldFlow can see. Dependabot SLA: critical within ${settings.criticalDays} days, high within ${settings.highDays}. ${
        x.alerts.secret === null ? "Secret scanning isn't available on these repositories. " : ""
      }${x.alerts.code === null ? "Code scanning isn't set up — that's fine, it's never required." : ""}`.trim(),
    };
  }

  if (entry.key === "google_workspace" && scan) {
    const x = scan.extra as GoogleExtra;
    const settings = settingsOf(meta, GOOGLE_DEFAULTS);
    view.settings = settings;
    view.account = x.domain;
    const live = x.users.filter(isLive);
    view.scan!.summary = [
      `${live.length} active accounts${x.truncated ? " (more not read)" : ""}`,
      `${live.filter((u) => u.enforced2sv).length} with 2-step verification enforced`,
      x.apps ? `${x.apps.length} third-party apps` : "apps not read",
    ];

    const now = Date.now();
    const rows: PersonRowView[] = x.users.map((u) => {
      const live = isLive(u);
      const { match, person } = matchOf(u.email, [u.email, ...u.aliases]);
      const flags: PersonRowView["flags"] = [];
      if (live && !u.enrolled2sv) flags.push({ label: "2-step verification off", bad: true });
      else if (live && !u.enforced2sv) flags.push({ label: "2-step verification not enforced", bad: true });
      if (u.suspended) flags.push({ label: "suspended", bad: false });
      if (u.archived) flags.push({ label: "archived", bad: false });
      const idle = u.lastLogin ? Math.floor((now - Date.parse(u.lastLogin)) / DAY) : null;
      flags.push({ label: idle === null ? "never signed in" : idle === 0 ? "signed in today" : `last sign-in ${idle} days ago`, bad: live && (idle === null || idle > settings.dormantDays) });
      return {
        account: u.email,
        subject: u.email,
        name: u.name,
        role: u.superAdmin ? "Super admin" : u.delegatedAdmin ? "Admin" : "User",
        where: u.orgUnit,
        flags,
        // A leaver whose account is suspended is done; a live one isn't.
        match: !live ? "inactive" : match,
        person,
        linked: false,
      };
    });
    const order: Record<PersonMatch, number> = { leaver: 0, unknown: 1, matched: 2, dismissed: 3, bot: 4, inactive: 5 };
    rows.sort((a, b) => order[a.match] - order[b.match] || a.account.localeCompare(b.account));
    view.people = {
      rows,
      note: "Matched to Personnel by email address, aliases included. Suspended and archived accounts can't sign in, so they never count as a leaver's access.",
      blindSpot: x.truncated ? "the directory is larger than one scan reads" : null,
      linkable: false,
    };

    const { data: vendors } = await db.from("vendors").select("name").eq("company_id", companyId);
    const vendorNames = new Set(((vendors ?? []) as { name: string }[]).map((v) => norm(v.name)));
    const approvals = new Map(exceptions.filter((e) => e.checkKey === "google.oauth_apps").map((e) => [e.resourceId, e.reason]));
    const domain = x.domain ?? "workspace";
    view.apps = {
      missing: x.apps === null ? x.appsError ?? "Reconnect Google Workspace once to read which apps people granted access to (adds read-only audit-log access)." : null,
      note: `Apps people signed into with their Google account and allowed to read data, from the last ${x.appsWindowDays} days of the audit log (grants revoked since are left out). Apps that can read mail or all of Drive are vendors holding your data.`,
      rows: (x.apps ?? [])
        .map((a) => {
          const resourceId = appResource(domain, a.clientId, a.name).id;
          return {
            clientId: a.clientId,
            resourceId,
            name: a.name,
            risky: riskyScopes(a.scopes),
            scopes: a.scopes,
            people: a.users.length,
            sample: a.users.slice(0, 5),
            lastAuthorized: a.lastAuthorized,
            approved: approvals.get(resourceId) ?? null,
            inVendors: vendorNames.has(norm(a.name)),
          };
        })
        .sort((a, b) => b.risky.length - a.risky.length || b.people - a.people),
    };
  }

  return view;
}
