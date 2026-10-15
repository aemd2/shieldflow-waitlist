/**
 * Branch cases for the shallow provider evaluators in lib/checks.ts (GitHub
 * legacy, GitLab, Cloudflare, Okta). Run with:  npx tsx lib/provider-checks.cases.ts
 *
 * The bug these pin down is the expensive one: a check that PASSES on a partial
 * read — 30 of 300 repositories, the first 50 users, the first 25 zones, a
 * project list that never contained a visibility field. Every "must NOT pass"
 * case below was a real pass before.
 */
import { EVALUATORS, type RawCheck } from "@/lib/checks";

let failures = 0;
function expect(label: string, got: unknown, want: unknown) {
  const pass = got === want;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  -> ${String(got)}${pass ? "" : ` (wanted ${String(want)})`}`);
}
const get = (rs: RawCheck[], key: string) => {
  const r = rs.find((x) => x.checkKey === key);
  if (!r) throw new Error(`no result for ${key}`);
  return r;
};

// ---------------------------------------------------------------- GitHub
const repo = (name: string, branchProtection: string, extra: Record<string, unknown> = {}) => ({
  fullName: name, isPrivate: true, archived: false, defaultBranch: "main", branchProtection, ...extra,
});
const gh = (repos: ReturnType<typeof repo>[], over: Record<string, unknown> = {}) =>
  EVALUATORS.github({
    repos,
    totalRepos: repos.length,
    checked: repos.filter((r) => r.branchProtection !== "unknown").length,
    protectedCount: repos.filter((r) => r.branchProtection === "protected").length,
    publicCount: repos.filter((r) => !r.isPrivate && !r.archived).length,
    truncated: false,
    ...over,
  });
expect("github: every repo protected and read → pass", get(gh([repo("a", "protected"), repo("b", "protected")]), "github.branch_protection").result, "pass");
expect("github: one repo unreadable (403) → must NOT pass", get(gh([repo("a", "protected"), repo("b", "unknown")]), "github.branch_protection").result, "inconclusive");
expect("github: read 30 of 300 (truncated) → must NOT pass", get(gh([repo("a", "protected")], { truncated: true }), "github.branch_protection").result, "inconclusive");
expect("github: an unprotected repo fails even with gaps", get(gh([repo("a", "unprotected"), repo("b", "unknown")]), "github.branch_protection").result, "fail");
expect("github: truncated list, no public seen → must NOT pass", get(gh([repo("a", "protected")], { truncated: true }), "github.repo_visibility").result, "inconclusive");

// ---------------------------------------------------------------- GitLab
const project = (path: string, branchProtection: string, extra: Record<string, unknown> = {}) => ({
  fullPath: path, visibility: "private", archived: false, defaultBranch: "main", branchProtection, ...extra,
});
const gl = (repos: ReturnType<typeof project>[], over: Record<string, unknown> = {}) =>
  EVALUATORS.gitlab({
    repos,
    total: repos.length,
    checked: repos.filter((r) => r.branchProtection !== "unknown").length,
    protectedCount: repos.filter((r) => r.branchProtection === "protected").length,
    publicCount: repos.filter((r) => r.visibility === "public" && !r.archived).length,
    truncated: false,
    ...over,
  });
expect("gitlab: every default branch protected → pass", get(gl([project("g/a", "protected")]), "gitlab.branch_protection").result, "pass");
expect("gitlab: every lookup failed → must NOT pass", get(gl([project("g/a", "unknown"), project("g/b", "unknown")]), "gitlab.branch_protection").result, "inconclusive");
expect("gitlab: unprotected default branch fails", get(gl([project("g/a", "unprotected")]), "gitlab.branch_protection").result, "fail");
const legacy = EVALUATORS.gitlab({ repos: [{ fullPath: "g/a", archived: undefined, branchProtection: "protected" }], total: 1, protectedCount: 1, publicCount: 0, truncated: false });
expect("gitlab: old posture without visibility → must NOT pass", get(legacy, "gitlab.visibility").result, "inconclusive");
expect("gitlab: a public project fails", get(gl([project("g/a", "protected", { visibility: "public" })]), "gitlab.visibility").result, "fail");

// ------------------------------------------------------------ Cloudflare
const zone = (name: string, ssl = "strict", minTls = "1.2", alwaysHttps = "on") => ({ name, ssl, minTls, alwaysHttps, hsts: "unknown" });
const cf = (zones: ReturnType<typeof zone>[], totalZones = zones.length) => EVALUATORS.cloudflare({ zones, totalZones, truncated: totalZones > zones.length });
expect("cloudflare: strict + TLS 1.2 + HTTPS → pass", get(cf([zone("a.com")]), "cloudflare.tls").result, "pass");
expect("cloudflare: SSL 'full' (no origin cert check) fails", get(cf([zone("a.com", "full")]), "cloudflare.tls").result, "fail");
expect("cloudflare: unreadable setting → must NOT fail or pass", get(cf([zone("a.com", "unknown")]), "cloudflare.tls").result, "inconclusive");
expect("cloudflare: 30 zones, 25 read → must NOT pass", get(cf([zone("a.com")], 30), "cloudflare.tls").result, "inconclusive");
console.log(`      detail: ${get(cf([zone("a.com")], 30), "cloudflare.tls").detail}`);

// ------------------------------------------------------------------ Okta
const okta = (over: Record<string, unknown>) =>
  EVALUATORS.okta({ totalUsers: 120, active: 120, mfaChecked: 120, mfaEnrolled: 120, passwordMinLength: 12, truncated: false, ...over });
expect("okta: every active user has MFA → pass", get(okta({}), "okta.mfa").result, "pass");
expect("okta: 50 of 120 checked, all enrolled → must NOT pass", get(okta({ mfaChecked: 50, mfaEnrolled: 50 }), "okta.mfa").result, "inconclusive");
expect("okta: under 90% enrolled fails", get(okta({ mfaEnrolled: 80 }), "okta.mfa").result, "fail");
expect("okta: weak-only factors are named", get(okta({ mfaWeakOnly: 3 }), "okta.mfa").detail.includes("SMS") ? "yes" : "no", "yes");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
