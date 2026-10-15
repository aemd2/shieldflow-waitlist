"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertFeature, assertIntegrationSlot } from "@/lib/plan-server";
import { validateToken, GitHubError } from "@/lib/github";
import { scanGitHub, type GitHubIntegrationRow } from "@/lib/integrations/github/scan";
import { GitHubAccessError } from "@/lib/integrations/github/client";
import { GITHUB_CHECK_BY_KEY } from "@/lib/integrations/github/catalog";
import { csvRow, fileMeasureCsv } from "@/lib/evidence-population";
import { z } from "zod";
import { githubTokenSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
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
  const denied =
    (await assertCanWrite(supabase, company.id, user.id)) ??
    (await assertIntegrationSlot(supabase, company.id, "github"));
  if (denied) return { error: denied };
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
 * Scan GitHub now: the deep read-only scan (lib/integrations/github), the report
 * filed as evidence, the merged-change population filed on "Track every
 * production change", and the checks recorded.
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
  const denied =
    (await assertCanWrite(supabase, company.id, user.id)) ??
    (await assertFeature(supabase, company.id, "integrations"));
  if (denied) return { error: denied };

  if (!checkRateLimit(`github-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, company_id, access_token, status, metadata")
    .eq("company_id", company.id)
    .eq("provider", "github")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "GitHub isn't connected yet." };
  }

  let scan: Awaited<ReturnType<typeof scanGitHub>>;
  try {
    scan = await scanGitHub(supabase, integ as GitHubIntegrationRow);
  } catch (err) {
    if (err instanceof GitHubAccessError) {
      if (err.kind === "auth") {
        await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
        revalidatePath("/integrations");
      }
      return { error: err.userMessage };
    }
    return { error: "The GitHub scan failed. Please try again." };
  }

  const day = new Date().toISOString().slice(0, 10);
  const counts = { pass: 0, fail: 0, inconclusive: 0 };
  for (const r of scan.results) if (!GITHUB_CHECK_BY_KEY.get(r.key)?.informational) counts[r.result]++;

  // The report: every check, its verdict and the resources behind it.
  const report = [
    csvRow("# GitHub security report", new Date().toISOString(), company.name),
    csvRow("# Accounts", scan.extra.owners.map((o) => o.login).join(" "), `${scan.extra.repos.length} repositories`),
    csvRow("check", "result", "detail", "resources"),
    ...scan.results.map((r) => csvRow(GITHUB_CHECK_BY_KEY.get(r.key)?.title ?? r.key, r.result, r.detail, r.resources.map((x) => x.label).join("; "))),
    "",
    csvRow("repository", "visibility", "default_branch", "pull_request_required", "approvals", "force_push_blocked", "dependabot", "archived"),
    ...scan.extra.repos.map((r) =>
      csvRow(
        r.fullName,
        r.private ? "private" : "public",
        r.defaultBranch,
        r.protection ? r.protection.prRequired : "unknown",
        r.protection?.approvals ?? "",
        r.protection ? r.protection.forcePushBlocked : "unknown",
        r.dependabot ?? "unknown",
        r.archived,
      ),
    ),
  ].join("\n");
  const fileName = `github-security-report-${day}.csv`;
  const path = `${company.id}/integrations/${newUuid()}-${fileName}`;
  let evidenceId: string | null = null;
  const { error: upErr } = await supabase.storage.from("evidence").upload(path, new Blob([report], { type: "text/csv" }), { contentType: "text/csv" });
  if (!upErr) {
    const { data: ev } = await supabase
      .from("evidence")
      .insert({
        company_id: company.id,
        control_id: null,
        file_name: fileName,
        storage_path: path,
        mime_type: "text/csv",
        size_bytes: report.length,
        note: `Automated GitHub scan: ${counts.fail} failing, ${counts.pass} passing, ${counts.inconclusive} can't tell.`,
        uploaded_by: user.id,
      })
      .select("id")
      .single();
    evidenceId = (ev?.id as string | undefined) ?? null;
  }

  // The CC8.1 population an auditor samples.
  if (scan.extra.pulls.length) {
    const population = [
      csvRow(`# Changes merged into default branches, last ${scan.extra.settings.windowDays} days — ${day}`),
      csvRow("repository", "number", "title", "author", "merged_by", "merged_at", "approved_by", "independent_approval", "ticket", "url"),
      ...scan.extra.pulls.map((p) => csvRow(p.repo, p.number, p.title, p.author, p.mergedBy, p.mergedAt, p.approvers.join(" "), p.independentApproval, p.ticket, p.url)),
    ].join("\n");
    await fileMeasureCsv(
      supabase,
      company.id,
      user.id,
      "change-management",
      `github-merged-changes-${day}.csv`,
      population,
      "Generated from GitHub by ShieldFlow: every pull request merged into a default branch, with who approved it.",
    );
  }

  await supabase.from("integrations").update({ last_synced_at: new Date().toISOString(), status: "connected" }).eq("id", integ.id);
  await recordChecksForSync(supabase, company.id, "github", scan, evidenceId);

  revalidatePath("/integrations");
  revalidatePath("/integrations/github");
  revalidatePath("/evidence");
  revalidatePath("/dashboard");
  const active = scan.extra.repos.filter((r) => !r.archived);
  return {
    ok: true,
    ...counts,
    summary: {
      total: scan.extra.repos.length,
      protected: active.filter((r) => r.protection?.prRequired).length,
      public: active.filter((r) => !r.private).length,
    },
  };
}

const settingsSchema = z
  .object({
    criticalDays: z.number().int().min(1).max(90),
    highDays: z.number().int().min(1).max(180),
    windowDays: z.number().int().min(7).max(90),
  })
  .partial();

/** Change the GitHub SLA / window settings; the rest stay as they were. */
export async function updateGitHubSettings(input: unknown) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: "SLA days must be 1–90 (critical) and 1–180 (high); the window 7–90 days." };
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const company = await getCompanyForUser(supabase, user.id).catch(() => null);
  if (!company) return { error: "No company found." };
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };
  const { data: integ } = await supabase.from("integrations").select("id, metadata").eq("company_id", company.id).eq("provider", "github").maybeSingle();
  if (!integ) return { error: "GitHub isn't connected yet." };
  const meta = (integ.metadata as Record<string, unknown> | null) ?? {};
  const current = (meta.settings as Record<string, unknown> | undefined) ?? {};
  const { error } = await supabase.from("integrations").update({ metadata: { ...meta, settings: { ...current, ...parsed.data } } }).eq("id", integ.id);
  if (error) return { error: DB_ERROR };
  revalidatePath("/integrations/github");
  return { ok: true };
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
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };

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
