import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { AWS_CHECKS } from "@/lib/aws/catalog";
import { collectAccount } from "@/lib/aws/collect";
import { AwsAccessError, callerAccount, credentialsFor, sessionNameFor, type AwsAuth } from "@/lib/aws/credentials";
import { evaluateAccount, type ExceptionRow } from "@/lib/aws/evaluate";
import { iamIdentities } from "@/lib/aws/people";
import { mergePeople, type WorkspacePeople } from "@/lib/aws/roster";
import { settingsFrom, type AwsSettings } from "@/lib/aws/settings";
import { dataStores } from "@/lib/aws/stores";
import { awsFacts, publishableFacts } from "@/lib/aws/facts";
import type { AccountPosture, AccountScan, AwsCheckResult, AwsResource, ChangeEvent, RestoreRecord } from "@/lib/aws/types";

/**
 * Scan every AWS account a workspace has connected, keep each account's full
 * results on its row (the AWS page reads those), and merge the in-scope accounts
 * into one verdict per check for the checks engine.
 *
 * Out-of-scope accounts (staging, dev) are scanned and shown, but never reach
 * control_checks: they can't raise an alert or hold back a measure.
 */

export interface AwsAccountRow {
  id: string;
  company_id: string;
  account_id: string;
  alias: string | null;
  auth_kind: "role" | "key";
  role_arn: string | null;
  external_id: string | null;
  encrypted_key: string | null;
  in_scope: boolean;
  regions: string[] | null;
  status: string;
  last_scan?: AccountScan | null;
}

export interface MergedCheck {
  checkKey: string;
  controlCodes: string[];
  result: AwsCheckResult["result"];
  detail: string;
  subjects?: string[];
  resources?: AwsResource[];
  failingCount?: number;
  costPerMonth?: number;
}

export interface AwsWorkspaceScan {
  accounts: { row: AwsAccountRow; scan: AccountScan | null; error: string | null }[];
  rawChecks: MergedCheck[];
  /** Everyone who can sign in to AWS, merged across accounts; null if no account's people could be read. */
  people: WorkspacePeople | null;
}

export { DEFAULT_LOG_RETENTION_DAYS, DEFAULT_RESTORE_TEST_DAYS, settingsFrom, type AwsSettings } from "@/lib/aws/settings";

const ACCOUNT_BUDGET_MS = 40_000;
const DAY = 86_400_000;
/** First read of console changes looks back this far; after that, from the last read. */
const FIRST_CHANGES_LOOKBACK_DAYS = 30;
const RESTORE_MEMORY_DAYS = 400;

/** The workspace-level AWS settings live on the umbrella integrations row. */
export async function awsSettings(db: SupabaseClient, companyId: string) {
  const { data } = await db
    .from("integrations")
    .select("id, access_token, metadata")
    .eq("company_id", companyId)
    .eq("provider", "aws")
    .maybeSingle();
  return {
    umbrella: data as { id: string; access_token: string | null; metadata: Record<string, unknown> | null } | null,
    ...settingsFrom(data?.metadata),
  };
}

/**
 * Connections made before aws_accounts existed kept their key on the umbrella
 * row. Lift it into an account row once; the key stays encrypted as it was.
 */
async function liftLegacyKey(
  db: SupabaseClient,
  companyId: string,
  umbrella: { id: string; access_token: string | null } | null,
): Promise<void> {
  if (!umbrella?.access_token) return;
  let creds: { keyId: string; secret: string };
  try {
    creds = JSON.parse(decryptSecret(umbrella.access_token));
  } catch {
    return;
  }
  const accountId = await callerAccount({ accessKeyId: creds.keyId, secretAccessKey: creds.secret });
  const { error } = await db.from("aws_accounts").upsert(
    {
      company_id: companyId,
      account_id: accountId,
      auth_kind: "key",
      encrypted_key: umbrella.access_token,
      in_scope: true,
    },
    { onConflict: "company_id,account_id", ignoreDuplicates: true },
  );
  if (!error) await db.from("integrations").update({ access_token: null }).eq("id", umbrella.id);
}

export async function loadAccounts(db: SupabaseClient, companyId: string): Promise<AwsAccountRow[]> {
  const { data } = await db
    .from("aws_accounts")
    .select("id, company_id, account_id, alias, auth_kind, role_arn, external_id, encrypted_key, in_scope, regions, status, last_scan")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  return (data ?? []) as AwsAccountRow[];
}

export function authFor(row: AwsAccountRow): AwsAuth {
  if (row.auth_kind === "role") {
    return { kind: "role", roleArn: row.role_arn!, externalId: row.external_id!, sessionName: sessionNameFor(row.company_id) };
  }
  const k = JSON.parse(decryptSecret(row.encrypted_key!)) as { keyId: string; secret: string };
  return { kind: "key", accessKeyId: k.keyId, secretAccessKey: k.secret };
}

/** Restores AWS will eventually forget: keep what we've seen, newest first. */
export function mergeRestores(previous: RestoreRecord[], fresh: RestoreRecord[], now: Date): RestoreRecord[] {
  const byId = new Map<string, RestoreRecord>();
  for (const r of [...previous, ...fresh]) if (r.id) byId.set(r.id, r);
  return [...byId.values()]
    .filter((r) => now.getTime() - Date.parse(r.at) <= RESTORE_MEMORY_DAYS * DAY)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 50);
}

/** Where to start reading console changes: just before the last read ended, or 30 days back the first time. */
export function changesSince(prev: AccountScan | null | undefined, now: Date): Date {
  const floor = now.getTime() - FIRST_CHANGES_LOOKBACK_DAYS * DAY;
  const until = prev?.changesCoverage?.until ? Date.parse(prev.changesCoverage.until) - 60 * 60_000 : floor;
  return new Date(Math.max(until, floor));
}

/** Extend the gap-free coverage window, or restart it if this read left a hole. */
export function nextCoverage(
  prev: AccountScan["changesCoverage"],
  changes: AccountPosture["changes"],
  since: Date,
): AccountScan["changesCoverage"] {
  if (!changes?.ok) return prev ?? null;
  const complete = Date.parse(changes.data.readFrom) <= since.getTime();
  const joins = prev && since.getTime() <= Date.parse(prev.until);
  return { from: complete && joins ? prev.from : changes.data.readFrom, until: changes.data.until };
}

async function recordChanges(db: SupabaseClient, row: AwsAccountRow, events: ChangeEvent[]): Promise<void> {
  if (!events.length) return;
  await db.from("aws_change_events").upsert(
    events.map((e) => ({
      company_id: row.company_id,
      account_id: e.accountId,
      region: e.region,
      event_id: e.eventId,
      event_time: e.at,
      event_name: e.name,
      event_source: e.source,
      principal: e.principal,
      via: e.via,
      resources: e.resources,
    })),
    { onConflict: "company_id,event_id", ignoreDuplicates: true },
  );
}

async function lastWeekOfChanges(db: SupabaseClient, row: AwsAccountRow, now: Date): Promise<ChangeEvent[]> {
  const { data } = await db
    .from("aws_change_events")
    .select("event_id, account_id, region, event_time, event_name, event_source, principal, via, resources")
    .eq("company_id", row.company_id)
    .eq("account_id", row.account_id)
    .gte("event_time", new Date(now.getTime() - 7 * DAY).toISOString())
    .order("event_time", { ascending: false })
    .limit(200);
  return (data ?? []).map((e) => ({
    eventId: e.event_id as string,
    accountId: e.account_id as string,
    region: e.region as string,
    at: new Date(e.event_time as string).toISOString(),
    name: e.event_name as string,
    source: e.event_source as string,
    principal: (e.principal as string | null) ?? null,
    via: e.via as "console" | "root",
    resources: (e.resources as string | null) ?? null,
  }));
}

async function scanOne(
  db: SupabaseClient,
  row: AwsAccountRow,
  exceptions: ExceptionRow[],
  settings: AwsSettings,
  targetAccounts: string[],
  budgetMs: number,
): Promise<{ scan: AccountScan | null; error: string | null }> {
  try {
    const now = new Date();
    const prev = row.last_scan ?? null;
    const since = row.in_scope ? changesSince(prev, now) : null;
    const creds = await credentialsFor(authFor(row));
    const posture = await collectAccount(
      { creds, accountId: row.account_id },
      { regions: row.regions, budgetMs, targetAccounts, changesSince: since, lookForRestores: row.in_scope },
    );

    // Manual changes: append to the store, then judge the last 7 days from it.
    let recentChanges: ChangeEvent[] | null | undefined;
    if (row.in_scope) {
      if (posture.changes?.ok) {
        await recordChanges(db, row, posture.changes.data.events);
        const stored = await lastWeekOfChanges(db, row, now);
        // If the insert didn't land (permissions), still judge what was just read.
        const ids = new Set(stored.map((e) => e.eventId));
        const weekAgo = now.getTime() - 7 * DAY;
        recentChanges = [...stored, ...posture.changes.data.events.filter((e) => !ids.has(e.eventId) && Date.parse(e.at) >= weekAgo)];
      } else {
        recentChanges = null;
      }
    }

    const fresh = [
      ...Object.values(posture.regional).flatMap((r) => (r.backup.ok ? r.backup.data.restores : [])),
      ...(posture.nativeRestores?.ok ? posture.nativeRestores.data : []),
    ];
    const restores = mergeRestores(prev?.restores ?? [], fresh, now);

    const results = evaluateAccount(posture, {
      now,
      exceptions,
      logRetentionDays: settings.logRetentionDays,
      restores,
      restoreTestDays: settings.restoreTestDays,
      residency: settings.residency,
      recentChanges,
    });

    const inv = { instances: 0, volumes: 0, databases: 0, functions: 0, tables: 0, clusters: 0 };
    const regionInventory: NonNullable<AccountScan["regionInventory"]> = {};
    for (const [region, r] of Object.entries(posture.regional)) {
      regionInventory[region] = r.inventory;
      for (const k of Object.keys(inv) as (keyof typeof inv)[]) inv[k] += r.inventory[k];
    }

    const ic = posture.identityCenter;
    const gaps: string[] = [];
    if (!ic.ok) gaps.push(`IAM Identity Center: ${ic.message}`);
    if (!posture.credentialReport.ok) gaps.push(`IAM users: ${posture.credentialReport.message}`);
    const scan: AccountScan = {
      accountId: row.account_id,
      alias: posture.alias,
      scannedAt: posture.scannedAt,
      durationMs: posture.durationMs,
      regions: posture.regions,
      results,
      inventory: { ...inv, regions: posture.regions.scanned, buckets: posture.buckets.ok ? posture.buckets.data.length : 0 },
      regionInventory,
      people: {
        identities: [
          ...(ic.ok && ic.data ? ic.data.users : []),
          ...(posture.credentialReport.ok
            ? iamIdentities(row.account_id, posture.credentialReport.data, posture.adminUsers.ok ? posture.adminUsers.data : null)
            : []),
        ],
        identityCenter: ic.ok && ic.data ? { region: ic.data.region, instanceArn: ic.data.instanceArn } : null,
        organization: posture.organization.ok ? posture.organization.data : null,
        truncated: Boolean(ic.ok && ic.data?.truncated),
        gaps,
      },
      restores,
      stores: dataStores(posture).slice(0, 500),
      restoreTestingPlans: Object.values(posture.regional).reduce((n, r) => n + (r.backup.ok ? r.backup.data.testingPlans : 0), 0),
      changesCoverage: since ? nextCoverage(prev?.changesCoverage ?? null, posture.changes, since) : (prev?.changesCoverage ?? null),
    };
    await db
      .from("aws_accounts")
      .update({
        alias: row.alias ?? posture.alias,
        last_scan: scan,
        last_synced_at: new Date().toISOString(),
        status: "connected",
        last_error: null,
      })
      .eq("id", row.id);
    return { scan, error: null };
  } catch (err) {
    const message = err instanceof AwsAccessError ? err.userMessage : "The scan failed. Please try again.";
    await db
      .from("aws_accounts")
      .update({ status: err instanceof AwsAccessError && err.kind === "auth" ? "error" : row.status, last_error: message })
      .eq("id", row.id);
    return { scan: null, error: message };
  }
}

const label = (scan: AccountScan) => scan.alias ?? scan.accountId;

/** One verdict per check across the in-scope accounts. */
export function mergeInScope(scans: AccountScan[]): MergedCheck[] {
  if (!scans.length) return [];
  const merged: MergedCheck[] = [];
  for (const def of AWS_CHECKS) {
    const per = scans
      .map((s) => ({ s, r: s.results.find((r) => r.key === def.key) }))
      .filter((x): x is { s: AccountScan; r: AwsCheckResult } => Boolean(x.r));
    if (!per.length) continue;
    const failing = per.filter((x) => x.r.result === "fail");
    const unsure = per.filter((x) => x.r.result === "inconclusive");
    const result: AwsCheckResult["result"] = failing.length ? "fail" : unsure.length ? "inconclusive" : "pass";
    const pick = failing.length ? failing : unsure.length ? unsure : per;
    const detail =
      per.length === 1
        ? pick[0].r.detail
        : result === "pass"
          ? `Passes in all ${per.length} accounts.`
          : pick.map((x) => `${label(x.s)}: ${x.r.detail}`).join(" ");
    const resources = failing.flatMap((x) => x.r.resources).slice(0, 50);
    const cost = per.reduce((n, x) => n + (x.r.costPerMonth ?? 0), 0);
    merged.push({
      checkKey: def.key,
      controlCodes: def.informational ? [] : def.controlCodes,
      result,
      detail,
      ...(resources.length ? { resources, subjects: resources.map((r) => r.label).slice(0, 20) } : {}),
      failingCount: failing.reduce((n, x) => n + x.r.failingCount, 0),
      ...(cost ? { costPerMonth: cost } : {}),
    });
  }
  return merged;
}

export async function scanWorkspace(
  db: SupabaseClient,
  companyId: string,
  opts: { budgetMs?: number } = {},
): Promise<AwsWorkspaceScan> {
  const { umbrella, ...settings } = await awsSettings(db, companyId);
  let rows = await loadAccounts(db, companyId);
  if (!rows.length && umbrella?.access_token) {
    await liftLegacyKey(db, companyId, umbrella);
    rows = await loadAccounts(db, companyId);
  }

  const { data: exc } = await db
    .from("check_exceptions")
    .select("check_key, resource_id, reason, expires_at")
    .eq("company_id", companyId)
    .like("check_key", "aws.%");
  const exceptions: ExceptionRow[] = (exc ?? []).map((e) => ({
    checkKey: e.check_key as string,
    resourceId: e.resource_id as string,
    reason: e.reason as string,
    expiresAt: (e.expires_at as string | null) ?? null,
  }));

  // Accounts scan side by side; each has the whole budget because they run in parallel.
  const budget = opts.budgetMs ?? ACCOUNT_BUDGET_MS;
  const targetAccounts = rows.map((r) => r.account_id);
  const accounts: AwsWorkspaceScan["accounts"] = [];
  for (let i = 0; i < rows.length; i += 3) {
    const batch = rows.slice(i, i + 3);
    const done = await Promise.all(batch.map((row) => scanOne(db, row, exceptions, settings, targetAccounts, budget)));
    batch.forEach((row, j) => accounts.push({ row, ...done[j] }));
  }

  const inScopeRows = accounts.filter((a) => a.row.in_scope);
  const scanned = inScopeRows.filter((a) => a.scan).map((a) => a.scan!);
  const failed = inScopeRows.filter((a) => !a.scan);

  // Nothing in scope could be read at all: throw, so the caller keeps the last
  // verdicts (and flags the connection) instead of wiping every AWS check.
  if (inScopeRows.length && !scanned.length) {
    const authProblem = failed.some((a) => /couldn't assume|rejected/i.test(a.error ?? ""));
    throw new AwsAccessError(authProblem ? "auth" : "unavailable", failed[0]?.error ?? "The AWS scan failed.");
  }

  const rawChecks = mergeInScope(scanned);
  // An in-scope account that couldn't be scanned must not let its checks look
  // passed — downgrade every pass to inconclusive and say which account.
  if (failed.length) {
    const who = failed.map((a) => a.row.alias ?? a.row.account_id).join(", ");
    for (const c of rawChecks) {
      if (c.result === "pass") {
        c.result = "inconclusive";
        c.detail = `${c.detail} Not verified in ${who}: ${failed[0].error}`;
      }
    }
  }

  const people = mergePeople(
    accounts.map((a) => ({ scan: a.scan, inScope: a.row.in_scope, error: a.error, label: a.row.alias ?? a.row.account_id })),
  );

  // The true facts, refreshed every scan, for the Trust Center (served only if
  // the company opted in). A fact that stops being true drops off at once.
  if (umbrella) {
    try {
      const published = publishableFacts(awsFacts(scanned, people, settings));
      const { data: fresh } = await db.from("integrations").select("metadata").eq("id", umbrella.id).maybeSingle();
      await db
        .from("integrations")
        .update({ metadata: { ...((fresh?.metadata as Record<string, unknown> | null) ?? {}), published_facts: published } })
        .eq("id", umbrella.id);
    } catch {
      // Publishing is a convenience; the scan's results stand without it.
    }
  }
  return { accounts, rawChecks, people };
}
