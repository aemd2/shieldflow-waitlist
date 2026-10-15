/**
 * Branch cases for lib/integrations/gitlab/evaluate.ts and the address guard.
 * Run with:  npx tsx lib/integrations/gitlab/checks.cases.ts
 */
import { evaluateGitLab, GITLAB_OUT_OF_SCOPE } from "@/lib/integrations/gitlab/evaluate";
import { normalizeGitLabUrl, type GitLabPosture, type GlProject } from "@/lib/integrations/gitlab/collect";
import { parseGitLabSecret } from "@/lib/integrations/gitlab/scan";
import { ok, denied, type CheckOutcome } from "@/lib/checks-core";

const NOW = new Date("2026-10-15T12:00:00Z");
let failures = 0;
function expect(label: string, got: unknown, want: unknown) {
  const pass = got === want;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  -> ${String(got)}${pass ? "" : ` (wanted ${String(want)})`}`);
}
const get = (rs: CheckOutcome[], key: string) => {
  const r = rs.find((x) => x.key === key);
  if (!r) throw new Error(`no result for ${key}`);
  return r;
};

const proj = (path: string, over: Partial<GlProject> = {}): GlProject => ({
  id: 1, path, visibility: "private", archived: false, defaultBranch: "main", topics: [],
  protection: { pushRestricted: true, forcePushAllowed: false }, approvalsRequired: 1, authorCanApprove: false, writeDeployKeys: [], ...over,
});
const posture = (over: Partial<GitLabPosture> = {}): GitLabPosture => ({
  base: "https://gitlab.com", login: "sam", scannedAt: NOW.toISOString(), durationMs: 1,
  projects: ok([proj("acme/api"), proj("acme/web")]), projectsTruncated: false, projectsUnread: [], merges: [], mergesUnread: [],
  groups: ok([{ path: "acme", require2fa: true }]), ...over,
});
const run = (p: GitLabPosture) => evaluateGitLab(p, { now: NOW, exceptions: [], windowDays: 30 });

const gating = ["gitlab.group_2fa", "gitlab.branch_protection", "gitlab.mr_approvals_required", "gitlab.unreviewed_merges", "gitlab.visibility"];
expect("clean: gating checks pass", gating.filter((k) => get(run(posture()), k).result !== "pass").join(",") || "all pass", "all pass");
expect("group without 2FA fails", get(run(posture({ groups: ok([{ path: "acme", require2fa: false }]) })), "gitlab.group_2fa").result, "fail");
expect("groups unreadable → must NOT pass", get(run(posture({ groups: denied("read_api") })), "gitlab.group_2fa").result, "inconclusive");
expect("unprotected default branch fails", get(run(posture({ projects: ok([proj("acme/api", { protection: false })]) })), "gitlab.branch_protection").result, "fail");
expect("protected but developers can push fails", get(run(posture({ projects: ok([proj("acme/api", { protection: { pushRestricted: false, forcePushAllowed: false } })]) })), "gitlab.branch_protection").result, "fail");
expect("protection unread → must NOT pass", get(run(posture({ projects: ok([proj("acme/api", { protection: null })]) })), "gitlab.branch_protection").result, "inconclusive");
expect("ran out of time on a project → must NOT pass", get(run(posture({ projectsUnread: ["acme/web"] })), "gitlab.branch_protection").result, "inconclusive");
expect("more projects than read → must NOT pass", get(run(posture({ projectsTruncated: true })), "gitlab.branch_protection").result, "inconclusive");
expect("out-of-scope topic accepts the project", get(run(posture({ projects: ok([proj("acme/sandbox", { protection: false, topics: [GITLAB_OUT_OF_SCOPE] })]) })), "gitlab.branch_protection").result, "pass");
expect("no approval required fails", get(run(posture({ projects: ok([proj("acme/api", { approvalsRequired: 0 })]) })), "gitlab.mr_approvals_required").result, "fail");
expect("author can approve fails", get(run(posture({ projects: ok([proj("acme/api", { authorCanApprove: true })]) })), "gitlab.mr_approvals_required").result, "fail");
expect("approval settings unread → must NOT pass", get(run(posture({ projects: ok([proj("acme/api", { approvalsRequired: null })]) })), "gitlab.mr_approvals_required").result, "inconclusive");
const merge = (n: number, approvers: string[]) => ({ repo: "acme/api", number: n, title: `change ${n}`, url: "", author: "amara", mergedBy: "amara", mergedAt: "2026-10-10T00:00:00Z", approvers, independentApproval: approvers.length > 0, ticket: null });
expect("a self-merged change fails", get(run(posture({ merges: [merge(1, ["sam"]), merge(2, [])] })), "gitlab.unreviewed_merges").failingCount, 1);
expect("a project's merges unread → must NOT pass", get(run(posture({ merges: [merge(1, ["sam"])], mergesUnread: ["acme/web"] })), "gitlab.unreviewed_merges").result, "inconclusive");
expect("public project fails", get(run(posture({ projects: ok([proj("acme/site", { visibility: "public" })]) })), "gitlab.visibility").result, "fail");

expect("gitlab.com by default", normalizeGitLabUrl(""), "https://gitlab.com");
expect("self-managed host kept", normalizeGitLabUrl("git.acme.io"), "https://git.acme.io");
expect("http refused", normalizeGitLabUrl("http://git.acme.io"), null);
expect("internal host refused", normalizeGitLabUrl("https://gitlab.internal"), null);
expect("IP refused", normalizeGitLabUrl("https://192.168.1.5"), null);
expect("an old bare token means gitlab.com", parseGitLabSecret("glpat-abc").base, "https://gitlab.com");
expect("a new {base, token} secret keeps its host", parseGitLabSecret(JSON.stringify({ base: "https://git.acme.io", token: "t" })).base, "https://git.acme.io");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
