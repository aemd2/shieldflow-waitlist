"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import {
  fetchWorkspaceUsers,
  refreshAccessToken,
  GoogleError,
  isGoogleConfigured,
} from "@/lib/google";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync, clearChecksForProvider } from "@/lib/checks";
import { decryptSecret, encryptIfConfigured } from "@/lib/crypto";
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
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };

  // Syncing hammers Google's API — once per minute per company is plenty.
  if (!checkRateLimit(`gws-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, refresh_token, token_expires_at, status")
    .eq("company_id", company.id)
    .eq("provider", "google_workspace")
    .maybeSingle();
  if (!integ || integ.status === "disconnected") {
    return { error: "Google Workspace isn't connected yet." };
  }

  let accessToken: string;
  try {
    accessToken = decryptSecret(integ.access_token as string);
  } catch {
    return { error: "Stored Google credentials are unreadable — please reconnect." };
  }

  try {
    // Refresh if the token expires within the next minute.
    const expiresAt = integ.token_expires_at ? new Date(integ.token_expires_at).getTime() : 0;
    if (expiresAt < Date.now() + 60_000) {
      if (!integ.refresh_token) {
        throw new GoogleError("auth", "Google access expired. Please reconnect the integration.");
      }
      const fresh = await refreshAccessToken(decryptSecret(integ.refresh_token));
      accessToken = fresh.access_token;
      // Google occasionally omits expires_in — fall back to its standard 1h.
      const ttl = Number.isFinite(fresh.expires_in) ? fresh.expires_in : 3600;
      await supabase
        .from("integrations")
        .update({
          access_token: encryptIfConfigured(fresh.access_token),
          token_expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
          status: "connected",
        })
        .eq("id", integ.id);
    }

    const users = await fetchWorkspaceUsers(accessToken);

    const total = users.length;
    const with2fa = users.filter((u) => u.isEnrolledIn2Sv).length;
    const admins = users.filter((u) => u.isAdmin).length;
    const suspended = users.filter((u) => u.suspended).length;

    const lines = [
      `# Google Workspace user security report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Summary: ${total} users | ${with2fa} with 2FA (${total ? Math.round((with2fa / total) * 100) : 0}%) | ${admins} admins | ${suspended} suspended`,
      ``,
      `email,two_factor_enrolled,is_admin,suspended,org_unit`,
      ...users.map(
        (u) =>
          `${csvSafe(u.primaryEmail)},${u.isEnrolledIn2Sv ? "yes" : "no"},${u.isAdmin ? "yes" : "no"},${u.suspended ? "yes" : "no"},${csvSafe(u.orgUnitPath ?? "/")}`,
      ),
    ];
    const csv = lines.join("\n");
    const fileName = `gws-user-security-${new Date().toISOString().slice(0, 10)}.csv`;
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
        control_id: null, // company-wide evidence, not tied to one control
        file_name: fileName,
        storage_path: path,
        mime_type: "text/csv",
        size_bytes: csv.length,
        note: `Automated Google Workspace sync: ${total} users, ${with2fa} with 2FA, ${admins} admins, ${suspended} suspended.`,
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

    await recordChecksForSync(supabase, company.id, "google", { total, with2fa }, inserted?.id ?? null);

    revalidatePath("/integrations");
    revalidatePath("/evidence");
    revalidatePath("/dashboard");
    return { ok: true, summary: { total, with2fa, admins, suspended } };
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
