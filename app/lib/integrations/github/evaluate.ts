import { daysSince, exceptionMap, listNames, resourceKey, Verdict, type CheckOutcome, type CheckResource, type ExceptionRow } from "@/lib/checks-core";
import type { GhRepo, GitHubPosture } from "@/lib/integrations/github/types";

/**
 * GitHub posture → verdicts. Pure, so every path is pinned down in
 * lib/integrations/github/checks.cases.ts. Same rules as AWS: failures name the
 * repository / pull request / alert; exceptions and the repository topic
 * `shieldflow-out-of-scope` are honoured; anything unread is "can't tell".
 */

export interface GitHubEvaluateOptions {
  now: Date;
  exceptions: ExceptionRow[];
  /** Days a critical / high Dependabot alert may stay open (workspace policy). */
  criticalDays: number;
  highDays: number;
  /** The merged-pull-request window, in days. */
  windowDays: number;
}

export const OUT_OF_SCOPE_TOPIC = "shieldflow-out-of-scope";

const ownerOf = (fullName: string) => fullName.split("/")[0];
const nameOf = (fullName: string) => fullName.split("/").slice(1).join("/");
const tagsOf = (r: GhRepo) => (r.topics.includes(OUT_OF_SCOPE_TOPIC) ? { "shieldflow:scope": "out" } : undefined);

/** The resource id of a merged pull request (unreviewed_merges). */
export const prResourceId = (repo: string, n: number) => resourceKey(ownerOf(repo), null, "pr", `${nameOf(repo)}#${n}`);

export const repoResource = (fullName: string, label = fullName): CheckResource => ({
  id: resourceKey(ownerOf(fullName), null, "repo", nameOf(fullName)),
  label,
  region: null,
});

export function evaluateGitHub(p: GitHubPosture, opts: GitHubEvaluateOptions): CheckOutcome[] {
  const { now } = opts;
  const exceptions = exceptionMap(opts.exceptions, now);
  const V = (key: string) => new Verdict(key, exceptions);
  const out: CheckOutcome[] = [];
  const repos = p.repos.ok ? p.repos.data : null;
  const active = (repos ?? []).filter((r) => !r.archived && !r.fork);
  const unreadNote = (names: string[]) => `${names.length} ${names.length === 1 ? "repository" : "repositories"} not read (${listNames(names, 3)})`;

  // ------------------------------------------------------------ people & access
  if (p.orgs.length) {
    {
      const v = V("github.org_2fa_required");
      for (const o of p.orgs) {
        const req = v.read(o.twoFactorRequired, o.login);
        if (o.twoFactorRequired.ok && req === null) v.gap(`${o.login}: only an owner (or the GitHub App with organisation administration read) can see whether 2FA is required`);
        if (req === false) v.flag({ id: resourceKey(o.login, null, "org", o.login), label: `${o.login} doesn't require 2FA`, region: null });
      }
      out.push(v.settle(`Every organisation requires 2FA (${p.orgs.map((o) => o.login).join(", ")}).`, (n) => `${n} ${n === 1 ? "organisation doesn't" : "organisations don't"} require 2FA.`));
    }
    {
      const v = V("github.members_without_2fa");
      let members = 0;
      for (const o of p.orgs) {
        const list = v.read(o.without2fa, `${o.login} members`);
        if (o.members.ok) members += o.members.data.filter((m) => m.role !== "outside").length;
        for (const login of list ?? []) v.flag({ id: resourceKey(o.login, null, "member", login), label: `${login} (${o.login})`, region: null });
      }
      out.push(v.settle(`All ${members} members have 2FA.`, (n) => `${n} ${n === 1 ? "member has" : "members have"} no 2FA.`));
    }
    {
      const v = V("github.org_owners");
      for (const o of p.orgs) {
        const ms = v.read(o.members, `${o.login} members`);
        const owners = (ms ?? []).filter((m) => m.role === "owner").map((m) => m.login);
        if (owners.length > 3) v.flag({ id: resourceKey(o.login, null, "org", o.login), label: `${o.login}: ${owners.length} owners (${listNames(owners)})`, region: null });
      }
      out.push(v.settle("Each organisation has three owners or fewer.", (n) => `${n} ${n === 1 ? "organisation has" : "organisations have"} more than three owners.`));
    }
    {
      const v = V("github.outside_collaborators");
      for (const o of p.orgs) {
        for (const m of (v.read(o.members, `${o.login} members`) ?? []).filter((x) => x.role === "outside")) {
          v.flag({ id: resourceKey(o.login, null, "outside", m.login), label: `${m.login} (${o.login})`, region: null });
        }
      }
      out.push(v.settle("No outside collaborators.", (n) => `${n} outside ${n === 1 ? "collaborator has" : "collaborators have"} access to repositories.`));
    }
  }

  // ---------------------------------------------------------- change management
  {
    const v = V("github.branch_protection");
    v.read(p.repos, "repositories");
    const unread: string[] = [];
    for (const r of active) {
      if (!r.protection) {
        unread.push(r.fullName);
        continue;
      }
      const why = r.protection.planBlocked
        ? "private repositories can't be protected on GitHub Free — needs GitHub Pro or Team"
        : !r.protection.prRequired
          ? "no pull request required"
          : r.protection.approvals < 1
            ? "0 approvals required"
            : null;
      if (why) v.flag(repoResource(r.fullName, `${r.fullName} (${r.defaultBranch}: ${why})`), tagsOf(r));
    }
    if (unread.length) v.gap(unreadNote(unread));
    if (p.reposTruncated) v.gap("there are more repositories than one scan reads in detail");
    out.push(
      v.settle(
        active.length ? `All ${active.length} active repositories require a reviewed pull request on their default branch.` : "No active repositories to protect.",
        (n) => `${n} active ${n === 1 ? "repository lets" : "repositories let"} changes reach the default branch without a reviewed pull request.`,
      ),
    );
  }
  {
    const v = V("github.unreviewed_merges");
    const pulls = v.read(p.pulls, "merged pull requests") ?? [];
    for (const u of p.pullsUnread) v.gap(`merged pull requests of ${u} not read`);
    for (const pr of pulls) {
      if (pr.independentApproval) continue;
      v.flag({
        id: prResourceId(pr.repo, pr.number),
        label: `${pr.repo}#${pr.number} — ${pr.title.slice(0, 70)} (${pr.mergedBy ? `merged by ${pr.mergedBy}` : "merged"}, no independent approval)`,
        region: null,
      });
    }
    out.push(
      v.settle(
        pulls.length
          ? `All ${pulls.length} changes merged in the last ${opts.windowDays} days had an approval from someone other than the author.`
          : `No changes were merged into default branches in the last ${opts.windowDays} days.`,
        (n) => `${n} of ${pulls.length} changes merged in the last ${opts.windowDays} days had no approval from anyone but the author.`,
      ),
    );
  }
  {
    const v = V("github.force_push");
    for (const r of active) if (r.protection && !r.protection.forcePushBlocked) v.flag(repoResource(r.fullName), tagsOf(r));
    out.push(v.settle("Force pushes are blocked on every default branch read.", (n) => `${n} default ${n === 1 ? "branch allows" : "branches allow"} force pushes.`));
  }
  {
    const v = V("github.admin_bypass");
    for (const r of active) {
      if (r.protection && r.protection.enforceAdmins === false && r.protection.prRequired) v.flag(repoResource(r.fullName), tagsOf(r));
    }
    const guarded = active.filter((r) => r.protection?.prRequired).length;
    out.push(
      v.settle(
        guarded ? `Branch protection applies to admins too on all ${guarded} protected ${guarded === 1 ? "branch" : "branches"}.` : "No default branch is protected yet, so there's no protection to bypass.",
        (n) => `Admins can bypass branch protection on ${n} ${n === 1 ? "repository" : "repositories"}.`,
      ),
    );
  }

  // ------------------------------------------------------------- vulnerabilities
  {
    const v = V("github.dependabot_enabled");
    v.read(p.repos, "repositories");
    const unread: string[] = [];
    for (const r of active) {
      if (r.dependabot === null) unread.push(r.fullName);
      else if (!r.dependabot) v.flag(repoResource(r.fullName), tagsOf(r));
    }
    if (unread.length) v.gap(unreadNote(unread));
    out.push(v.settle(`Dependabot alerts are on for all ${active.length} active repositories.`, (n) => `Dependabot alerts are off on ${n} ${n === 1 ? "repository" : "repositories"}.`));
  }
  {
    const v = V("github.dependabot_sla");
    const alerts = v.read(p.dependabot, "Dependabot alerts") ?? [];
    // A repository with alerts switched off has no alerts to be late on — that's unknown, not clean.
    const dark = active.filter((r) => r.dependabot === false && !r.topics.includes(OUT_OF_SCOPE_TOPIC)).map((r) => r.fullName);
    if (dark.length) v.gap(`Dependabot alerts are off on ${dark.length === 1 ? dark[0] : `${dark.length} repositories`}, so their vulnerabilities aren't known`);
    let open = 0;
    for (const a of alerts) {
      if (a.severity !== "critical" && a.severity !== "high") continue;
      open++;
      const age = Math.floor(daysSince(a.createdAt, now));
      const limit = a.severity === "critical" ? opts.criticalDays : opts.highDays;
      if (age > limit) {
        v.flag({ id: resourceKey(ownerOf(a.repo), null, "alert", `${nameOf(a.repo)}#${a.id.split("#").pop()}`), label: `${a.repo}: ${a.title.slice(0, 80)} (${a.severity}, open ${age} days)`, region: null });
      }
    }
    out.push(
      v.settle(
        open ? `All ${open} open critical/high alerts are within the SLA (${opts.criticalDays} / ${opts.highDays} days).` : "No open critical or high Dependabot alerts.",
        (n) => `${n} critical or high ${n === 1 ? "vulnerability has" : "vulnerabilities have"} been open longer than your SLA (${opts.criticalDays} days critical, ${opts.highDays} days high).`,
      ),
    );
  }
  if (p.secretScanning) {
    const v = V("github.secret_scanning");
    for (const a of v.read(p.secretScanning, "secret scanning alerts") ?? []) {
      v.flag({ id: resourceKey(ownerOf(a.repo), null, "secret", `${nameOf(a.repo)}#${a.id.split("#").pop()}`), label: `${a.repo}: ${a.title}`, region: null });
    }
    out.push(v.settle("No open secret-scanning alerts.", (n) => `${n} leaked ${n === 1 ? "secret is" : "secrets are"} still open — revoke ${n === 1 ? "it" : "them"} first.`));
  }
  if (p.codeScanning) {
    const v = V("github.code_scanning");
    for (const a of v.read(p.codeScanning, "code scanning alerts") ?? []) {
      v.flag({ id: resourceKey(ownerOf(a.repo), null, "code", `${nameOf(a.repo)}#${a.id.split("#").pop()}`), label: `${a.repo}: ${a.title.slice(0, 80)} (${a.severity})`, region: null });
    }
    out.push(v.settle("No open critical or high code-scanning findings.", (n) => `${n} critical or high code-scanning ${n === 1 ? "finding is" : "findings are"} open.`));
  }

  // ------------------------------------------------------------------ hygiene
  {
    const v = V("github.repo_visibility");
    v.read(p.repos, "repositories");
    const publicRepos = (repos ?? []).filter((r) => !r.private && !r.archived && !r.fork);
    for (const r of publicRepos) v.flag(repoResource(r.fullName, `${r.fullName} (public)`), tagsOf(r));
    if (p.reposTruncated) v.gap("there are more repositories than one scan lists");
    out.push(v.settle("No public repositories.", (n) => `${n} public ${n === 1 ? "repository" : "repositories"} — confirm ${n === 1 ? "it's" : "they're"} meant to be public.`));
  }
  {
    const v = V("github.deploy_keys_write");
    for (const r of active) for (const k of r.writeDeployKeys ?? []) v.flag({ id: resourceKey(ownerOf(r.fullName), null, "deploy-key", `${nameOf(r.fullName)}:${k}`), label: `${r.fullName}: "${k}"`, region: null }, tagsOf(r));
    out.push(v.settle("No deploy keys can push.", (n) => `${n} deploy ${n === 1 ? "key has" : "keys have"} write access.`));
  }

  return out;
}
