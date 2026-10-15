import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { GitLabError } from "@/lib/gitlab";
import { collectGitLab, type GlGroup, type GlMerge, type GlProject } from "@/lib/integrations/gitlab/collect";
import { evaluateGitLab } from "@/lib/integrations/gitlab/evaluate";
import { loadExceptions, saveScan, settingsOf, type ProviderScan } from "@/lib/integrations/scan-store";

export const GITLAB_DEFAULTS = { windowDays: 30 };

export interface GitLabExtra {
  base: string;
  login: string;
  projects: GlProject[];
  projectsTruncated: boolean;
  merges: GlMerge[];
  groups: GlGroup[] | null;
  settings: typeof GITLAB_DEFAULTS;
}

/** Stored credential: older connections hold a bare token (gitlab.com); newer ones {base, token}. */
export function parseGitLabSecret(stored: string): { base: string; token: string } {
  try {
    const j = JSON.parse(stored) as { base?: string; token?: string };
    if (j && typeof j === "object" && j.token) return { base: j.base || "https://gitlab.com", token: j.token };
  } catch {
    // a bare token
  }
  return { base: "https://gitlab.com", token: stored };
}

export async function scanGitLab(db: SupabaseClient, integ: { id: string; company_id: string; access_token: string | null; metadata: Record<string, unknown> | null }): Promise<ProviderScan<GitLabExtra>> {
  let creds: { base: string; token: string };
  try {
    creds = parseGitLabSecret(decryptSecret(integ.access_token ?? ""));
  } catch {
    throw new GitLabError("auth", "Stored credentials are unreadable — please reconnect GitLab.");
  }
  const settings = settingsOf(integ.metadata, GITLAB_DEFAULTS);
  const since = new Date(Date.now() - settings.windowDays * 86_400_000);
  const [posture, exceptions] = await Promise.all([collectGitLab(creds.base, creds.token, since), loadExceptions(db, integ.company_id, "gitlab")]);
  const results = evaluateGitLab(posture, { now: new Date(), exceptions, windowDays: settings.windowDays });

  // The change-management population, kept beyond GitLab's own pages.
  if (posture.merges.length) {
    await db.from("code_changes").upsert(
      posture.merges.map((m) => ({
        company_id: integ.company_id,
        provider: "gitlab",
        repo: m.repo,
        number: m.number,
        title: m.title.slice(0, 300),
        url: m.url,
        author: m.author,
        merged_by: m.mergedBy,
        merged_at: m.mergedAt,
        approvers: m.approvers,
        independent_approval: m.independentApproval,
        ticket: m.ticket,
      })),
      { onConflict: "company_id,provider,repo,number" },
    );
  }

  const scan: ProviderScan<GitLabExtra> = {
    provider: "gitlab",
    scannedAt: posture.scannedAt,
    durationMs: posture.durationMs,
    results,
    roster: null,
    extra: {
      base: posture.base,
      login: posture.login,
      projects: posture.projects.ok ? posture.projects.data.slice(0, 500) : [],
      projectsTruncated: posture.projectsTruncated,
      merges: posture.merges.slice(0, 300),
      groups: posture.groups.ok ? posture.groups.data : null,
      settings,
    },
  };
  await saveScan(db, integ.id, scan);
  return scan;
}
