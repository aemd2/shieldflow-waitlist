"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertFeature, assertIntegrationSlot } from "@/lib/plan-server";
import { normalizeJiraHost, validateCredentials, fetchProjects, JiraError } from "@/lib/jira";
import { jiraSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { fileIntegrationCsv, disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { encryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";
import { scanWithCredentials, checksReportCsv } from "@/lib/integrations/token-actions";
import { scanTracker, trackerChecks } from "@/lib/integrations/tickets/scan";
import { csvRow, fileMeasureCsv } from "@/lib/evidence-population";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

export async function connectJira(input: { site: string; email: string; token: string }) {
  const parsed = jiraSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const host = normalizeJiraHost(parsed.data.site);
  if (!host) return { error: "Enter your Jira site, e.g. your-company.atlassian.net." };

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
    (await assertIntegrationSlot(supabase, company.id, "jira"));
  if (denied) return { error: denied };
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  let account: string;
  try {
    account = await validateCredentials(host, parsed.data.email, parsed.data.token);
  } catch (err) {
    return { error: err instanceof JiraError ? err.userMessage : "Couldn't reach Jira." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "jira",
      access_token: encryptSecret(
        JSON.stringify({ host, email: parsed.data.email, token: parsed.data.token }),
      ),
      status: "connected",
      connected_by: user.id,
      metadata: { site: host, account },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "jira",
    label: INTEGRATION_LABELS.jira,
    metadata: { site: host },
  });

  revalidatePath("/integrations");
  return { ok: true, site: host };
}

export async function syncJira() {
  return scanWithCredentials(
    "jira",
    trackerChecks("jira"),
    (db, integ) => scanTracker(db, "jira", integ),
    (scan, company) => {
      const x = scan.extra;
      return {
        csv: checksReportCsv("Jira", company, scan, trackerChecks("jira"), [
          csvRow("incident", "title", "status", "created", "resolved", "url"),
          ...x.incidents.map((i) => csvRow(i.key, i.title, i.status, i.created, i.resolved, i.url)),
        ]),
        note: `Automated Jira scan: ${x.found} of ${x.checked} change tickets found, ${x.incidents.length} incidents in the last 12 months.`,
        summary: { tickets: x.found, checked: x.checked, incidents: x.incidents.length },
      };
    },
    async (db, companyId, userId, scan) => {
      if (!scan.extra.incidents.length) return;
      const day = new Date().toISOString().slice(0, 10);
      await fileMeasureCsv(
        db,
        companyId,
        userId,
        "incident-log",
        `jira-incidents-${day}.csv`,
        [
          csvRow(`# Incidents recorded in Jira, last 12 months — ${day}`),
          csvRow("incident", "title", "status", "created", "resolved", "url"),
          ...scan.extra.incidents.map((i) => csvRow(i.key, i.title, i.status, i.created, i.resolved, i.url)),
        ].join("\n"),
        "Generated from Jira by ShieldFlow: every ticket typed or labelled as an incident in the last 12 months — the population an auditor samples for incident response.",
      );
    },
  );
}

export async function disconnectJira() {
  return disconnectProvider("jira");
}
