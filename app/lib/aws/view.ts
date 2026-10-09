import type { SupabaseClient } from "@supabase/supabase-js";
import { AWS_CHECK_BY_KEY } from "@/lib/aws/catalog";
import type { AccountScan } from "@/lib/aws/types";

/**
 * What the AWS screens read: each connected account with its last scan, the
 * workspace's out-of-scope decisions, and its AWS settings. No AWS calls here —
 * scanning happens in syncs, pages only read the results.
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

export interface AwsView {
  connected: boolean;
  accounts: AwsAccountView[];
  exceptions: CheckExceptionView[];
  logRetentionDays: number;
}

export async function loadAwsView(db: SupabaseClient, companyId: string): Promise<AwsView> {
  const [{ data: umbrella }, { data: rows }, { data: exc }] = await Promise.all([
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

  const settings = (umbrella?.metadata as { settings?: { logRetentionDays?: number } } | null)?.settings;
  return {
    connected: Boolean(umbrella),
    accounts,
    exceptions: (exc ?? []).map((e) => ({
      id: e.id as string,
      checkKey: e.check_key as string,
      resourceId: e.resource_id as string,
      label: (e.label as string | null) ?? null,
      reason: e.reason as string,
      expiresAt: (e.expires_at as string | null) ?? null,
      createdAt: e.created_at as string,
    })),
    logRetentionDays: settings?.logRetentionDays ?? 365,
  };
}
