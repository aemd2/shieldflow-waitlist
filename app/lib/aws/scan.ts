import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { AWS_CHECKS } from "@/lib/aws/catalog";
import { collectAccount } from "@/lib/aws/collect";
import { AwsAccessError, callerAccount, credentialsFor, sessionNameFor, type AwsAuth } from "@/lib/aws/credentials";
import { evaluateAccount, type ExceptionRow } from "@/lib/aws/evaluate";
import type { AccountScan, AwsCheckResult, AwsResource } from "@/lib/aws/types";

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
}

export const DEFAULT_LOG_RETENTION_DAYS = 365;
const ACCOUNT_BUDGET_MS = 40_000;

/** The workspace-level AWS settings live on the umbrella integrations row. */
export async function awsSettings(db: SupabaseClient, companyId: string) {
  const { data } = await db
    .from("integrations")
    .select("id, access_token, metadata")
    .eq("company_id", companyId)
    .eq("provider", "aws")
    .maybeSingle();
  const settings = ((data?.metadata as { settings?: { logRetentionDays?: number } } | null)?.settings ?? {}) as {
    logRetentionDays?: number;
  };
  return {
    umbrella: data as { id: string; access_token: string | null; metadata: Record<string, unknown> | null } | null,
    logRetentionDays: settings.logRetentionDays ?? DEFAULT_LOG_RETENTION_DAYS,
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
    .select("id, company_id, account_id, alias, auth_kind, role_arn, external_id, encrypted_key, in_scope, regions, status")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  return (data ?? []) as AwsAccountRow[];
}

function authFor(row: AwsAccountRow): AwsAuth {
  if (row.auth_kind === "role") {
    return { kind: "role", roleArn: row.role_arn!, externalId: row.external_id!, sessionName: sessionNameFor(row.company_id) };
  }
  const k = JSON.parse(decryptSecret(row.encrypted_key!)) as { keyId: string; secret: string };
  return { kind: "key", accessKeyId: k.keyId, secretAccessKey: k.secret };
}

async function scanOne(
  db: SupabaseClient,
  row: AwsAccountRow,
  exceptions: ExceptionRow[],
  logRetentionDays: number,
  budgetMs: number,
): Promise<{ scan: AccountScan | null; error: string | null }> {
  try {
    const creds = await credentialsFor(authFor(row));
    const posture = await collectAccount({ creds, accountId: row.account_id }, { regions: row.regions, budgetMs });
    const results = evaluateAccount(posture, { now: new Date(), exceptions, logRetentionDays });
    const inv = { instances: 0, volumes: 0, databases: 0, functions: 0, tables: 0, clusters: 0 };
    for (const r of Object.values(posture.regional)) {
      for (const k of Object.keys(inv) as (keyof typeof inv)[]) inv[k] += r.inventory[k];
    }
    const scan: AccountScan = {
      accountId: row.account_id,
      alias: posture.alias,
      scannedAt: posture.scannedAt,
      durationMs: posture.durationMs,
      regions: posture.regions,
      results,
      inventory: { ...inv, regions: posture.regions.scanned, buckets: posture.buckets.ok ? posture.buckets.data.length : 0 },
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
  const { umbrella, logRetentionDays } = await awsSettings(db, companyId);
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
  const accounts: AwsWorkspaceScan["accounts"] = [];
  for (let i = 0; i < rows.length; i += 3) {
    const batch = rows.slice(i, i + 3);
    const done = await Promise.all(batch.map((row) => scanOne(db, row, exceptions, logRetentionDays, budget)));
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
  return { accounts, rawChecks };
}
