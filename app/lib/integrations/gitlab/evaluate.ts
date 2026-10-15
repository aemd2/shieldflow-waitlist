import { exceptionMap, listNames, resourceKey, Verdict, type CheckOutcome, type ExceptionRow } from "@/lib/checks-core";
import type { GitLabPosture, GlProject } from "@/lib/integrations/gitlab/collect";

export interface GitLabEvaluateOptions {
  now: Date;
  exceptions: ExceptionRow[];
  windowDays: number;
}

export const GITLAB_OUT_OF_SCOPE = "shieldflow-out-of-scope";
const ownerOf = (path: string) => path.split("/")[0];
export const glProjectResource = (path: string, label = path) => ({ id: resourceKey(ownerOf(path), null, "project", path), label, region: null });
export const glMergeResourceId = (path: string, iid: number) => resourceKey(ownerOf(path), null, "mr", `${path}!${iid}`);
const tags = (p: GlProject) => (p.topics.includes(GITLAB_OUT_OF_SCOPE) ? { "shieldflow:scope": "out" } : undefined);

export function evaluateGitLab(p: GitLabPosture, opts: GitLabEvaluateOptions): CheckOutcome[] {
  const ex = exceptionMap(opts.exceptions, opts.now);
  const V = (key: string) => new Verdict(key, ex);
  const out: CheckOutcome[] = [];
  const projects = p.projects.ok ? p.projects.data : [];
  const active = projects.filter((x) => !x.archived && x.defaultBranch);
  const more = "more projects than one scan reads";

  {
    const v = V("gitlab.group_2fa");
    const groups = v.read(p.groups, "groups") ?? [];
    for (const g of groups) if (!g.require2fa) v.flag({ id: resourceKey(g.path, null, "group", g.path), label: g.path, region: null });
    out.push(
      v.settle(
        groups.length ? `All ${groups.length} top-level groups require 2FA.` : "No groups — projects belong to a personal namespace.",
        (n) => `${n} of ${groups.length} groups don't require 2FA: ${listNames(groups.filter((g) => !g.require2fa).map((g) => g.path), 3)}.`,
      ),
    );
  }
  {
    const v = V("gitlab.branch_protection");
    v.read(p.projects, "projects");
    if (p.projectsTruncated) v.gap(more);
    for (const u of p.projectsUnread) v.gap(`protection of ${u} not read`);
    for (const x of active) {
      if (x.protection === null) continue;
      if (x.protection === false) v.flag(glProjectResource(x.path, `${x.path} (${x.defaultBranch}: not protected)`), tags(x));
      else if (!x.protection.pushRestricted) v.flag(glProjectResource(x.path, `${x.path} (${x.defaultBranch}: direct pushes allowed)`), tags(x));
    }
    const unread = active.filter((x) => x.protection === null && !p.projectsUnread.includes(x.path));
    if (unread.length) v.gap(`protection of ${listNames(unread.map((x) => x.path), 3)} not read`);
    out.push(v.settle(`All ${active.length} default branches only change through merge requests.`, (n) => `${n} of ${active.length} default branches accept direct pushes.`));
  }
  {
    const v = V("gitlab.mr_approvals_required");
    v.read(p.projects, "projects");
    if (p.projectsTruncated) v.gap(more);
    for (const x of active) {
      if (x.approvalsRequired === null) {
        v.gap(`approval settings of ${x.path} not read`);
        continue;
      }
      const why = [x.approvalsRequired < 1 ? "no approval required" : null, x.authorCanApprove ? "author can approve" : null].filter(Boolean);
      if (why.length) v.flag(glProjectResource(x.path, `${x.path} (${why.join(", ")})`), tags(x));
    }
    out.push(v.settle(`Every project requires an approval from someone other than the author.`, (n) => `${n} of ${active.length} projects let a change merge without someone else's approval.`));
  }
  {
    const v = V("gitlab.unreviewed_merges");
    v.read(p.projects, "projects");
    for (const u of p.mergesUnread) v.gap(`merged requests of ${u} not read`);
    for (const m of p.merges) {
      if (m.independentApproval) continue;
      v.flag({ id: glMergeResourceId(m.repo, m.number), label: `${m.repo}!${m.number} — ${m.title.slice(0, 70)} (${m.mergedBy ? `merged by ${m.mergedBy}` : "merged"}, no approval)`, region: null });
    }
    out.push(
      v.settle(
        p.merges.length ? `All ${p.merges.length} changes merged in the last ${opts.windowDays} days were approved by someone other than the author.` : `No changes were merged into default branches in the last ${opts.windowDays} days.`,
        (n) => `${n} of ${p.merges.length} changes merged in the last ${opts.windowDays} days had no approval from anyone but the author.`,
      ),
    );
  }
  {
    const v = V("gitlab.visibility");
    v.read(p.projects, "projects");
    if (p.projectsTruncated) v.gap(more);
    for (const x of projects.filter((y) => !y.archived && y.visibility === "public")) v.flag(glProjectResource(x.path, `${x.path} (public)`), tags(x));
    out.push(v.settle("No active project is public.", (n) => `${n} ${n === 1 ? "project is" : "projects are"} public.`));
  }
  {
    const v = V("gitlab.force_push");
    for (const x of active) if (x.protection && x.protection.forcePushAllowed) v.flag(glProjectResource(x.path), tags(x));
    out.push(v.settle("Force pushes are blocked on every protected default branch read.", (n) => `${n} default ${n === 1 ? "branch allows" : "branches allow"} force pushes.`));
  }
  {
    const v = V("gitlab.deploy_keys_write");
    for (const x of active) for (const k of x.writeDeployKeys ?? []) v.flag({ id: resourceKey(ownerOf(x.path), null, "deploy-key", `${x.path}:${k}`), label: `${x.path}: "${k}"`, region: null }, tags(x));
    out.push(v.settle("No deploy key can push.", (n) => `${n} deploy ${n === 1 ? "key has" : "keys have"} write access.`));
  }
  return out;
}
