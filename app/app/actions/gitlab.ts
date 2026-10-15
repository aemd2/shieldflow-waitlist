"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertIntegrationSlot } from "@/lib/plan-server";
import { validateToken, GitLabError } from "@/lib/gitlab";
import { gitlabTokenSchema } from "@/lib/validation";
import { logEvent } from "@/lib/audit";
import { disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { scanWithCredentials, checksReportCsv } from "@/lib/integrations/token-actions";
import { scanGitLab } from "@/lib/integrations/gitlab/scan";
import { normalizeGitLabUrl, gitlabUser as collectGitLabUser } from "@/lib/integrations/gitlab/collect";
import { GITLAB_CHECKS } from "@/lib/integrations/gitlab/catalog";
import { csvRow, fileMeasureCsv } from "@/lib/evidence-population";
import { encryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

export async function connectGitLab(input: { token: string; host?: string }) {
  const parsed = gitlabTokenSchema.safeParse({ token: input?.token });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid token." };
  const base = normalizeGitLabUrl(typeof input?.host === "string" ? input.host : "");
  if (!base) return { error: "Enter your GitLab server's https address (a public hostname), or leave it empty for gitlab.com." };

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
    (await assertIntegrationSlot(supabase, company.id, "gitlab"));
  if (denied) return { error: denied };
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  let username: string;
  try {
    username = base === "https://gitlab.com" ? await validateToken(parsed.data.token) : (await collectGitLabUser(base, parsed.data.token));
  } catch (err) {
    return { error: err instanceof GitLabError ? err.userMessage : "Couldn't reach GitLab." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "gitlab",
      access_token: encryptSecret(JSON.stringify({ base, token: parsed.data.token })),
      status: "connected",
      connected_by: user.id,
      metadata: { username, login: username, base },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "gitlab",
    label: INTEGRATION_LABELS.gitlab,
    metadata: { username },
  });

  revalidatePath("/integrations");
  return { ok: true, username };
}

export async function syncGitLab() {
  return scanWithCredentials(
    "gitlab",
    GITLAB_CHECKS,
    scanGitLab,
    (scan, company) => {
      const x = scan.extra;
      const active = x.projects.filter((p) => !p.archived);
      return {
        csv: checksReportCsv("GitLab", company, scan, GITLAB_CHECKS, [
          csvRow("project", "visibility", "default_branch", "merge_request_required", "approvals_required", "force_push"),
          ...active.map((p) => csvRow(p.path, p.visibility, p.defaultBranch, p.protection === null ? "unknown" : p.protection ? p.protection.pushRestricted : false, p.approvalsRequired ?? "unknown", p.protection ? p.protection.forcePushAllowed : "")),
        ]),
        note: `Automated GitLab scan: ${active.length} projects, ${x.merges.length} merged changes.`,
        summary: { total: active.length, protected: active.filter((p) => p.protection && p.protection.pushRestricted).length },
      };
    },
    async (db, companyId, userId, scan) => {
      if (!scan.extra.merges.length) return;
      const day = new Date().toISOString().slice(0, 10);
      await fileMeasureCsv(
        db,
        companyId,
        userId,
        "change-management",
        `gitlab-merged-changes-${day}.csv`,
        [
          csvRow(`# Changes merged into default branches, last ${scan.extra.settings.windowDays} days — ${day}`),
          csvRow("project", "number", "title", "author", "merged_by", "merged_at", "approved_by", "independent_approval", "ticket", "url"),
          ...scan.extra.merges.map((m) => csvRow(m.repo, m.number, m.title, m.author, m.mergedBy, m.mergedAt, m.approvers.join(" "), m.independentApproval, m.ticket, m.url)),
        ].join("\n"),
        "Generated from GitLab by ShieldFlow: every merge request merged into a default branch, with who approved it.",
      );
    },
  );
}

export async function disconnectGitLab() {
  return disconnectProvider("gitlab");
}
