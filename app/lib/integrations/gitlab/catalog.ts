import type { CheckDef } from "@/lib/checks-core";

export type GitLabArea = "identity" | "change" | "hygiene";

export const GITLAB_AREAS: { area: GitLabArea; title: string }[] = [
  { area: "identity", title: "People & access" },
  { area: "change", title: "Change management" },
  { area: "hygiene", title: "Project hygiene" },
];

const MFA = ["CC6.1", "A.8.5", "164.312(d)", "Req 8", "Art. 32"];
const CHANGE = ["CC8.1", "A.8.32", "A.8.28", "A.8.9", "Req 6"];
const VISIBILITY = ["CC6.1", "CC6.6", "A.5.15"];

export const GITLAB_CHECKS: CheckDef<GitLabArea>[] = [
  {
    key: "gitlab.group_2fa",
    title: "Groups require two-factor authentication",
    area: "identity",
    severity: "high",
    why: "Whoever can push can ship to production; a stolen password alone shouldn't be enough.",
    controlCodes: MFA,
    apiCalls: ["GET /groups?top_level_only=true (require_two_factor_authentication)"],
    fix: { console: "GitLab → the group → Settings → General → Permissions and group features → All users in this group must set up two-factor authentication." },
  },
  {
    key: "gitlab.branch_protection",
    title: "Default branches only change through merge requests",
    area: "change",
    severity: "high",
    why: "If anyone can push straight to the default branch, code reaches production without anyone else seeing it.",
    controlCodes: CHANGE,
    apiCalls: ["GET /projects/:id/protected_branches/:default_branch"],
    fix: {
      terraform: `resource "gitlab_branch_protection" "default" {
  project            = "{id}"
  branch             = "main"
  push_access_level  = "no one"
  merge_access_level = "maintainer"
  allow_force_push   = false
}`,
      console: "GitLab → {id} → Settings → Repository → Protected branches → the default branch → Allowed to push and merge: No one / Maintainers.",
    },
  },
  {
    key: "gitlab.mr_approvals_required",
    title: "Merge requests need an approval from someone else",
    area: "change",
    severity: "high",
    why: "Protected branches force a merge request, but without a required approval the author can merge their own change.",
    controlCodes: CHANGE,
    apiCalls: ["GET /projects/:id/approvals", "GET /projects/:id/approval_rules"],
    fix: {
      console:
        "GitLab → {id} → Settings → Merge requests → Merge request approvals → add a rule requiring 1 approval, and untick 'Prevent approval by author' being allowed. (Required approvals are a GitLab Premium feature; on Free, review every merge in the Changes tab instead.)",
    },
  },
  {
    key: "gitlab.unreviewed_merges",
    title: "Every merged change was approved by someone else",
    area: "change",
    severity: "high",
    why: "This is the population an auditor samples for change management: each merge into the default branch, and who approved it.",
    controlCodes: CHANGE,
    apiCalls: ["GET /projects/:id/merge_requests?state=merged", "GET /projects/:id/merge_requests/:iid/approvals"],
    fix: { console: "Require approvals (the check above). For a merge that was an emergency, record why on the Changes tab — the reason is kept as evidence." },
  },
  {
    key: "gitlab.visibility",
    title: "No public projects",
    area: "hygiene",
    severity: "medium",
    why: "A public project shows its code, history and issues to anyone. Open source on purpose is fine — mark it out of scope.",
    controlCodes: VISIBILITY,
    apiCalls: ["GET /projects (visibility)"],
    fix: { console: "GitLab → {id} → Settings → General → Visibility → Private. Or add the topic shieldflow-out-of-scope if it's open source on purpose." },
  },
  {
    key: "gitlab.force_push",
    title: "Force pushes are blocked on default branches",
    area: "hygiene",
    severity: "low",
    informational: true,
    why: "A force push can rewrite history — including the record of who changed what.",
    controlCodes: [],
    apiCalls: ["GET /projects/:id/protected_branches/:default_branch (allow_force_push)"],
    fix: { console: "GitLab → {id} → Settings → Repository → Protected branches → turn off 'Allowed to force push'." },
  },
  {
    key: "gitlab.deploy_keys_write",
    title: "Deploy keys that can push",
    area: "hygiene",
    severity: "low",
    informational: true,
    why: "A deploy key with write access is a password that can push code without a merge request. Most only need read.",
    controlCodes: [],
    apiCalls: ["GET /projects/:id/deploy_keys"],
    fix: { console: "GitLab → {id} → Settings → Repository → Deploy keys → edit → untick 'Grant write permissions'." },
  },
];

export const GITLAB_READS = [["Personal or group access token, read_api", "projects, protected branches, approval rules, merged merge requests and their approvers, deploy keys, groups"]] as const;
