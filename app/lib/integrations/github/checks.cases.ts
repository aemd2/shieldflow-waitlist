/**
 * Branch cases for lib/integrations/github/evaluate.ts and the pull-request
 * reading in collect.ts. Run with:  npx tsx lib/integrations/github/checks.cases.ts
 * Every "must NOT pass" case is a partial read that must stay "can't tell".
 */
import { evaluateGitHub, OUT_OF_SCOPE_TOPIC, repoResource, type GitHubEvaluateOptions } from "@/lib/integrations/github/evaluate";
import { toPulls } from "@/lib/integrations/github/collect";
import { ok, denied, type CheckOutcome } from "@/lib/checks-core";
import type { GhOrgPosture, GhProtection, GhRepo, GitHubPosture } from "@/lib/integrations/github/types";

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
const has = (rs: CheckOutcome[], key: string) => (rs.some((x) => x.key === key) ? "present" : "absent");

const PROTECTED: GhProtection = { prRequired: true, approvals: 1, dismissStale: true, forcePushBlocked: true, enforceAdmins: true, source: "ruleset" };
const repo = (name: string, over: Partial<GhRepo> = {}): GhRepo => ({
  fullName: `acme/${name}`, private: true, archived: false, fork: false, defaultBranch: "main", pushedAt: "2026-10-10T00:00:00Z",
  topics: [], protection: PROTECTED, dependabot: true, writeDeployKeys: [], ...over,
});
const org = (over: Partial<GhOrgPosture> = {}): GhOrgPosture => ({
  login: "acme",
  twoFactorRequired: ok(true),
  without2fa: ok([]),
  members: ok([
    { login: "sam", name: "Sam Okafor", email: null, role: "owner", twoFactor: true },
    { login: "dani", name: "Daniel Weber", email: null, role: "owner", twoFactor: true },
    { login: "amara", name: "Amara Osei", email: null, role: "member", twoFactor: true },
  ]),
  ...over,
});
const posture = (over: Partial<GitHubPosture> = {}): GitHubPosture => ({
  owners: [{ login: "acme", type: "Organization" }],
  scannedAt: NOW.toISOString(),
  durationMs: 1000,
  repos: ok([repo("api"), repo("web")]),
  reposTruncated: false,
  reposUnread: [],
  orgs: [org()],
  pulls: ok([]),
  pullsUnread: [],
  dependabot: ok([]),
  secretScanning: ok([]),
  codeScanning: null,
  ...over,
});
const opts: GitHubEvaluateOptions = { now: NOW, exceptions: [], criticalDays: 7, highDays: 30, windowDays: 30 };
const run = (p: GitHubPosture, o: Partial<typeof opts> = {}) => evaluateGitHub(p, { ...opts, ...o });

// ---------------------------------------------------------------- baseline
const clean = run(posture());
const gating = ["github.org_2fa_required", "github.members_without_2fa", "github.org_owners", "github.branch_protection", "github.unreviewed_merges", "github.dependabot_enabled", "github.dependabot_sla", "github.secret_scanning", "github.repo_visibility"];
expect("clean org: every gating check passes", gating.filter((k) => get(clean, k).result !== "pass").join(",") || "all pass", "all pass");
expect("code scanning not available → not emitted (never required)", has(clean, "github.code_scanning"), "absent");

// ---------------------------------------------------------- branch protection
const unprot = run(posture({ repos: ok([repo("api", { protection: { ...PROTECTED, prRequired: false, approvals: 0, source: "none" } }), repo("web")]) }));
expect("a default branch without a required PR fails", get(unprot, "github.branch_protection").result, "fail");
expect("…and names the repository", get(unprot, "github.branch_protection").resources[0]?.label.startsWith("acme/api") ? "yes" : "no", "yes");
const zeroApprovals = run(posture({ repos: ok([repo("api", { protection: { ...PROTECTED, approvals: 0 } })]) }));
expect("PR required but 0 approvals fails", get(zeroApprovals, "github.branch_protection").result, "fail");
const unreadable = run(posture({ repos: ok([repo("api"), repo("web", { protection: null })]) }));
expect("one repository unreadable → must NOT pass", get(unreadable, "github.branch_protection").result, "inconclusive");
const truncated = run(posture({ reposTruncated: true }));
expect("more repositories than read → must NOT pass", get(truncated, "github.branch_protection").result, "inconclusive");
const scoped = run(posture({ repos: ok([repo("sandbox", { topics: [OUT_OF_SCOPE_TOPIC], protection: { ...PROTECTED, prRequired: false } })]) }));
expect("topic shieldflow-out-of-scope → accepted, not failed", get(scoped, "github.branch_protection").result, "pass");
const excepted = run(posture({ repos: ok([repo("api", { protection: { ...PROTECTED, prRequired: false } })]) }), {
  exceptions: [{ checkKey: "github.branch_protection", resourceId: repoResource("acme/api").id, reason: "docs only", expiresAt: null }],
});
expect("a recorded exception accepts the repository", get(excepted, "github.branch_protection").accepted.length, 1);
const archived = run(posture({ repos: ok([repo("old", { archived: true, protection: null })]) }));
expect("archived repositories don't count", get(archived, "github.branch_protection").result, "pass");
const reposDenied = run(posture({ repos: denied("repositories") }));
expect("repositories unreadable → must NOT pass", get(reposDenied, "github.branch_protection").result, "inconclusive");

// ------------------------------------------------------------- merged changes
const pr = (n: number, approvers: string[], author = "amara") => ({
  repo: "acme/api", number: n, title: `change ${n}`, url: "", author, mergedBy: author, mergedAt: "2026-10-12T10:00:00Z",
  approvers, independentApproval: approvers.length > 0, ticket: null,
});
const merges = run(posture({ pulls: ok([pr(1, ["sam"]), pr(2, [])]) }));
expect("a merge without an independent approval fails", get(merges, "github.unreviewed_merges").result, "fail");
expect("…and only that one is listed", get(merges, "github.unreviewed_merges").failingCount, 1);
const pullsGap = run(posture({ pulls: ok([pr(1, ["sam"])]), pullsUnread: ["acme/web"] }));
expect("a repository's merges unread → must NOT pass", get(pullsGap, "github.unreviewed_merges").result, "inconclusive");
expect("no merges in the window passes and says so", get(clean, "github.unreviewed_merges").detail.startsWith("No changes") ? "yes" : "no", "yes");

// toPulls: the author's own approval doesn't count; a review after the merge doesn't count.
const nodes = [
  { number: 7, title: "ENG-42 fix login", url: "u", mergedAt: "2026-10-12T10:00:00Z", headRefName: "fix", author: { login: "amara" }, mergedBy: { login: "amara" },
    reviews: { nodes: [{ author: { login: "amara" }, submittedAt: "2026-10-12T09:00:00Z" }, { author: { login: "sam" }, submittedAt: "2026-10-12T11:00:00Z" }] } },
  { number: 8, title: "bump deps", url: "u", mergedAt: "2026-10-13T10:00:00Z", headRefName: "eng-77-deps", author: { login: "amara" }, mergedBy: { login: "sam" },
    reviews: { nodes: [{ author: { login: "sam" }, submittedAt: "2026-10-13T09:00:00Z" }] } },
  { number: 6, title: "old", url: "u", mergedAt: "2026-08-01T10:00:00Z", headRefName: "x", author: { login: "a" }, mergedBy: null, reviews: { nodes: [] } },
];
const pulls = toPulls("acme/api", nodes, Date.parse("2026-09-15T00:00:00Z"));
expect("merges before the window are left out", pulls.length, 2);
expect("self-approval and post-merge review don't count", pulls.find((p) => p.number === 7)?.independentApproval, false);
expect("another person's approval before merge counts", pulls.find((p) => p.number === 8)?.independentApproval, true);
expect("ticket read from the title", pulls.find((p) => p.number === 7)?.ticket, "ENG-42");
expect("ticket read from the branch", pulls.find((p) => p.number === 8)?.ticket, "ENG-77");

// ---------------------------------------------------------------- people
const no2fa = run(posture({ orgs: [org({ twoFactorRequired: ok(false), without2fa: ok(["amara"]) })] }));
expect("org not requiring 2FA fails", get(no2fa, "github.org_2fa_required").result, "fail");
expect("member without 2FA named", get(no2fa, "github.members_without_2fa").resources[0]?.label, "amara (acme)");
const notOwner = run(posture({ orgs: [org({ twoFactorRequired: ok(null), without2fa: denied("members with 2FA disabled") })] }));
expect("2FA requirement invisible to a non-owner → must NOT pass", get(notOwner, "github.org_2fa_required").result, "inconclusive");
expect("2FA list invisible → must NOT pass", get(notOwner, "github.members_without_2fa").result, "inconclusive");
const manyOwners = run(posture({ orgs: [org({ members: ok(["a", "b", "c", "d"].map((l) => ({ login: l, name: null, email: null, role: "owner" as const, twoFactor: true }))) })] }));
expect("four owners fails the owner check", get(manyOwners, "github.org_owners").result, "fail");
const personal = run(posture({ owners: [{ login: "sam", type: "User" }], orgs: [] }));
expect("personal account: no organisation checks", has(personal, "github.org_2fa_required"), "absent");

// --------------------------------------------------------- vulnerabilities
const alert = (sev: "critical" | "high", created: string) => ({ id: `acme/api#${created}`, repo: "acme/api", severity: sev, title: "lodash: prototype pollution", createdAt: created, url: "" });
const sla = run(posture({ dependabot: ok([alert("critical", "2026-10-01T00:00:00Z"), alert("high", "2026-10-01T00:00:00Z")]) }));
expect("critical open 14 days fails a 7-day SLA", get(sla, "github.dependabot_sla").failingCount, 1);
expect("high open 14 days is within a 30-day SLA", get(sla, "github.dependabot_sla").resources.some((r) => r.label.includes("high")) ? "flagged" : "ok", "ok");
const depOff = run(posture({ repos: ok([repo("api", { dependabot: false })]) }));
expect("Dependabot off fails", get(depOff, "github.dependabot_enabled").result, "fail");
const depUnknown = run(posture({ repos: ok([repo("api", { dependabot: null })]) }));
expect("Dependabot switch unreadable → must NOT pass", get(depUnknown, "github.dependabot_enabled").result, "inconclusive");
const darkRepo = run(posture({ repos: ok([repo("api"), repo("web", { dependabot: false })]), dependabot: ok([]) }));
expect("Dependabot off on a repo → SLA must NOT pass (its alerts aren't known)", get(darkRepo, "github.dependabot_sla").result, "inconclusive");
const darkButLate = run(posture({ repos: ok([repo("api"), repo("web", { dependabot: false })]), dependabot: ok([alert("critical", "2026-10-01T00:00:00Z")]) }));
expect("…but a late critical elsewhere still fails", get(darkButLate, "github.dependabot_sla").result, "fail");
const darkOutOfScope = run(posture({ repos: ok([repo("api"), repo("sandbox", { dependabot: false, topics: [OUT_OF_SCOPE_TOPIC] })]), dependabot: ok([]) }));
expect("Dependabot off on an out-of-scope repo doesn't block the SLA", get(darkOutOfScope, "github.dependabot_sla").result, "pass");
const freePlan = run(posture({ repos: ok([repo("api"), repo("secret-sauce", { protection: { prRequired: false, approvals: 0, dismissStale: false, forcePushBlocked: false, enforceAdmins: null, source: "none", planBlocked: true } })]) }));
expect("private repo on GitHub Free (can't be protected) fails, not can't tell", get(freePlan, "github.branch_protection").result, "fail");
expect("…and says it needs a paid plan", get(freePlan, "github.branch_protection").resources[0]?.label.includes("GitHub Pro") ? "yes" : "no", "yes");
const alertsDenied = run(posture({ dependabot: denied("Dependabot alerts") }));
expect("alerts unreadable → must NOT pass", get(alertsDenied, "github.dependabot_sla").result, "inconclusive");
const secrets = run(posture({ secretScanning: ok([{ id: "acme/api#1", repo: "acme/api", severity: "critical", title: "AWS key exposed", createdAt: "2026-10-10T00:00:00Z", url: "" }]) }));
expect("an open leaked secret fails", get(secrets, "github.secret_scanning").result, "fail");
const noSecretScanning = run(posture({ secretScanning: null }));
expect("secret scanning not available → not emitted", has(noSecretScanning, "github.secret_scanning"), "absent");

// ---------------------------------------------------------------- hygiene
const pub = run(posture({ repos: ok([repo("site", { private: false })]) }));
expect("a public repository fails visibility", get(pub, "github.repo_visibility").result, "fail");
const pubOss = run(posture({ repos: ok([repo("sdk", { private: false, topics: [OUT_OF_SCOPE_TOPIC] })]) }));
expect("open source by design (topic) is accepted", get(pubOss, "github.repo_visibility").result, "pass");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
