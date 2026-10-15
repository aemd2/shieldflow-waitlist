"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertFeature, assertIntegrationSlot } from "@/lib/plan-server";
import { normalizeOktaHost, validateToken, fetchUserSecurity, OktaError } from "@/lib/okta";
import { oktaSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { fileIntegrationCsv, disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync } from "@/lib/checks";
import { scanWithCredentials, checksReportCsv } from "@/lib/integrations/token-actions";
import { scanOkta } from "@/lib/integrations/okta/scan";
import { OKTA_CHECKS } from "@/lib/integrations/okta/catalog";
import { csvRow } from "@/lib/evidence-population";
import { encryptSecret, decryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

export async function connectOkta(input: { domain: string; token: string }) {
  const parsed = oktaSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const host = normalizeOktaHost(parsed.data.domain);
  if (!host) return { error: "Enter your Okta domain, e.g. acme.okta.com." };

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
    (await assertIntegrationSlot(supabase, company.id, "okta"));
  if (denied) return { error: denied };
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  let org: string;
  try {
    org = await validateToken(host, parsed.data.token);
  } catch (err) {
    return { error: err instanceof OktaError ? err.userMessage : "Couldn't reach Okta." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "okta",
      access_token: encryptSecret(JSON.stringify({ host, token: parsed.data.token })),
      status: "connected",
      connected_by: user.id,
      metadata: { org },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "okta",
    label: INTEGRATION_LABELS.okta,
    metadata: { org },
  });

  revalidatePath("/integrations");
  return { ok: true, org };
}

export async function syncOkta() {
  return scanWithCredentials(
    "okta",
    OKTA_CHECKS,
    scanOkta,
    (scan, company) => {
      const users = scan.extra.users;
      const active = users.filter((u) => u.status === "ACTIVE");
      const mfa = active.filter((u) => u.factors?.length).length;
      return {
        csv: checksReportCsv("Okta", company, scan, OKTA_CHECKS, [
          csvRow("email", "status", "factors", "admin_roles", "last_sign_in"),
          ...users.map((u) => csvRow(u.email, u.status, u.factors === null ? "not read" : u.factors.join(" ") || "none", (u.roles ?? []).join(" "), u.lastLogin ?? "never")),
        ]),
        note: `Automated Okta scan: ${active.length} active users, ${mfa} with a second factor.`,
        summary: { users: users.length, mfa, mfaChecked: active.filter((u) => u.factors !== null).length },
      };
    },
  );
}

export async function disconnectOkta() {
  return disconnectProvider("okta");
}
