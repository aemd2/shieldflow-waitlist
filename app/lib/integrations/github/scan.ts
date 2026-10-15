import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { collectGitHub } from "@/lib/integrations/github/collect";
import { evaluateGitHub } from "@/lib/integrations/github/evaluate";
import { GitHubAccessError, parseStoredAuth } from "@/lib/integrations/github/client";
import type { GhAlert, GhMember, GhOwner, GhPullRequest, GhRepo } from "@/lib/integrations/github/types";
import { loadExceptions, saveScan, settingsOf, type ProviderRoster, type ProviderScan } from "@/lib/integrations/scan-store";
import { linkMap, matchAddresses, toIdentityAccount, type PersonLite } from "@/lib/integrations/people-match";

export const GITHUB_DEFAULTS = { criticalDays: 7, highDays: 30, windowDays: 30 };
export type GitHubSettings = typeof GITHUB_DEFAULTS;

export interface GitHubMemberView extends GhMember {
  org: string;
  /** The Personnel address this account belongs to, if known. */
  person: string | null;
}

export interface GitHubExtra {
  connection: "app" | "token";
  owners: GhOwner[];
  /** A personal account, not an organisation: no members, owners or 2FA policy to check. */
  personal: boolean;
  repos: GhRepo[];
  reposTruncated: boolean;
  reposUnread: string[];
  pulls: GhPullRequest[];
  members: GitHubMemberView[];
  alerts: { dependabot: GhAlert[]; secret: GhAlert[] | null; code: GhAlert[] | null };
  settings: GitHubSettings;
}

export interface GitHubIntegrationRow {
  id: string;
  company_id: string;
  access_token: string | null;
  metadata: Record<string, unknown> | null;
}

const DAY = 86_400_000;

export async function scanGitHub(
  db: SupabaseClient,
  integ: GitHubIntegrationRow,
  opts: { budgetMs?: number } = {},
): Promise<ProviderScan<GitHubExtra>> {
  if (!integ.access_token) throw new GitHubAccessError("auth", "GitHub isn't connected.");
  let stored: string;
  try {
    stored = decryptSecret(integ.access_token);
  } catch {
    throw new GitHubAccessError("auth", "The stored GitHub credential is unreadable — reconnect GitHub.");
  }
  const auth = parseStoredAuth(stored);
  const settings = settingsOf(integ.metadata, GITHUB_DEFAULTS);
  const now = new Date();
  const since = new Date(now.getTime() - settings.windowDays * DAY);

  const [posture, exceptions, { data: people }, { data: links }] = await Promise.all([
    collectGitHub(auth, { budgetMs: opts.budgetMs ?? 45_000, since }),
    loadExceptions(db, integ.company_id, "github"),
    db.from("personnel").select("name, email").eq("company_id", integ.company_id),
    db.from("identity_links").select("account, email").eq("company_id", integ.company_id).eq("provider", "github"),
  ]);

  const results = evaluateGitHub(posture, {
    now,
    exceptions,
    criticalDays: settings.criticalDays,
    highDays: settings.highDays,
    windowDays: settings.windowDays,
  });

  // People: org members (and outside collaborators) matched to Personnel.
  const staff = (people ?? []) as PersonLite[];
  const linked = linkMap(links as { account: string; email: string }[] | null);
  const members: GitHubMemberView[] = [];
  for (const o of posture.orgs) {
    for (const m of o.members.ok ? o.members.data : []) {
      const addresses = matchAddresses({ emails: [m.email], names: [m.name], handles: [m.login] }, staff, linked);
      members.push({ ...m, org: o.login, person: addresses[0] ?? null });
    }
  }
  const personal = posture.orgs.length === 0;
  const unreadOrgs = posture.orgs.filter((o) => !o.members.ok).map((o) => o.login);
  const roster: ProviderRoster | null = personal
    ? null
    : {
        all: members.map((m) => toIdentityAccount(`github:${m.login.toLowerCase()}`, true, m.person ? [m.person] : [])),
        humans: members.filter((m) => !/\[bot\]$|-bot$/i.test(m.login)).map((m) => toIdentityAccount(`github:${m.login.toLowerCase()}`, true, m.person ? [m.person] : [])),
        truncated: false,
        blindSpot: unreadOrgs.length ? `the members of ${unreadOrgs.join(", ")} couldn't be read (the GitHub App needs organisation Members: read)` : null,
      };

  // The CC8.1 population: every merged pull request, kept beyond what GitHub pages back to.
  const pulls = posture.pulls.ok ? posture.pulls.data : [];
  if (pulls.length) {
    await db.from("code_changes").upsert(
      pulls.map((p) => ({
        company_id: integ.company_id,
        provider: "github",
        repo: p.repo,
        number: p.number,
        title: p.title.slice(0, 300),
        url: p.url,
        author: p.author,
        merged_by: p.mergedBy,
        merged_at: p.mergedAt,
        approvers: p.approvers,
        independent_approval: p.independentApproval,
        ticket: p.ticket,
      })),
      { onConflict: "company_id,provider,repo,number" },
    );
  }

  const scan: ProviderScan<GitHubExtra> = {
    provider: "github",
    scannedAt: posture.scannedAt,
    durationMs: posture.durationMs,
    results,
    roster,
    extra: {
      connection: auth.kind,
      owners: posture.owners,
      personal,
      repos: posture.repos.ok ? posture.repos.data.slice(0, 500) : [],
      reposTruncated: posture.reposTruncated,
      reposUnread: posture.reposUnread.slice(0, 50),
      pulls: pulls.slice(0, 300),
      members,
      alerts: {
        dependabot: posture.dependabot.ok ? posture.dependabot.data.slice(0, 300) : [],
        secret: posture.secretScanning?.ok ? posture.secretScanning.data.slice(0, 100) : null,
        code: posture.codeScanning?.ok ? posture.codeScanning.data.slice(0, 100) : null,
      },
      settings,
    },
  };
  await saveScan(db, integ.id, scan);
  return scan;
}
