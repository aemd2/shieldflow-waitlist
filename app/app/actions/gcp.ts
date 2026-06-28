"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { validateServiceAccount, fetchProjectSecurity, GcpError } from "@/lib/gcp";
import { gcpSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/audit";
import { fileIntegrationCsv, disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync } from "@/lib/checks";
import { encryptSecret, decryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

export async function connectGcp(input: { serviceAccountJson: string }) {
  const parsed = gcpSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

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
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  let projectId: string;
  try {
    projectId = await validateServiceAccount(parsed.data.serviceAccountJson);
  } catch (err) {
    return { error: err instanceof GcpError ? err.userMessage : "Couldn't reach Google Cloud." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "gcp",
      access_token: encryptSecret(parsed.data.serviceAccountJson),
      status: "connected",
      connected_by: user.id,
      metadata: { project: projectId },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "gcp",
    label: INTEGRATION_LABELS.gcp,
    metadata: { project: projectId },
  });

  revalidatePath("/integrations");
  return { ok: true, project: projectId };
}

export async function syncGcp() {
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
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };

  if (!checkRateLimit(`gcp-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, status")
    .eq("company_id", company.id)
    .eq("provider", "gcp")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "Google Cloud isn't connected yet." };
  }

  let serviceAccountJson: string;
  try {
    serviceAccountJson = decryptSecret(integ.access_token);
  } catch {
    return { error: "Stored Google Cloud key is unreadable — please reconnect." };
  }

  try {
    const r = await fetchProjectSecurity(serviceAccountJson);
    const csv = [
      `# Google Cloud IAM exposure report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Project: ${r.projectId}`,
      `# Summary: ${r.owners} owner members | ${r.editors} editor members | ${r.totalBindings} role bindings`,
      ``,
      `metric,value`,
      `Project ID,${r.projectId}`,
      `Members with roles/owner,${r.owners}`,
      `Members with roles/editor,${r.editors}`,
      `Total IAM role bindings,${r.totalBindings}`,
    ].join("\n");

    const filed = await fileIntegrationCsv({
      supabase,
      companyId: company.id,
      userId: user.id,
      integrationId: integ.id,
      fileBase: "gcp-iam-exposure",
      csv,
      note: `Automated GCP sync (project ${r.projectId}): ${r.owners} owners, ${r.editors} editors.`,
    });
    if (filed.error) return { error: filed.error };

    await recordChecksForSync(supabase, company.id, "gcp", r, filed.evidenceId ?? null);

    revalidatePath("/integrations");
    revalidatePath("/evidence");
    revalidatePath("/dashboard");
    return { ok: true, summary: { owners: r.owners, editors: r.editors } };
  } catch (err) {
    if (err instanceof GcpError) {
      if (err.kind === "auth") {
        await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
        revalidatePath("/integrations");
      }
      return { error: err.userMessage };
    }
    return { error: "Sync failed. Please try again." };
  }
}

export async function disconnectGcp() {
  return disconnectProvider("gcp");
}
