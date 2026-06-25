import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { clearChecksForProvider } from "@/lib/checks";
import { newUuid } from "@/lib/uuid";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

/** Human-readable provider names for the activity trail (single source of truth). */
export const INTEGRATION_LABELS: Record<string, string> = {
  google_workspace: "Google Workspace",
  github: "GitHub",
  slack: "Slack",
  aws: "AWS",
  okta: "Okta",
  gitlab: "GitLab",
  jira: "Jira",
  linear: "Linear",
  cloudflare: "Cloudflare",
  gcp: "Google Cloud",
};

/**
 * Upload a CSV report to the evidence bucket, insert the evidence row (with
 * compensating cleanup if that fails), and stamp the integration's
 * last_synced_at. Shared by the token-paste integrations so the storage/evidence
 * plumbing lives in one audited place.
 */
export async function fileIntegrationCsv(opts: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  integrationId: string;
  fileBase: string; // e.g. "okta-identity-security"
  csv: string;
  note: string;
}): Promise<{ evidenceId?: string; error?: string }> {
  const { supabase, companyId, userId, integrationId, fileBase, csv, note } = opts;
  const fileName = `${fileBase}-${new Date().toISOString().slice(0, 10)}.csv`;
  const path = `${companyId}/integrations/${newUuid()}-${fileName}`;

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
      company_id: companyId,
      control_id: null,
      file_name: fileName,
      storage_path: path,
      mime_type: "text/csv",
      size_bytes: csv.length,
      note,
      uploaded_by: userId,
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
    .eq("id", integrationId);

  return { evidenceId: inserted?.id as string | undefined };
}

/** Shared disconnect: deletes the company's integration row for a provider. */
export async function disconnectProvider(
  provider: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    .eq("provider", provider);
  if (error) return { error: "Could not disconnect. Please try again." };

  // Clear this provider's automated checks so no stale "pass" lingers.
  await clearChecksForProvider(supabase, company.id, provider);

  await logEvent(supabase, company.id, "integration.disconnected", {
    type: "integration",
    id: provider,
    label: INTEGRATION_LABELS[provider] ?? provider,
  });

  revalidatePath("/integrations");
  revalidatePath("/dashboard");
  return { ok: true };
}
