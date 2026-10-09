"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { assertFeature, assertIntegrationSlot } from "@/lib/plan-server";
import { awsCredentialsSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync, clearChecksForProvider } from "@/lib/checks";
import { encryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";
import { newUuid } from "@/lib/uuid";
import {
  AwsAccessError,
  ROLE_ARN_RE,
  ROLE_NAME,
  callerAccount,
  credentialsFor,
  roleConnectAvailable,
  scannerAccountId,
  sessionNameFor,
} from "@/lib/aws/credentials";
import { AWS_CHECK_BY_KEY } from "@/lib/aws/catalog";
import { cliCommands, cloudFormationQuickCreateUrl, terraformSnippet, TEMPLATE_VERSION } from "@/lib/aws/role";
import { scanWorkspace, loadAccounts, awsSettings, type AwsWorkspaceScan } from "@/lib/aws/scan";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

type Writer =
  | { ok: false; error: string }
  | { ok: true; supabase: SupabaseClient; user: { id: string }; company: Company };

/** Signed in, has a workspace, may write to it. Never returns the client on failure. */
async function writer(): Promise<Writer> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  let company: Company | null;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { ok: false, error: DB_ERROR };
  }
  if (!company) return { ok: false, error: "No company found." };
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { ok: false, error: denied };
  return { ok: true, supabase, user, company };
}

/** The umbrella `integrations` row — plan slot, card status, cron selection. */
async function ensureUmbrella(supabase: SupabaseClient, companyId: string, userId: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from("integrations")
    .select("id, metadata")
    .eq("company_id", companyId)
    .eq("provider", "aws")
    .maybeSingle();
  if (!existing) {
    const denied = await assertIntegrationSlot(supabase, companyId, "aws");
    if (denied) return denied;
  }
  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: companyId,
      provider: "aws",
      status: "connected",
      connected_by: userId,
      metadata: existing?.metadata ?? {},
    },
    { onConflict: "company_id,provider" },
  );
  return error ? DB_ERROR : null;
}

/**
 * Step 1 of connecting by role: the workspace's External ID, issued once and
 * reused, plus everything the connect screen needs to show the three ways of
 * creating the role.
 */
export async function startAwsConnect() {
  const w = await writer();
  if (!w.ok) return { error: w.error };
  const { supabase, company } = w;

  let { data: req } = await supabase.from("aws_connect_requests").select("external_id").eq("company_id", company.id).maybeSingle();
  if (!req) {
    const externalId = `sf-${newUuid().replace(/-/g, "")}`;
    const { error } = await supabase.from("aws_connect_requests").insert({ company_id: company.id, external_id: externalId });
    if (error) return { error: DB_ERROR };
    req = { external_id: externalId };
  }
  const externalId = req.external_id as string;
  const scanner = scannerAccountId();
  return {
    ok: true as const,
    available: roleConnectAvailable(),
    externalId,
    scannerAccountId: scanner,
    roleName: ROLE_NAME,
    templateVersion: TEMPLATE_VERSION,
    // Generated here so the browser never loads the AWS SDK.
    terraform: scanner ? terraformSnippet(scanner, externalId) : null,
    cli: scanner ? cliCommands(scanner, externalId) : null,
    quickCreateUrl: scanner ? cloudFormationQuickCreateUrl(scanner, externalId) : null,
  };
}

const roleSchema = z.object({
  roleArn: z.string().trim().regex(ROLE_ARN_RE, "That doesn't look like a role ARN (arn:aws:iam::123456789012:role/ShieldFlowAudit)."),
  alias: z.string().trim().max(60).optional(),
  inScope: z.boolean().default(true),
});

/** Step 2: the customer pastes the role ARN; we assume it and add the account. */
export async function connectAwsRole(input: unknown) {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid role." };
  const w = await writer();
  if (!w.ok) return { error: w.error };
  const { supabase, user, company } = w;
  if (!roleConnectAvailable()) return { error: "Role connections aren't set up on this server yet — use an access key for now." };

  const { data: req } = await supabase.from("aws_connect_requests").select("external_id").eq("company_id", company.id).maybeSingle();
  if (!req) return { error: "Start the connection first, so your External ID exists." };

  const arnAccount = ROLE_ARN_RE.exec(parsed.data.roleArn)![1];
  let accountId: string;
  try {
    const creds = await credentialsFor({
      kind: "role",
      roleArn: parsed.data.roleArn,
      externalId: req.external_id as string,
      sessionName: sessionNameFor(company.id),
    });
    accountId = await callerAccount(creds);
  } catch (err) {
    return { error: err instanceof AwsAccessError ? err.userMessage : "Couldn't reach AWS." };
  }
  if (accountId !== arnAccount) return { error: "The role belongs to a different account than its ARN says." };

  const umbrellaError = await ensureUmbrella(supabase, company.id, user.id);
  if (umbrellaError) return { error: umbrellaError };

  const { error } = await supabase.from("aws_accounts").upsert(
    {
      company_id: company.id,
      account_id: accountId,
      alias: parsed.data.alias || null,
      auth_kind: "role",
      role_arn: parsed.data.roleArn,
      external_id: req.external_id,
      encrypted_key: null,
      in_scope: parsed.data.inScope,
      status: "connected",
      last_error: null,
      created_by: user.id,
    },
    { onConflict: "company_id,account_id" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "aws",
    label: INTEGRATION_LABELS.aws,
    metadata: { account_id: accountId, via: "role" },
  });
  revalidatePath("/integrations");
  return { ok: true, accountId };
}

/**
 * Legacy: connect with a read-only access key. Kept for customers who can't
 * create a role yet; the UI recommends upgrading.
 */
export async function connectAWS(input: { accessKeyId: string; secretAccessKey: string }) {
  const parsed = awsCredentialsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid credentials." };
  const w = await writer();
  if (!w.ok) return { error: w.error };
  const { supabase, user, company } = w;
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  let accountId: string;
  try {
    accountId = await callerAccount({ accessKeyId: parsed.data.accessKeyId, secretAccessKey: parsed.data.secretAccessKey });
  } catch (err) {
    return { error: err instanceof AwsAccessError ? err.userMessage : "Couldn't reach AWS." };
  }

  const umbrellaError = await ensureUmbrella(supabase, company.id, user.id);
  if (umbrellaError) return { error: umbrellaError };

  const { error } = await supabase.from("aws_accounts").upsert(
    {
      company_id: company.id,
      account_id: accountId,
      auth_kind: "key",
      encrypted_key: encryptSecret(JSON.stringify({ keyId: parsed.data.accessKeyId, secret: parsed.data.secretAccessKey })),
      role_arn: null,
      external_id: null,
      in_scope: true,
      status: "connected",
      last_error: null,
      created_by: user.id,
    },
    { onConflict: "company_id,account_id" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "aws",
    label: INTEGRATION_LABELS.aws,
    metadata: { account_id: accountId, via: "key" },
  });
  revalidatePath("/integrations");
  return { ok: true, accountId };
}

function reportCsv(company: Company, scan: AwsWorkspaceScan): string {
  const lines = [
    `# AWS security report`,
    `# Generated: ${new Date().toISOString()}`,
    `# Company: ${company.name}`,
    `# Accounts: ${scan.accounts.map((a) => `${a.row.alias ?? a.row.account_id}${a.row.in_scope ? "" : " (out of scope)"}`).join(", ")}`,
    ``,
    `account,in_scope,check,result,failing,resources,regions_scanned`,
  ];
  for (const a of scan.accounts) {
    if (!a.scan) {
      lines.push(`${csvSafe(a.row.account_id)},${a.row.in_scope},scan,error,,${csvSafe(a.error ?? "")},`);
      continue;
    }
    for (const r of a.scan.results) {
      lines.push(
        [
          csvSafe(a.row.account_id),
          a.row.in_scope,
          csvSafe(AWS_CHECK_BY_KEY.get(r.key)?.title ?? r.key),
          r.result,
          r.failingCount,
          csvSafe(r.resources.map((x) => x.label).join("; ")),
          csvSafe(a.scan.regions.scanned.join(" ")),
        ].join(","),
      );
    }
  }
  return lines.join("\n");
}

/** File the asset inventory once a day, on the asset-inventory measure (counts for every framework). */
async function fileInventory(supabase: SupabaseClient, company: Company, userId: string, scan: AwsWorkspaceScan) {
  const day = new Date().toISOString().slice(0, 10);
  const fileName = `aws-asset-inventory-${day}.csv`;
  const { data: measure } = await supabase.from("measures").select("id").eq("key", "asset-inventory").maybeSingle();
  if (!measure) return;
  const { count } = await supabase
    .from("evidence")
    .select("id", { count: "exact", head: true })
    .eq("company_id", company.id)
    .eq("file_name", fileName);
  if (count) return;
  const rows = [
    `# AWS asset inventory — ${day}`,
    `account,alias,in_scope,regions,instances,volumes,databases,functions,dynamodb_tables,eks_clusters,s3_buckets`,
    ...scan.accounts
      .filter((a) => a.scan)
      .map((a) => {
        const i = a.scan!.inventory;
        return [a.row.account_id, csvSafe(a.row.alias ?? a.scan!.alias ?? ""), a.row.in_scope, csvSafe(i.regions.join(" ")), i.instances, i.volumes, i.databases, i.functions, i.tables, i.clusters, i.buckets].join(",");
      }),
  ];
  const csv = rows.join("\n");
  const path = `${company.id}/integrations/${newUuid()}-${fileName}`;
  const { error } = await supabase.storage.from("evidence").upload(path, new Blob([csv], { type: "text/csv" }), { contentType: "text/csv" });
  if (error) return;
  await supabase.from("evidence").insert({
    company_id: company.id,
    measure_id: measure.id,
    file_name: fileName,
    storage_path: path,
    mime_type: "text/csv",
    size_bytes: csv.length,
    note: "Generated from AWS by ShieldFlow: what runs where, per account.",
    uploaded_by: userId,
  });
}

/** Scan every connected account now, record the checks, and file the report. */
export async function syncAWS() {
  const w = await writer();
  if (!w.ok) return { error: w.error };
  const { supabase, user, company } = w;
  const denied = await assertFeature(supabase, company.id, "integrations");
  if (denied) return { error: denied };
  if (!checkRateLimit(`aws-sync:${company.id}`, 1, 60_000)) return { error: "Already synced recently — try again in a minute." };

  const { umbrella } = await awsSettings(supabase, company.id);
  if (!umbrella) return { error: "AWS isn't connected yet." };

  let scan: AwsWorkspaceScan;
  try {
    scan = await scanWorkspace(supabase, company.id);
  } catch (err) {
    if (err instanceof AwsAccessError && err.kind === "auth") {
      await supabase.from("integrations").update({ status: "error" }).eq("id", umbrella.id);
    }
    revalidatePath("/integrations");
    return { error: err instanceof AwsAccessError ? err.userMessage : "The AWS scan failed. Please try again." };
  }
  if (!scan.accounts.length) return { error: "No AWS account is connected yet." };

  const csv = reportCsv(company, scan);
  const fileName = `aws-security-report-${new Date().toISOString().slice(0, 10)}.csv`;
  const path = `${company.id}/integrations/${newUuid()}-${fileName}`;
  let evidenceId: string | null = null;
  const { error: upErr } = await supabase.storage.from("evidence").upload(path, new Blob([csv], { type: "text/csv" }), { contentType: "text/csv" });
  if (!upErr) {
    const failing = scan.rawChecks.filter((c) => c.result === "fail").length;
    const { data: ev } = await supabase
      .from("evidence")
      .insert({
        company_id: company.id,
        control_id: null,
        file_name: fileName,
        storage_path: path,
        mime_type: "text/csv",
        size_bytes: csv.length,
        note: `Automated AWS scan of ${scan.accounts.length} ${scan.accounts.length === 1 ? "account" : "accounts"}: ${scan.rawChecks.length} checks, ${failing} failing.`,
        uploaded_by: user.id,
      })
      .select("id")
      .single();
    evidenceId = (ev?.id as string | undefined) ?? null;
  }
  await fileInventory(supabase, company, user.id, scan);

  await supabase.from("integrations").update({ last_synced_at: new Date().toISOString(), status: "connected" }).eq("id", umbrella.id);
  await recordChecksForSync(supabase, company.id, "aws", scan, evidenceId);

  revalidatePath("/integrations");
  revalidatePath("/integrations/aws");
  revalidatePath("/evidence");
  revalidatePath("/dashboard");
  const counts = { pass: 0, fail: 0, inconclusive: 0 };
  for (const c of scan.rawChecks) counts[c.result]++;
  return { ok: true, accounts: scan.accounts.length, ...counts, errors: scan.accounts.filter((a) => a.error).map((a) => a.error) };
}

const accountUpdateSchema = z.object({
  id: z.string().uuid(),
  alias: z.string().trim().max(60).nullable().optional(),
  inScope: z.boolean().optional(),
  regions: z.array(z.string().regex(/^[a-z]{2}(-gov)?-[a-z]+-\d$/)).max(30).nullable().optional(),
});

export async function updateAwsAccount(input: unknown) {
  const parsed = accountUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid change." };
  const w = await writer();
  if (!w.ok) return { error: w.error };
  const { supabase, company } = w;
  const patch: Record<string, unknown> = {};
  if (parsed.data.alias !== undefined) patch.alias = parsed.data.alias || null;
  if (parsed.data.inScope !== undefined) patch.in_scope = parsed.data.inScope;
  if (parsed.data.regions !== undefined) patch.regions = parsed.data.regions?.length ? parsed.data.regions : null;
  const { error } = await supabase.from("aws_accounts").update(patch).eq("company_id", company.id).eq("id", parsed.data.id);
  if (error) return { error: DB_ERROR };
  if (parsed.data.inScope !== undefined) {
    await logEvent(supabase, company.id, "integration.scope_changed", {
      type: "integration",
      id: "aws",
      label: INTEGRATION_LABELS.aws,
      metadata: { account: parsed.data.id, in_scope: parsed.data.inScope },
    });
  }
  revalidatePath("/integrations");
  revalidatePath("/integrations/aws");
  return { ok: true };
}

export async function updateAwsSettings(input: unknown) {
  const parsed = z.object({ logRetentionDays: z.number().int().min(30).max(3650) }).safeParse(input);
  if (!parsed.success) return { error: "Log retention must be between 30 and 3650 days." };
  const w = await writer();
  if (!w.ok) return { error: w.error };
  const { supabase, company } = w;
  const { umbrella } = await awsSettings(supabase, company.id);
  if (!umbrella) return { error: "AWS isn't connected yet." };
  const metadata = { ...(umbrella.metadata ?? {}), settings: { logRetentionDays: parsed.data.logRetentionDays } };
  const { error } = await supabase.from("integrations").update({ metadata }).eq("id", umbrella.id);
  if (error) return { error: DB_ERROR };
  revalidatePath("/integrations/aws");
  return { ok: true };
}

/** Remove one account. Removing the last one disconnects AWS entirely. */
export async function removeAwsAccount(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid account." };
  const w = await writer();
  if (!w.ok) return { error: w.error };
  const { supabase, company } = w;
  const { error } = await supabase.from("aws_accounts").delete().eq("company_id", company.id).eq("id", id);
  if (error) return { error: DB_ERROR };
  if (!(await loadAccounts(supabase, company.id)).length) return disconnectAWS();
  revalidatePath("/integrations");
  revalidatePath("/integrations/aws");
  return { ok: true };
}

export async function disconnectAWS() {
  const w = await writer();
  if (!w.ok) return { error: w.error };
  const { supabase, company } = w;
  await supabase.from("aws_accounts").delete().eq("company_id", company.id);
  const { error } = await supabase.from("integrations").delete().eq("company_id", company.id).eq("provider", "aws");
  if (error) return { error: "Could not disconnect. Please try again." };
  await clearChecksForProvider(supabase, company.id, "aws");
  await logEvent(supabase, company.id, "integration.disconnected", { type: "integration", id: "aws", label: INTEGRATION_LABELS.aws });
  revalidatePath("/integrations");
  revalidatePath("/integrations/aws");
  revalidatePath("/dashboard");
  return { ok: true };
}
