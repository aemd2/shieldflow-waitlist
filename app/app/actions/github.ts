"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { validateToken, fetchRepoSecurity, GitHubError } from "@/lib/github";
import { githubTokenSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync, clearChecksForProvider } from "@/lib/checks";
import { encryptSecret, decryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";
import { newUuid } from "@/lib/uuid";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

/**
 * Connect GitHub with a fine-grained Personal Access Token. The token is
 * shape-checked, then live-validated against GitHub — the row is only
 * written after GitHub accepts it. The token is never returned to the client.
 */
export async function connectGitHub(input: { token: string }) {
  const parsed = githubTokenSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid token." };
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

  let login: string;
  try {
    login = await validateToken(parsed.data.token);
  } catch (err) {
    return { error: err instanceof GitHubError ? err.userMessage : "Couldn't reach GitHub." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "github",
      access_token: encryptSecret(parsed.data.token),
      status: "connected",
      connected_by: user.id,
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "github",
    label: INTEGRATION_LABELS.github,
    metadata: { account: login },
  });

  revalidatePath("/integrations");
  return { ok: true, login };
}

/**
 * Pull a repository-security report (branch protection, visibility) and file
 * it as evidence — same compensating-cleanup pattern as the Workspace sync.
 */
export async function syncGitHub() {
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

  if (!checkRateLimit(`github-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, status")
    .eq("company_id", company.id)
    .eq("provider", "github")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "GitHub isn't connected yet." };
  }

  let token: string;
  try {
    token = decryptSecret(integ.access_token);
  } catch {
    return { error: "Stored GitHub token is unreadable — please reconnect." };
  }

  try {
    const report = await fetchRepoSecurity(token);

    const active = report.repos.filter((r) => !r.archived);
    const lines = [
      `# GitHub repository security report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Summary: ${report.totalRepos} repositories | ${active.length} active | ${report.protectedCount} with branch protection | ${report.publicCount} public${report.truncated ? " | partial report (large account or rate limit)" : ""}`,
      ``,
      `repository,visibility,branch_protection,archived`,
      ...report.repos.map(
        (r) =>
          `${csvSafe(r.fullName)},${r.isPrivate ? "private" : "public"},${r.branchProtection},${r.archived ? "yes" : "no"}`,
      ),
    ];
    const csv = lines.join("\n");
    const fileName = `github-repo-security-${new Date().toISOString().slice(0, 10)}.csv`;
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
        note: `Automated GitHub sync: ${report.totalRepos} repos, ${report.protectedCount} with branch protection, ${report.publicCount} public.`,
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

    await recordChecksForSync(supabase, company.id, "github", report, inserted?.id ?? null);

    revalidatePath("/integrations");
    revalidatePath("/evidence");
    revalidatePath("/dashboard");
    return {
      ok: true,
      summary: {
        total: report.totalRepos,
        protected: report.protectedCount,
        public: report.publicCount,
      },
    };
  } catch (err) {
    if (err instanceof GitHubError) {
      if (err.kind === "auth") {
        await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
        revalidatePath("/integrations");
      }
      return { error: err.userMessage };
    }
    return { error: "Sync failed. Please try again." };
  }
}

export async function disconnectGitHub() {
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
    .eq("provider", "github");
  if (error) return { error: "Could not disconnect. Please try again." };

  await clearChecksForProvider(supabase, company.id, "github");

  await logEvent(supabase, company.id, "integration.disconnected", {
    type: "integration",
    id: "github",
    label: INTEGRATION_LABELS.github,
  });

  revalidatePath("/integrations");
  revalidatePath("/dashboard");
  return { ok: true };
}
