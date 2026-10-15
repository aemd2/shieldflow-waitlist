import type { CheckDef } from "@/lib/checks-core";

/**
 * Every GitHub check: what it's called, why it matters in one sentence, which
 * requirements it proves, the exact read-only API calls (published on the public
 * check page), and the fix — Terraform first. Fix templates use {org} (the
 * account) and {id} (the repository name).
 */

export type GitHubArea = "identity" | "change" | "vulnerabilities" | "hygiene";

export const GITHUB_AREAS: { area: GitHubArea; title: string }[] = [
  { area: "identity", title: "People & access" },
  { area: "change", title: "Change management" },
  { area: "vulnerabilities", title: "Vulnerabilities" },
  { area: "hygiene", title: "Repository hygiene" },
];

const MFA = ["CC6.1", "A.8.5", "164.312(d)", "Req 8", "Art. 32"];
const ACCESS = ["CC6.2", "CC6.3", "A.5.16", "A.5.18"];
const CHANGE = ["CC8.1", "A.8.32", "A.8.28", "A.8.9", "Req 6"];
const VULN = ["CC7.1", "A.8.8", "Req 6", "Req 11"];
const SECRETS = ["CC6.1", "A.5.17", "Req 8"];
const VISIBILITY = ["CC6.1", "CC6.6", "A.5.15"];

const RULESET = `resource "github_repository_ruleset" "default_branch" {
  name        = "protect-default-branch"
  repository  = "{id}"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    pull_request {
      required_approving_review_count = 1
      dismiss_stale_reviews_on_push   = true
    }
    non_fast_forward = true
    deletion         = true
  }
}`;

export const GITHUB_CHECKS: CheckDef<GitHubArea>[] = [
  // ------------------------------------------------------------ people & access
  {
    key: "github.org_2fa_required",
    title: "The organisation requires 2FA",
    area: "identity",
    severity: "high",
    why: "Whoever can push to your repositories can ship to production; a stolen password alone shouldn't be enough.",
    controlCodes: MFA,
    apiCalls: ["GET /orgs/{org} (two_factor_requirement_enabled)"],
    fix: {
      console: "GitHub → {org} → Settings → Authentication security → Require two-factor authentication for everyone. Members without 2FA are removed until they set it up — check the 'members without 2FA' list first.",
    },
  },
  {
    key: "github.members_without_2fa",
    title: "Every member has 2FA",
    area: "identity",
    severity: "high",
    why: "Each member without 2FA is one phished password away from your source code.",
    controlCodes: MFA,
    apiCalls: ["GET /orgs/{org}/members?filter=2fa_disabled"],
    fix: {
      console: "Ask each listed member to turn on 2FA (GitHub → Settings → Password and authentication), then require it for the organisation so it can't lapse.",
    },
  },
  {
    key: "github.org_owners",
    title: "Few organisation owners",
    area: "identity",
    severity: "medium",
    why: "Owners can change every setting, delete repositories and remove the protections below; three or fewer is the usual bar.",
    controlCodes: ACCESS,
    apiCalls: ["GET /orgs/{org}/members?role=admin"],
    fix: { console: "GitHub → {org} → People → filter by Owner → Change role → Member for anyone who doesn't need it day to day." },
  },
  {
    key: "github.offboarding_drift",
    title: "Leavers are out of GitHub",
    area: "identity",
    severity: "high",
    why: "A leaver still in the organisation can still read — and often push — your code.",
    controlCodes: ACCESS,
    apiCalls: ["GET /orgs/{org}/members", "GraphQL organization.membersWithRole (login, name, public email)"],
    fix: { console: "GitHub → {org} → People → the person → Remove from organization." },
  },
  {
    key: "github.untracked_accounts",
    title: "Every GitHub member is someone you know",
    area: "identity",
    severity: "medium",
    why: "A member nobody can name is a leaver nobody recorded, a contractor nobody tracked, or a shared account.",
    controlCodes: ACCESS,
    apiCalls: ["GET /orgs/{org}/members", "GET /orgs/{org}/outside_collaborators"],
    fix: { console: "Add the person in Personnel with the name they use on GitHub, or dismiss the account as not a person (bots, CI)." },
  },
  {
    key: "github.outside_collaborators",
    title: "Outside collaborators",
    area: "identity",
    severity: "low",
    informational: true,
    why: "Contractors added straight to a repository bypass your organisation's member settings; list them so someone owns the list.",
    controlCodes: [],
    apiCalls: ["GET /orgs/{org}/outside_collaborators"],
    fix: { console: "GitHub → {org} → People → Outside collaborators → remove anyone who no longer needs access." },
  },

  // ---------------------------------------------------------- change management
  {
    key: "github.branch_protection",
    title: "Default branches require a reviewed pull request",
    area: "change",
    severity: "high",
    why: "Without it anyone with write access can push straight to production — the first thing an auditor tests for CC8.1.",
    controlCodes: CHANGE,
    apiCalls: ["GET /repos/{repo}/branches/{branch}/protection", "GET /repos/{repo}/rules/branches/{branch}"],
    fix: {
      terraform: RULESET,
      console:
        "GitHub → {org}/{id} → Settings → Rules → Rulesets → New branch ruleset → Target: Default branch → Require a pull request before merging (1 approval, dismiss stale approvals) → Block force pushes → Create. A ruleset at the organisation level covers every repository at once.",
    },
  },
  {
    key: "github.unreviewed_merges",
    title: "Every merged change was reviewed by someone else",
    area: "change",
    severity: "high",
    why: "Auditors sample merged pull requests; one merged without an independent approval is an exception in the report.",
    controlCodes: CHANGE,
    apiCalls: ["GraphQL repository.pullRequests(states: MERGED) with reviews(states: APPROVED)"],
    fix: {
      console:
        "Turn on 'require a reviewed pull request' (above) so it can't happen again. For each listed change, have someone review it after the fact, then mark it out of scope here with the reason — 'emergency fix during incident #12, reviewed afterwards in #345' is exactly what an auditor wants to read.",
    },
  },
  {
    key: "github.force_push",
    title: "Force pushes blocked on default branches",
    area: "change",
    severity: "low",
    informational: true,
    why: "A force push can rewrite history that was already reviewed and deployed.",
    controlCodes: [],
    apiCalls: ["GET /repos/{repo}/branches/{branch}/protection", "GET /repos/{repo}/rules/branches/{branch}"],
    fix: { terraform: RULESET, console: "Add 'Block force pushes' to the default-branch ruleset." },
  },
  {
    key: "github.admin_bypass",
    title: "Admins can't bypass branch protection",
    area: "change",
    severity: "low",
    informational: true,
    why: "Protection that admins can skip only protects you from people without admin rights.",
    controlCodes: [],
    apiCalls: ["GET /repos/{repo}/branches/{branch}/protection (enforce_admins)"],
    fix: { console: "GitHub → {org}/{id} → Settings → Branches → edit the rule → Do not allow bypassing the above settings. (Rulesets: leave the bypass list empty.)" },
  },

  // ------------------------------------------------------------- vulnerabilities
  {
    key: "github.dependabot_enabled",
    title: "Dependabot alerts are on for every repository",
    area: "vulnerabilities",
    severity: "medium",
    why: "Dependabot is free and tells you when a library you ship has a known vulnerability — off means you don't hear about it.",
    controlCodes: VULN,
    apiCalls: ["GET /repos/{repo}/vulnerability-alerts"],
    fix: {
      terraform: '# on the github_repository resource:\n  vulnerability_alerts = true',
      cli: "gh api -X PUT repos/{org}/{id}/vulnerability-alerts",
      console: "GitHub → {org} → Settings → Code security → Dependabot alerts → Enable all (and for new repositories).",
    },
  },
  {
    key: "github.dependabot_sla",
    title: "Vulnerable dependencies fixed within the SLA",
    area: "vulnerabilities",
    severity: "high",
    why: "Auditors check that critical and high findings are fixed within your policy's window (7 and 30 days by default).",
    controlCodes: VULN,
    apiCalls: ["GET /orgs/{org}/dependabot/alerts?state=open&severity=critical,high", "GET /repos/{repo}/dependabot/alerts"],
    fix: {
      console:
        "Open the alert, merge Dependabot's pull request or upgrade the package. If it can't be fixed yet, dismiss it in GitHub with the reason, or mark it out of scope here with the reason and a review date — that record is the exception process auditors look for.",
    },
  },
  {
    key: "github.secret_scanning",
    title: "No leaked secrets left open",
    area: "vulnerabilities",
    severity: "high",
    why: "A key committed to a repository should be treated as public; until it's revoked, anyone with the repo can use it.",
    controlCodes: SECRETS,
    apiCalls: ["GET /orgs/{org}/secret-scanning/alerts?state=open", "GET /repos/{repo}/secret-scanning/alerts"],
    fix: {
      console: "Revoke or rotate the secret at the service that issued it first, then close the alert as revoked. Turn on push protection so the next one is blocked before it lands.",
    },
  },
  {
    key: "github.code_scanning",
    title: "Code scanning findings",
    area: "vulnerabilities",
    severity: "low",
    informational: true,
    why: "If you run code scanning, its critical and high findings belong on the same list as everything else. Not required — it's a paid feature on private repositories.",
    controlCodes: [],
    apiCalls: ["GET /orgs/{org}/code-scanning/alerts?state=open"],
    fix: { console: "Open the alert in GitHub → Security → Code scanning, fix it or dismiss it with a reason." },
  },

  // ------------------------------------------------------------------- hygiene
  {
    key: "github.repo_visibility",
    title: "No unintended public repositories",
    area: "hygiene",
    severity: "medium",
    why: "A repository made public by mistake publishes your code — and often configuration — to everyone.",
    controlCodes: VISIBILITY,
    apiCalls: ["GET /installation/repositories (private)"],
    fix: {
      terraform: '# on the github_repository resource:\n  visibility = "private"',
      cli: "gh repo edit {org}/{id} --visibility private --accept-visibility-change-consequences",
      console: "If it's open source on purpose, mark it out of scope with that reason (or add the repository topic shieldflow-out-of-scope).",
    },
  },
  {
    key: "github.deploy_keys_write",
    title: "Deploy keys are read-only",
    area: "hygiene",
    severity: "low",
    informational: true,
    why: "A deploy key with write access is a long-lived credential that can push to the repository and never expires.",
    controlCodes: [],
    apiCalls: ["GET /repos/{repo}/keys"],
    fix: { console: "Replace it with a read-only key, or a GitHub App / short-lived token for the job that needs to push." },
  },
];

export const GITHUB_CHECK_BY_KEY = new Map(GITHUB_CHECKS.map((c) => [c.key, c]));

/** What the GitHub App is allowed to read — shown on the connect screen and the public page. */
export const GITHUB_APP_PERMISSIONS = [
  ["Repository: Metadata", "read"],
  ["Repository: Administration", "read — branch protection, rulesets, Dependabot switch, deploy keys"],
  ["Repository: Pull requests", "read — merged pull requests and their reviews"],
  ["Repository: Dependabot alerts", "read"],
  ["Repository: Secret scanning alerts", "read"],
  ["Repository: Code scanning alerts", "read"],
  ["Organization: Members", "read — owners, members, 2FA status"],
  ["Organization: Administration", "read — whether 2FA is required"],
] as const;
