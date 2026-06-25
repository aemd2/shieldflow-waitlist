"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { validateCredentials, fetchAccountSecurity, AwsError } from "@/lib/aws";
import { awsCredentialsSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync, clearChecksForProvider } from "@/lib/checks";
import { encryptSecret, decryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";
import { newUuid } from "@/lib/uuid";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

/**
 * Connect AWS with a read-only IAM access key. Shape-checked, then live-validated
 * via STS GetCallerIdentity — the row is only written after AWS accepts the key.
 * Both key parts are stored together in access_token (never returned to the client);
 * only the account ID is surfaced (in metadata).
 */
export async function connectAWS(input: { accessKeyId: string; secretAccessKey: string }) {
  const parsed = awsCredentialsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid credentials." };
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  let accountId: string;
  try {
    accountId = await validateCredentials(parsed.data.accessKeyId, parsed.data.secretAccessKey);
  } catch (err) {
    return { error: err instanceof AwsError ? err.userMessage : "Couldn't reach AWS." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "aws",
      access_token: encryptSecret(
        JSON.stringify({
          keyId: parsed.data.accessKeyId,
          secret: parsed.data.secretAccessKey,
        }),
      ),
      status: "connected",
      connected_by: user.id,
      metadata: { account_id: accountId },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "aws",
    label: INTEGRATION_LABELS.aws,
    metadata: { account_id: accountId },
  });

  revalidatePath("/integrations");
  return { ok: true, accountId };
}

/** Pull an account-security report (root MFA, users, password policy) and file it as evidence. */
export async function syncAWS() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };

  if (!checkRateLimit(`aws-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, status")
    .eq("company_id", company.id)
    .eq("provider", "aws")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "AWS isn't connected yet." };
  }

  let creds: { keyId: string; secret: string };
  try {
    creds = JSON.parse(decryptSecret(integ.access_token));
  } catch {
    return { error: "Stored AWS credentials are corrupt — please reconnect." };
  }

  try {
    const r = await fetchAccountSecurity(creds.keyId, creds.secret);
    const pp = r.passwordPolicy;
    const yn = (b: boolean) => (b ? "Yes" : "No");

    const lines = [
      `# AWS account security report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Account: ${r.accountId}`,
      `# Summary: root MFA ${r.rootMfaEnabled ? "enabled" : "DISABLED"} | ${r.users} IAM users | ${r.mfaDevicesInUse} MFA devices in use | password policy ${pp ? "set" : "NOT set"}`,
      ``,
      `metric,value`,
      `Account ID,${csvSafe(r.accountId)}`,
      `Root account MFA,${r.rootMfaEnabled ? "Enabled" : "DISABLED"}`,
      `IAM users,${r.users}`,
      `MFA devices,${r.mfaDevices}`,
      `MFA devices in use,${r.mfaDevicesInUse}`,
      `Password policy,${pp ? "Set" : "NOT SET"}`,
      `Minimum password length,${pp?.minimumLength ?? "—"}`,
      `Require symbols,${pp ? yn(pp.requireSymbols) : "—"}`,
      `Require numbers,${pp ? yn(pp.requireNumbers) : "—"}`,
      `Require uppercase,${pp ? yn(pp.requireUppercase) : "—"}`,
      `Require lowercase,${pp ? yn(pp.requireLowercase) : "—"}`,
      `Max password age (days),${pp?.maxPasswordAge ?? "—"}`,
      `Password reuse prevention,${pp?.reusePrevention ?? "—"}`,
    ];
    const csv = lines.join("\n");
    const fileName = `aws-account-security-${new Date().toISOString().slice(0, 10)}.csv`;
    const path = `${company.id}/integrations/${newUuid()}-${fileName}`;

    const { error: upErr } = await supabase.storage
      .from("evidence")
      .upload(path, new Blob([csv], { type: "text/csv" }), {
        contentType: "text/csv",
        upsert: false,
      });
    if (upErr) return { error: "Could not store the report. Please try again." };

    const { data: inserted, error: insErr } = await supabase
      .from("evidence")
      .insert({
        company_id: company.id,
        control_id: null,
        file_name: fileName,
        storage_path: path,
        mime_type: "text/csv",
        size_bytes: csv.length,
        note: `Automated AWS sync (account ${r.accountId}): root MFA ${r.rootMfaEnabled ? "on" : "OFF"}, ${r.users} users, password policy ${pp ? "set" : "missing"}.`,
        uploaded_by: user.id,
      })
      .select("id")
      .single();
    if (insErr) {
      await supabase.storage.from("evidence").remove([path]);
      return { error: "Could not save the evidence record. Please try again." };
    }

    await supabase
      .from("integrations")
      .update({ last_synced_at: new Date().toISOString(), status: "connected" })
      .eq("id", integ.id);

    await recordChecksForSync(supabase, company.id, "aws", r, inserted?.id ?? null);

    revalidatePath("/integrations");
    revalidatePath("/evidence");
    revalidatePath("/dashboard");
    return {
      ok: true,
      summary: {
        rootMfa: r.rootMfaEnabled,
        users: r.users,
        passwordPolicy: Boolean(pp),
      },
    };
  } catch (err) {
    if (err instanceof AwsError) {
      if (err.kind === "auth") {
        await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
        revalidatePath("/integrations");
      }
      return { error: err.userMessage };
    }
    return { error: "Sync failed. Please try again." };
  }
}

export async function disconnectAWS() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };

  const { error } = await supabase
    .from("integrations")
    .delete()
    .eq("company_id", company.id)
    .eq("provider", "aws");
  if (error) return { error: "Could not disconnect. Please try again." };

  await clearChecksForProvider(supabase, company.id, "aws");

  await logEvent(supabase, company.id, "integration.disconnected", {
    type: "integration",
    id: "aws",
    label: INTEGRATION_LABELS.aws,
  });

  revalidatePath("/integrations");
  revalidatePath("/dashboard");
  return { ok: true };
}
