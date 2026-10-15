"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertIntegrationSlot } from "@/lib/plan-server";
import { validateServiceAccount, GcpError } from "@/lib/gcp";
import { gcpSchema } from "@/lib/validation";
import { logEvent } from "@/lib/audit";
import { disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { scanWithCredentials, checksReportCsv } from "@/lib/integrations/token-actions";
import { scanGcp } from "@/lib/integrations/gcp/scan";
import { GCP_CHECKS } from "@/lib/integrations/gcp/catalog";
import { csvRow } from "@/lib/evidence-population";
import { encryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

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
  const denied =
    (await assertCanWrite(supabase, company.id, user.id)) ??
    (await assertIntegrationSlot(supabase, company.id, "gcp"));
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
  return scanWithCredentials(
    "gcp",
    GCP_CHECKS,
    scanGcp,
    (scan, company) => {
      const x = scan.extra;
      return {
        csv: checksReportCsv("Google Cloud", company, scan, GCP_CHECKS, [
          csvRow("project", "owners", "user_managed_keys", "buckets", "internet_facing_firewall_rules", "cloud_sql_instances"),
          ...x.projects.map((p) => csvRow(p.id, p.owners.map((o) => o.replace(/^\w+:/, "")).join(" "), p.keys?.length ?? "unknown", p.buckets?.length ?? "unknown", p.firewalls?.length ?? "unknown", p.sql?.length ?? "unknown")),
        ]),
        note: `Automated Google Cloud scan: ${x.projects.length} ${x.projects.length === 1 ? "project" : "projects"}.`,
        summary: { projects: x.projects.length, owners: x.projects.reduce((n, p) => n + p.owners.length, 0) },
      };
    },
  );
}

export async function disconnectGcp() {
  return disconnectProvider("gcp");
}
