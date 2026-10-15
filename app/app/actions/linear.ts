"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertIntegrationSlot } from "@/lib/plan-server";
import { validateKey, LinearError } from "@/lib/linear";
import { linearTokenSchema } from "@/lib/validation";
import { logEvent } from "@/lib/audit";
import { disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { encryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";
import { scanWithCredentials, checksReportCsv } from "@/lib/integrations/token-actions";
import { scanTracker, trackerChecks } from "@/lib/integrations/tickets/scan";
import { csvRow, fileMeasureCsv } from "@/lib/evidence-population";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

export async function connectLinear(input: { token: string }) {
  const parsed = linearTokenSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid key." };

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
    (await assertIntegrationSlot(supabase, company.id, "linear"));
  if (denied) return { error: denied };
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  let who: string;
  try {
    who = await validateKey(parsed.data.token);
  } catch (err) {
    return { error: err instanceof LinearError ? err.userMessage : "Couldn't reach Linear." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "linear",
      access_token: encryptSecret(parsed.data.token),
      status: "connected",
      connected_by: user.id,
      metadata: { account: who },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "linear",
    label: INTEGRATION_LABELS.linear,
    metadata: { account: who },
  });

  revalidatePath("/integrations");
  return { ok: true, account: who };
}

export async function syncLinear() {
  return scanWithCredentials(
    "linear",
    trackerChecks("linear"),
    (db, integ) => scanTracker(db, "linear", integ),
    (scan, company) => {
      const x = scan.extra;
      return {
        csv: checksReportCsv("Linear", company, scan, trackerChecks("linear"), [
          csvRow("incident", "title", "status", "created", "resolved", "url"),
          ...x.incidents.map((i) => csvRow(i.key, i.title, i.status, i.created, i.resolved, i.url)),
        ]),
        note: `Automated Linear scan: ${x.found} of ${x.checked} change tickets found, ${x.incidents.length} incidents in the last 12 months.`,
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
        `linear-incidents-${day}.csv`,
        [
          csvRow(`# Incidents recorded in Linear, last 12 months — ${day}`),
          csvRow("incident", "title", "status", "created", "resolved", "url"),
          ...scan.extra.incidents.map((i) => csvRow(i.key, i.title, i.status, i.created, i.resolved, i.url)),
        ].join("\n"),
        "Generated from Linear by ShieldFlow: every ticket typed or labelled as an incident in the last 12 months — the population an auditor samples for incident response.",
      );
    },
  );
}

export async function disconnectLinear() {
  return disconnectProvider("linear");
}
