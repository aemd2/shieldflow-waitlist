import { ok, type Section } from "@/lib/checks-core";
import {
  ghGet,
  ghGraphql,
  ghPages,
  ghSection,
  GhHttpError,
  installationAccount,
  pool,
  timeLeft,
  tokenFor,
  type GhCtx,
} from "@/lib/integrations/github/client";
import type {
  GhAlert,
  GhMember,
  GhOrgPosture,
  GhOwner,
  GhProtection,
  GhPullRequest,
  GhRepo,
  GitHubAuth,
  GitHubPosture,
} from "@/lib/integrations/github/types";

/**
 * Read one GitHub account's security posture — read-only calls only, every one
 * listed in the GitHub catalogue for the public check page.
 *
 * Inside one time budget: repositories → per active repository (newest first,
 * capped) the default branch's protection (branch protection AND rulesets),
 * Dependabot switch and write deploy keys; merged pull requests with their
 * approvals (GraphQL, one call per repository); organisation 2FA, owners,
 * members and outside collaborators; open Dependabot, secret-scanning and
 * code-scanning alerts. Anything not read is recorded, never assumed.
 */

const MAX_REPOS = 1000;
const MAX_DETAIL = 150;
const TICKET = /\b([A-Za-z][A-Za-z0-9]{1,9}-\d{1,6})\b/;

type RawRepo = {
  full_name: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  pushed_at: string | null;
  topics?: string[];
};

const toRepo = (r: RawRepo): GhRepo => ({
  fullName: r.full_name,
  private: r.private,
  archived: Boolean(r.archived),
  fork: Boolean(r.fork),
  defaultBranch: r.default_branch,
  pushedAt: r.pushed_at,
  topics: r.topics ?? [],
  protection: null,
  dependabot: null,
  writeDeployKeys: null,
});

async function owners(ctx: GhCtx, auth: GitHubAuth): Promise<GhOwner[]> {
  if (auth.kind === "app") return [await installationAccount(auth.installationId)];
  const me = (await ghGet(ctx, "/user")).json as { login: string };
  const orgs = await ghPages<{ login: string }>(ctx, "/user/orgs?per_page=100", 100).catch(() => ({ items: [] as { login: string }[] }));
  return [{ login: me.login, type: "User" }, ...orgs.items.map((o) => ({ login: o.login, type: "Organization" as const }))];
}

/** The default branch's real protection: classic branch protection and/or rulesets. */
async function protectionOf(ctx: GhCtx, repo: GhRepo): Promise<GhProtection | null> {
  const branch = encodeURIComponent(repo.defaultBranch);
  let classic: { approvals: number; dismissStale: boolean; forceBlocked: boolean; enforceAdmins: boolean; prRequired: boolean } | "none" | null = null;
  try {
    const j = (await ghGet(ctx, `/repos/${repo.fullName}/branches/${branch}/protection`)).json as {
      required_pull_request_reviews?: { required_approving_review_count?: number; dismiss_stale_reviews?: boolean };
      allow_force_pushes?: { enabled?: boolean };
      enforce_admins?: { enabled?: boolean };
    };
    const pr = j.required_pull_request_reviews;
    classic = {
      prRequired: Boolean(pr),
      approvals: pr?.required_approving_review_count ?? 0,
      dismissStale: Boolean(pr?.dismiss_stale_reviews),
      forceBlocked: !j.allow_force_pushes?.enabled,
      enforceAdmins: Boolean(j.enforce_admins?.enabled),
    };
  } catch (err) {
    // "Branch not protected" is a real answer; anything else (no permission) is not.
    if (err instanceof GhHttpError && err.status === 404 && /not protected/i.test(err.message)) classic = "none";
    else if (err instanceof GhHttpError && err.rateLimited) throw err;
    // Private repository on a free plan: GitHub won't protect it at all — a definite "unprotected".
    else if (err instanceof GhHttpError && err.status === 403 && /upgrade to github pro|make this repository public/i.test(err.message)) {
      return { prRequired: false, approvals: 0, dismissStale: false, forcePushBlocked: false, enforceAdmins: null, source: "none", planBlocked: true };
    }
  }

  type Rule = { type: string; parameters?: { required_approving_review_count?: number; dismiss_stale_reviews_on_push?: boolean } };
  let rules: Rule[] | null = null;
  try {
    rules = (await ghGet(ctx, `/repos/${repo.fullName}/rules/branches/${branch}`)).json as Rule[];
  } catch (err) {
    if (err instanceof GhHttpError && err.rateLimited) throw err;
  }

  if (classic === null && rules === null) return null;
  const pr = rules?.find((r) => r.type === "pull_request");
  const rulesetPr = Boolean(pr);
  const rulesetApprovals = pr?.parameters?.required_approving_review_count ?? 0;
  const c = classic && classic !== "none" ? classic : null;
  // Classic protection unreadable and no ruleset requiring a PR: we can't vouch either way.
  if (classic === null && !rulesetPr) return null;
  return {
    prRequired: Boolean(c?.prRequired) || rulesetPr,
    approvals: Math.max(c?.approvals ?? 0, rulesetApprovals),
    dismissStale: Boolean(c?.dismissStale) || Boolean(pr?.parameters?.dismiss_stale_reviews_on_push),
    forcePushBlocked: Boolean(c?.forceBlocked) || Boolean(rules?.some((r) => r.type === "non_fast_forward")),
    enforceAdmins: c ? c.enforceAdmins : null,
    source: c && rulesetPr ? "both" : rulesetPr ? "ruleset" : c ? "branch-protection" : "none",
  };
}

async function dependabotOn(ctx: GhCtx, repo: GhRepo): Promise<boolean | null> {
  try {
    const r = await ghGet(ctx, `/repos/${repo.fullName}/vulnerability-alerts`);
    return r.status === 204 || r.status === 200;
  } catch (err) {
    if (err instanceof GhHttpError && err.status === 404 && /disabled/i.test(err.message)) return false;
    return null;
  }
}

async function writeKeys(ctx: GhCtx, repo: GhRepo): Promise<string[] | null> {
  try {
    const keys = (await ghGet(ctx, `/repos/${repo.fullName}/keys?per_page=100`)).json as { title?: string; read_only?: boolean }[];
    return keys.filter((k) => k.read_only === false).map((k) => k.title ?? "deploy key");
  } catch {
    return null;
  }
}

const PRS = `query($owner:String!,$name:String!,$base:String!){
  repository(owner:$owner,name:$name){
    pullRequests(states:MERGED, baseRefName:$base, first:50, orderBy:{field:UPDATED_AT,direction:DESC}){
      nodes{ number title url mergedAt headRefName author{login} mergedBy{login}
        reviews(first:30, states:APPROVED){ nodes{ author{login} submittedAt } } }
    }
  }
}`;

type PrNode = {
  number: number;
  title: string;
  url: string;
  mergedAt: string | null;
  headRefName: string;
  author: { login: string } | null;
  mergedBy: { login: string } | null;
  reviews: { nodes: { author: { login: string } | null; submittedAt: string | null }[] };
};

/** Merged pull requests into the default branch since `since`, with independent approvals. */
export function toPulls(repo: string, nodes: PrNode[], since: number): GhPullRequest[] {
  return nodes
    .filter((n) => n.mergedAt && Date.parse(n.mergedAt) >= since)
    .map((n) => {
      const author = n.author?.login ?? null;
      const approvers = [
        ...new Set(
          n.reviews.nodes
            .filter((r) => r.author?.login && r.author.login !== author && (!r.submittedAt || Date.parse(r.submittedAt) <= Date.parse(n.mergedAt!)))
            .map((r) => r.author!.login),
        ),
      ];
      const ticket = TICKET.exec(n.title)?.[1] ?? TICKET.exec(n.headRefName)?.[1] ?? null;
      return {
        repo,
        number: n.number,
        title: n.title,
        url: n.url,
        author,
        mergedBy: n.mergedBy?.login ?? null,
        mergedAt: n.mergedAt!,
        approvers,
        independentApproval: approvers.length > 0,
        ticket: ticket ? ticket.toUpperCase() : null,
      };
    });
}

function alertFrom(a: Record<string, unknown>, repoFallback: string | null, kind: "dependabot" | "secret" | "code"): GhAlert {
  const repo = ((a.repository as { full_name?: string } | undefined)?.full_name ?? repoFallback ?? "unknown") as string;
  const num = a.number as number;
  if (kind === "dependabot") {
    const adv = a.security_advisory as { severity?: string; summary?: string } | undefined;
    const pkg = (a.dependency as { package?: { name?: string } } | undefined)?.package?.name ?? "dependency";
    return { id: `${repo}#${num}`, repo, severity: (adv?.severity ?? "high") as GhAlert["severity"], title: `${pkg}: ${adv?.summary ?? "vulnerability"}`, createdAt: a.created_at as string, url: a.html_url as string };
  }
  if (kind === "secret") {
    return { id: `${repo}#${num}`, repo, severity: "critical", title: `${(a.secret_type_display_name as string) ?? (a.secret_type as string) ?? "secret"} exposed`, createdAt: a.created_at as string, url: a.html_url as string };
  }
  const rule = a.rule as { security_severity_level?: string; description?: string } | undefined;
  return { id: `${repo}#${num}`, repo, severity: (rule?.security_severity_level ?? "medium") as GhAlert["severity"], title: rule?.description ?? "code scanning alert", createdAt: a.created_at as string, url: a.html_url as string };
}

async function orgPosture(ctx: GhCtx, org: string): Promise<GhOrgPosture> {
  const twoFactorRequired = await ghSection(`organization settings of ${org}`, ctx, async () => {
    const j = (await ghGet(ctx, `/orgs/${org}`)).json as { two_factor_requirement_enabled?: boolean | null };
    // Only owners (and Apps with organisation administration read) see the field.
    return typeof j.two_factor_requirement_enabled === "boolean" ? j.two_factor_requirement_enabled : null;
  });
  const without2fa = await ghSection(`members with 2FA disabled in ${org}`, ctx, async () => {
    const r = await ghPages<{ login: string }>(ctx, `/orgs/${org}/members?filter=2fa_disabled&per_page=100`, 1000);
    return r.items.map((m) => m.login);
  });
  const members = await ghSection(`members of ${org}`, ctx, async () => {
    const [admins, all, outside] = await Promise.all([
      ghPages<{ login: string }>(ctx, `/orgs/${org}/members?role=admin&per_page=100`, 500),
      ghPages<{ login: string }>(ctx, `/orgs/${org}/members?per_page=100`, 2000),
      ghPages<{ login: string }>(ctx, `/orgs/${org}/outside_collaborators?per_page=100`, 1000).catch(() => ({ items: [] as { login: string }[] })),
    ]);
    const ownerSet = new Set(admins.items.map((m) => m.login));
    // Names and public emails help match people to Personnel; best-effort.
    const profile = new Map<string, { name: string | null; email: string | null }>();
    try {
      let after: string | null = null;
      for (let i = 0; i < 20 && timeLeft(ctx) > 2000; i++) {
        const d: { organization: { membersWithRole: { nodes: { login: string; name: string | null; email: string | null }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } =
          await ghGraphql(ctx, `query($org:String!,$after:String){ organization(login:$org){ membersWithRole(first:100, after:$after){ nodes{ login name email } pageInfo{ hasNextPage endCursor } } } }`, { org, after });
        for (const n of d.organization.membersWithRole.nodes) profile.set(n.login, { name: n.name || null, email: n.email || null });
        if (!d.organization.membersWithRole.pageInfo.hasNextPage) break;
        after = d.organization.membersWithRole.pageInfo.endCursor;
      }
    } catch {
      // logins alone still work for owners/2FA; matching falls back to names we have
    }
    const no2fa = without2fa.ok ? new Set(without2fa.data) : null;
    const out: GhMember[] = all.items.map((m) => ({
      login: m.login,
      name: profile.get(m.login)?.name ?? null,
      email: profile.get(m.login)?.email ?? null,
      role: ownerSet.has(m.login) ? "owner" : "member",
      twoFactor: no2fa ? !no2fa.has(m.login) : null,
    }));
    for (const o of outside.items) out.push({ login: o.login, name: null, email: null, role: "outside", twoFactor: null });
    return out;
  });
  return { login: org, twoFactorRequired, members, without2fa };
}

export interface CollectOptions {
  budgetMs: number;
  /** Merged pull requests after this time are read. */
  since: Date;
}

export async function collectGitHub(auth: GitHubAuth, opts: CollectOptions): Promise<GitHubPosture> {
  const started = Date.now();
  const ctx: GhCtx = { token: await tokenFor(auth), deadline: started + opts.budgetMs };
  const accountOwners = await owners(ctx, auth);
  const orgLogins = accountOwners.filter((o) => o.type === "Organization").map((o) => o.login);

  // ------------------------------------------------------------- repositories
  let reposTruncated = false;
  const repos: Section<GhRepo[]> = await ghSection("repositories", ctx, async () => {
    const page =
      auth.kind === "app"
        ? await ghPages<RawRepo>(ctx, "/installation/repositories?per_page=100", MAX_REPOS, (j) => (j as { repositories: RawRepo[] }).repositories)
        : await ghPages<RawRepo>(ctx, "/user/repos?per_page=100&sort=pushed&affiliation=owner,organization_member", MAX_REPOS);
    reposTruncated = page.truncated;
    return page.items.map(toRepo);
  });

  const reposUnread: string[] = [];
  if (repos.ok) {
    const active = repos.data
      .filter((r) => !r.archived && !r.fork)
      .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
    const detail = active.slice(0, MAX_DETAIL);
    if (active.length > MAX_DETAIL) reposTruncated = true;
    await pool(detail, 8, ctx, async (repo) => {
      try {
        const [prot, dep, keys] = await Promise.all([protectionOf(ctx, repo), dependabotOn(ctx, repo), writeKeys(ctx, repo)]);
        repo.protection = prot;
        repo.dependabot = dep;
        repo.writeDeployKeys = keys;
      } catch {
        // rate limit mid-repo: leave it unread
      }
    });
    for (const r of active) if (r.protection === null) reposUnread.push(r.fullName);
  }

  // --------------------------------------------------- merged pull requests
  const pullsUnread: string[] = [];
  const pulls: Section<GhPullRequest[]> = repos.ok
    ? ok(
        (
          await pool(
            repos.data.filter((r) => !r.archived && !r.fork && (!r.pushedAt || Date.parse(r.pushedAt) >= opts.since.getTime())),
            6,
            ctx,
            async (repo) => {
              const [owner, name] = repo.fullName.split("/");
              try {
                const d = await ghGraphql<{ repository: { pullRequests: { nodes: PrNode[] } } | null }>(ctx, PRS, { owner, name, base: repo.defaultBranch });
                const nodes = d.repository?.pullRequests.nodes ?? [];
                const got = toPulls(repo.fullName, nodes, opts.since.getTime());
                // A full page still inside the window may have more behind it.
                if (nodes.length === 50 && got.length === 50) pullsUnread.push(`${repo.fullName} (more than 50 merges)`);
                return got;
              } catch {
                pullsUnread.push(repo.fullName);
                return [];
              }
            },
          )
        ).flat(),
      )
    : { ok: false, reason: "error", action: "pull requests", message: "Repositories couldn't be listed." };
  // Repos the deadline stopped before reading.
  if (repos.ok && timeLeft(ctx) <= 0) pullsUnread.push("(scan time ran out)");

  // ------------------------------------------------------------ organisations
  const orgs: GhOrgPosture[] = [];
  for (const org of orgLogins) orgs.push(await orgPosture(ctx, org));

  // ------------------------------------------------------------------ alerts
  const userRepos = repos.ok ? repos.data.filter((r) => !r.archived && !orgLogins.includes(r.fullName.split("/")[0])) : [];
  const dependabot = await ghSection("Dependabot alerts", ctx, async () => {
    const out: GhAlert[] = [];
    for (const org of orgLogins) {
      const r = await ghPages<Record<string, unknown>>(ctx, `/orgs/${org}/dependabot/alerts?state=open&severity=critical,high&per_page=100`, 500);
      out.push(...r.items.map((a) => alertFrom(a, null, "dependabot")));
    }
    await pool(userRepos.filter((r) => r.dependabot), 6, ctx, async (repo) => {
      try {
        const r = await ghPages<Record<string, unknown>>(ctx, `/repos/${repo.fullName}/dependabot/alerts?state=open&severity=critical,high&per_page=100`, 200);
        out.push(...r.items.map((a) => alertFrom(a, repo.fullName, "dependabot")));
      } catch {
        // alerts off for this repo
      }
    });
    return out;
  });

  /** Secret / code scanning: absent (404, not enabled) is "not available", never a failure. */
  async function optionalAlerts(kind: "secret" | "code"): Promise<Section<GhAlert[]> | null> {
    const label = kind === "secret" ? "secret scanning alerts" : "code scanning alerts";
    const path = kind === "secret" ? "secret-scanning/alerts?state=open&per_page=100" : "code-scanning/alerts?state=open&per_page=100";
    let available = false;
    const out: GhAlert[] = [];
    let failure: Section<never> | null = null;
    for (const org of orgLogins) {
      try {
        const r = await ghPages<Record<string, unknown>>(ctx, `/orgs/${org}/${path}`, 500);
        available = true;
        out.push(...r.items.map((a) => alertFrom(a, null, kind)));
      } catch (err) {
        if (err instanceof GhHttpError && err.status === 403 && /not accessible by integration|must have admin/i.test(err.message)) {
          failure = { ok: false, reason: "denied", action: label, message: `ShieldFlow can't read ${label} — update the GitHub App's permissions.` };
        }
        // 404 / "not enabled" / "Advanced Security must be enabled": not available here
      }
    }
    for (const repo of userRepos.filter((r) => kind === "code" || !r.private)) {
      if (timeLeft(ctx) <= 0) break;
      try {
        const r = await ghPages<Record<string, unknown>>(ctx, `/repos/${repo.fullName}/${path}`, 200);
        available = true;
        out.push(...r.items.map((a) => alertFrom(a, repo.fullName, kind)));
      } catch {
        // not enabled for this repo
      }
    }
    if (available) return ok(kind === "code" ? out.filter((a) => a.severity === "critical" || a.severity === "high") : out);
    return failure;
  }

  return {
    owners: accountOwners,
    scannedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    repos,
    reposTruncated,
    reposUnread,
    orgs,
    pulls,
    pullsUnread,
    dependabot,
    secretScanning: await optionalAlerts("secret"),
    codeScanning: await optionalAlerts("code"),
  };
}
