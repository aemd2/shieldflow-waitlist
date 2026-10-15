"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertFeature } from "@/lib/plan-server";
import { z } from "zod";
import { GoogleError, isGoogleConfigured } from "@/lib/google";
import { scanGoogle, type GoogleIntegrationRow } from "@/lib/integrations/google/scan";
import { isLive } from "@/lib/integrations/google/evaluate";
import { GOOGLE_CHECK_BY_KEY, riskyScopes } from "@/lib/integrations/google/catalog";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync, clearChecksForProvider } from "@/lib/checks";
import { newUuid } from "@/lib/uuid";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

/**
 * Pull a user-security report from Google Workspace and file it as evidence.
 * The report is a CSV (bucket-allowed mime) with a summary header — real,
 * auditor-friendly proof of 2FA enrollment and account hygiene.
 */
export async function syncGoogleWorkspace() {
  if (!isGoogleConfigured()) return { error: "Google integration isn't configured yet." };

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
    (await assertFeature(supabase, company.id, "integrations"));
  if (denied) return { error: denied };

  // Syncing hammers Google's API — once per minute per company is plenty.
  if (!checkRateLimit(`gws-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, company_id, access_token, refresh_token, token_expires_at, status, metadata")
    .eq("company_id", company.id)
    .eq("provider", "google_workspace")
    .maybeSingle();
  if (!integ || integ.status === "disconnected") {
    return { error: "Google Workspace isn't connected yet." };
  }

  try {
    const scan = await scanGoogle(supabase, integ as GoogleIntegrationRow);
    const users = scan.extra.users;
    const live = users.filter(isLive);
    const total = live.length;
    const with2fa = live.filter((u) => u.enrolled2sv).length;
    const enforced = live.filter((u) => u.enforced2sv).length;
    const admins = live.filter((u) => u.superAdmin || u.delegatedAdmin).length;
    const suspended = users.filter((u) => u.suspended).length;

    const lines = [
      `# Google Workspace user security report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Summary: ${total} active users | ${with2fa} with 2-step verification | ${enforced} enforced | ${admins} admins | ${suspended} suspended`,
      ``,
      `email,two_step_enrolled,two_step_enforced,super_admin,admin,suspended,archived,last_sign_in,org_unit`,
      ...users.map(
        (u) =>
          `${csvSafe(u.email)},${u.enrolled2sv ? "yes" : "no"},${u.enforced2sv ? "yes" : "no"},${u.superAdmin ? "yes" : "no"},${u.delegatedAdmin ? "yes" : "no"},${u.suspended ? "yes" : "no"},${u.archived ? "yes" : "no"},${u.lastLogin ?? "never"},${csvSafe(u.orgUnit)}`,
      ),
      ...(scan.extra.apps
        ? [
            ``,
            `# Third-party apps holding access (granted in the last ${scan.extra.appsWindowDays} days, not revoked)`,
            `app,client_id,people,mail_or_drive,scopes`,
            ...scan.extra.apps.map(
              (a) => `${csvSafe(a.name)},${csvSafe(a.clientId)},${a.users.length},${riskyScopes(a.scopes).join(" ") || "no"},${csvSafe(a.scopes.join(" "))}`,
            ),
          ]
        : []),
    ];
    const csv = lines.join("\n");
    const fileName = `gws-user-security-${new Date().toISOString().slice(0, 10)}.csv`;
    const path = `${company.id}/integrations/${newUuid()}-${fileName}`;

    let evidenceId: string | null = null;
    const { error: upErr } = await supabase.storage
      .from("evidence")
      .upload(path, new Blob([csv], { type: "text/csv" }), { contentType: "text/csv", upsert: false });
    if (!upErr) {
      const { data: inserted } = await supabase
        .from("evidence")
        .insert({
          company_id: company.id,
          control_id: null, // company-wide evidence, not tied to one control
          file_name: fileName,
          storage_path: path,
          mime_type: "text/csv",
          size_bytes: csv.length,
          note: `Automated Google Workspace scan: ${total} active users, ${with2fa} with 2-step verification (${enforced} enforced), ${admins} admins, ${suspended} suspended.`,
          uploaded_by: user.id,
        })
        .select("id")
        .single();
      evidenceId = (inserted?.id as string | undefined) ?? null;
    }

    await supabase
      .from("integrations")
      .update({ last_synced_at: new Date().toISOString(), status: "connected" })
      .eq("id", integ.id);

    await recordChecksForSync(supabase, company.id, "google", scan, evidenceId);

    revalidatePath("/integrations");
    revalidatePath("/integrations/google_workspace");
    revalidatePath("/evidence");
    revalidatePath("/dashboard");
    const counts = { pass: 0, fail: 0, inconclusive: 0 };
    for (const r of scan.results) if (!GOOGLE_CHECK_BY_KEY.get(r.key)?.informational) counts[r.result]++;
    return { ok: true, ...counts, summary: { total, with2fa, admins, suspended } };
  } catch (err) {
    if (err instanceof GoogleError) {
      if (err.kind === "auth") {
        await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
        revalidatePath("/integrations");
      }
      return { error: err.userMessage };
    }
    return { error: "Sync failed. Please try again." };
  }
}

const googleSettingsSchema = z.object({ dormantDays: z.number().int().min(30).max(365) }).partial();

/** Change the Google Workspace settings (dormant-account window); the rest stay as they were. */
export async function updateGoogleSettings(input: unknown) {
  const parsed = googleSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: "The dormant window must be 30–365 days." };
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const company = await getCompanyForUser(supabase, user.id).catch(() => null);
  if (!company) return { error: "No company found." };
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };
  const { data: integ } = await supabase.from("integrations").select("id, metadata").eq("company_id", company.id).eq("provider", "google_workspace").maybeSingle();
  if (!integ) return { error: "Google Workspace isn't connected yet." };
  const meta = (integ.metadata as Record<string, unknown> | null) ?? {};
  const current = (meta.settings as Record<string, unknown> | undefined) ?? {};
  const { error } = await supabase.from("integrations").update({ metadata: { ...meta, settings: { ...current, ...parsed.data } } }).eq("id", integ.id);
  if (error) return { error: DB_ERROR };
  revalidatePath("/integrations/google_workspace");
  return { ok: true };
}

export async function disconnectGoogleWorkspace() {
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

  const { error } = await supabase
    .from("integrations")
    .delete()
    .eq("company_id", company.id)
    .eq("provider", "google_workspace");
  if (error) return { error: "Could not disconnect. Please try again." };

  await clearChecksForProvider(supabase, company.id, "google");

  await logEvent(supabase, company.id, "integration.disconnected", {
    type: "integration",
    id: "google_workspace",
    label: INTEGRATION_LABELS.google_workspace,
  });

  revalidatePath("/integrations");
  revalidatePath("/dashboard");
  return { ok: true };
}
