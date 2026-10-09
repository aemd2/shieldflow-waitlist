import type { SupabaseClient } from "@supabase/supabase-js";
import { AWS_CHECK_BY_KEY } from "@/lib/aws/catalog";
import { resourceId } from "@/lib/aws/evaluate";
import { awsFacts, type AwsFacts } from "@/lib/aws/facts";
import { addressesFor, mergePeople, peopleBlindSpot, productionGrants, type IdentityCenterState } from "@/lib/aws/roster";
import { settingsFrom, type AwsSettings } from "@/lib/aws/settings";
import type { AccountScan, DataStore, RestoreRecord } from "@/lib/aws/types";

/**
 * What the AWS screens read: each connected account with its last scan, the
 * workspace's out-of-scope decisions and settings, and the workspace-wide
 * views — people, console changes, backups, facts. No AWS calls here: scanning
 * happens in syncs, pages only read the results.
 */

export interface AwsAccountView {
  id: string;
  accountId: string;
  alias: string | null;
  authKind: "role" | "key";
  inScope: boolean;
  regions: string[] | null;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  scan: AccountScan | null;
  /** Gating checks failing in the last scan (informational ones excluded). */
  failing: number;
  checks: number;
}

export interface CheckExceptionView {
  id: string;
  checkKey: string;
  resourceId: string;
  label: string | null;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface PersonRow {
  id: string;
  kind: "sso" | "iam";
  name: string;
  email: string | null;
  active: boolean;
  console: boolean;
  keys: number;
  mfa: boolean | null;
  lastUsed: string | null;
  grants: { account: string; role: string; admin: boolean; via: string | null; production: boolean }[];
  /** How this login lines up with Personnel. */
  match: "matched" | "leaver" | "unknown" | "machine" | "dismissed" | "inactive";
  person: { name: string; endedAt: string | null } | null;
}

export interface ChangeRow {
  id: string;
  resourceId: string;
  account: string;
  region: string;
  at: string;
  name: string;
  source: string;
  principal: string | null;
  via: "console" | "root";
  resources: string | null;
  /** Why it was done by hand, if someone recorded it. */
  reason: string | null;
}

export interface AwsView {
  connected: boolean;
  accounts: AwsAccountView[];
  exceptions: CheckExceptionView[];
  logRetentionDays: number;
  settings: AwsSettings;
  people: {
    rows: PersonRow[];
    identityCenter: IdentityCenterState;
    blindSpot: string | null;
    production: number;
    admins: number;
  } | null;
  /** Latest verdicts of the workspace-wide checks (leavers, unknown logins). */
  workspaceChecks: { key: string; result: string; detail: string | null }[];
  changes: ChangeRow[];
  changesCoverage: { account: string; from: string; until: string }[];
  backups: {
    stores: (DataStore & { account: string })[];
    restores: (RestoreRecord & { account: string })[];
    testingPlans: number;
  };
  facts: AwsFacts | null;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export async function loadAwsView(db: SupabaseClient, companyId: string): Promise<AwsView> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: umbrella }, { data: rows }, { data: exc }, { data: personnel }, { data: dismissed }, { data: findings }, { data: changes }] =
    await Promise.all([
      db.from("integrations").select("status, access_token, metadata, last_synced_at").eq("company_id", companyId).eq("provider", "aws").maybeSingle(),
      db
        .from("aws_accounts")
        .select("id, account_id, alias, auth_kind, in_scope, regions, status, last_error, last_synced_at, last_scan")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true }),
      db
        .from("check_exceptions")
        .select("id, check_key, resource_id, label, reason, expires_at, created_at")
        .eq("company_id", companyId)
        .like("check_key", "aws.%")
        .order("created_at", { ascending: false }),
      db.from("personnel").select("name, email, status, ended_at").eq("company_id", companyId),
      db.from("identity_exceptions").select("email").eq("company_id", companyId),
      db
        .from("integration_findings")
        .select("check_key, result, detail")
        .eq("company_id", companyId)
        .eq("provider", "aws")
        .in("check_key", ["aws.offboarding_drift", "aws.untracked_accounts"]),
      db
        .from("aws_change_events")
        .select("event_id, account_id, region, event_time, event_name, event_source, principal, via, resources")
        .eq("company_id", companyId)
        .gte("event_time", since)
        .order("event_time", { ascending: false })
        .limit(300),
    ]);

  const accounts: AwsAccountView[] = (rows ?? []).map((r) => {
    const scan = (r.last_scan as AccountScan | null) ?? null;
    const gating = (scan?.results ?? []).filter((x) => !AWS_CHECK_BY_KEY.get(x.key)?.informational);
    return {
      id: r.id as string,
      accountId: r.account_id as string,
      alias: (r.alias as string | null) ?? scan?.alias ?? null,
      authKind: r.auth_kind as "role" | "key",
      inScope: r.in_scope as boolean,
      regions: (r.regions as string[] | null) ?? null,
      status: r.status as string,
      lastError: (r.last_error as string | null) ?? null,
      lastSyncedAt: (r.last_synced_at as string | null) ?? null,
      scan,
      failing: gating.filter((x) => x.result === "fail").length,
      checks: gating.length,
    };
  });

  // Connected before accounts existed: the key still sits on the umbrella row
  // until the first scan moves it. Show it as an account so the screen doesn't
  // claim AWS isn't connected.
  if (!accounts.length && umbrella?.access_token) {
    accounts.push({
      id: "legacy",
      accountId: ((umbrella.metadata as { account_id?: string } | null)?.account_id ?? "connected") as string,
      alias: null,
      authKind: "key",
      inScope: true,
      regions: null,
      status: (umbrella.status as string) ?? "connected",
      lastError: null,
      lastSyncedAt: (umbrella.last_synced_at as string | null) ?? null,
      scan: null,
      failing: 0,
      checks: 0,
    });
  }

  const settings = settingsFrom(umbrella?.metadata);
  const exceptions: CheckExceptionView[] = (exc ?? []).map((e) => ({
    id: e.id as string,
    checkKey: e.check_key as string,
    resourceId: e.resource_id as string,
    label: (e.label as string | null) ?? null,
    reason: e.reason as string,
    expiresAt: (e.expires_at as string | null) ?? null,
    createdAt: e.created_at as string,
  }));
  const nameOf = new Map(accounts.map((a) => [a.accountId, a.alias ?? a.accountId]));
  const scanned = accounts.filter((a) => a.scan);
  const inScopeScans = scanned.filter((a) => a.inScope).map((a) => a.scan!);

  // ---------------------------------------------------------------- people
  const merged = mergePeople(scanned.map((a) => ({ scan: a.scan, inScope: a.inScope })));
  const staff = (personnel ?? []) as { name: string; email: string | null; status: string; ended_at: string | null }[];
  const ignored = new Set(((dismissed ?? []) as { email: string }[]).map((d) => norm(d.email)));
  const people: AwsView["people"] = merged
    ? (() => {
        const rows: PersonRow[] = merged.identities.map((i) => {
          const addresses = addressesFor(i, staff);
          const match = staff.find((p) => addresses.includes(norm(p.email)));
          const status: PersonRow["match"] = !i.active
            ? "inactive"
            : i.kind === "iam" && !i.console
              ? "machine"
              : match?.status === "offboarded"
                ? "leaver"
                : match
                  ? "matched"
                  : ignored.has(norm(i.email ?? i.name))
                    ? "dismissed"
                    : "unknown";
          const prod = new Set(productionGrants(i, merged.inScope));
          return {
            id: i.id,
            kind: i.kind,
            name: i.name,
            email: i.email,
            active: i.active,
            console: i.console,
            keys: i.keys,
            mfa: i.mfa,
            lastUsed: i.lastUsed,
            grants: i.access.map((g) => ({ account: nameOf.get(g.accountId) ?? g.accountId, role: g.role, admin: g.admin, via: g.via, production: prod.has(g) })),
            match: status,
            person: match ? { name: match.name, endedAt: match.ended_at } : null,
          };
        });
        const reach = rows.filter((r) => r.active && r.grants.some((g) => g.production));
        const order = { leaver: 0, unknown: 1, matched: 2, dismissed: 3, machine: 4, inactive: 5 } as const;
        rows.sort((a, b) => order[a.match] - order[b.match] || (a.email ?? a.name).localeCompare(b.email ?? b.name));
        return {
          rows,
          identityCenter: merged.identityCenter,
          blindSpot: peopleBlindSpot(merged),
          production: reach.length,
          admins: reach.filter((r) => r.grants.some((g) => g.production && g.admin)).length,
        };
      })()
    : null;

  // --------------------------------------------------------------- changes
  const reasons = new Map(exceptions.filter((e) => e.checkKey === "aws.manual_changes").map((e) => [e.resourceId, e.reason]));
  const changeRows: ChangeRow[] = (changes ?? []).map((c) => {
    const rid = resourceId(c.account_id as string, c.region as string, "change", c.event_id as string);
    return {
      id: c.event_id as string,
      resourceId: rid,
      account: nameOf.get(c.account_id as string) ?? (c.account_id as string),
      region: c.region as string,
      at: new Date(c.event_time as string).toISOString(),
      name: c.event_name as string,
      source: c.event_source as string,
      principal: (c.principal as string | null) ?? null,
      via: c.via as "console" | "root",
      resources: (c.resources as string | null) ?? null,
      reason: reasons.get(rid) ?? null,
    };
  });

  // --------------------------------------------------------------- backups
  const backups: AwsView["backups"] = {
    stores: scanned
      .filter((a) => a.inScope)
      .flatMap((a) => (a.scan!.stores ?? []).filter((s) => s.kind === "rds" || s.kind === "aurora" || s.kind === "dynamodb").map((s) => ({ ...s, account: a.alias ?? a.accountId }))),
    restores: scanned
      .flatMap((a) => (a.scan!.restores ?? []).map((r) => ({ ...r, account: a.alias ?? a.accountId })))
      .sort((x, y) => y.at.localeCompare(x.at)),
    testingPlans: scanned.reduce((n, a) => n + (a.scan!.restoreTestingPlans ?? 0), 0),
  };

  return {
    connected: Boolean(umbrella),
    accounts,
    exceptions,
    logRetentionDays: settings.logRetentionDays,
    settings,
    people,
    workspaceChecks: ((findings ?? []) as { check_key: string; result: string; detail: string | null }[]).map((f) => ({
      key: f.check_key,
      result: f.result,
      detail: f.detail,
    })),
    changes: changeRows,
    changesCoverage: scanned
      .filter((a) => a.inScope && a.scan!.changesCoverage)
      .map((a) => ({ account: a.alias ?? a.accountId, ...a.scan!.changesCoverage! })),
    backups,
    facts: inScopeScans.length ? awsFacts(inScopeScans, merged, settings) : null,
  };
}
