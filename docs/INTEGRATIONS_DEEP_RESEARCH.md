# Deeper integrations — what Sam needs, what auditors sample, what we built

*Written 2026-10-15, alongside the code. Sam = the persona in USER_PERSONA.md:
a 38-person SaaS, SOC 2 + NIS2, ~4 hours a week for compliance.*

## The three lessons, from AWS, applied everywhere

1. **Auditors test populations, not settings.** CC8.1 = every merged change in
   the period, sampled. CC6.2/6.3 = every leaver, and when their access went.
   Endpoint = every laptop. A setting that is "on today" proves nothing about
   the period — so each integration now files its population as dated evidence
   every day.
2. **Noise and false passes kill trust.** Vanta reviews: "marked passing when it
   clearly wasn't", "surface-level checks". Our rule, enforced by one engine
   (`lib/checks-core.ts`) and pinned by a `.cases.ts` per provider: **can't see
   it → can't tell, never a pass**; a real failure still fails even when
   something else couldn't be read.
3. **Small teams lack exactly two data sources**: an HR system and an MDM. Both
   now feed the same Personnel register every leaver check reads.

## How every integration is built

| Piece | Where |
|---|---|
| Collect (read-only API calls → sections that are data *or* why not) | `lib/integrations/<provider>/collect.ts` |
| Checks catalogue (title, why, severity, control codes, API calls, fix) | `…/catalog.ts` |
| Pure evaluation → outcomes with named resources | `…/evaluate.ts` |
| Scan (collect → evaluate → populations → `integrations.last_scan`) | `…/scan.ts` |
| Must-not-pass cases | `…/checks.cases.ts` |
| Page `/integrations/<provider>` and public `/checks/<provider>` | `lib/integrations/registry.ts` → generic page |
| Engine (one path for every `ProviderScan`, roster → leaver checks) | `lib/checks.ts` `rawChecksFor` |
| Daily cron (HR first, code hosts, then ticket trackers) | `lib/sync-company.ts` |

## Per integration

### GitHub (must) — 16 checks
- **Connect:** a read-only GitHub App (Metadata, Administration, Pull requests,
  Members, org Administration, Dependabot / secret / code-scanning alerts — all
  read; no Contents, so no code). Created from a manifest by
  `scripts/github-app-setup.ts`. Tokens still work.
- **Checks:** org requires 2FA; members without 2FA; ≤3 owners; leavers;
  unknown members; default branch needs a reviewed PR (classic protection *or*
  rulesets); merged PRs without an independent approval (approver ≠ author,
  before the merge); Dependabot on; Dependabot critical/high past SLA (7/30
  days); open leaked secrets; public repositories. Good to know: outside
  collaborators, force pushes, admin bypass, code scanning, write deploy keys.
- **Population:** every merged PR (repo, number, author, merged by, approvers,
  ticket ID) in `code_changes`, filed daily on *Track every production change*.
- **Noise avoided:** archived repos ignored; topic `shieldflow-out-of-scope`;
  a 404 on protection only means "none" when GitHub says "Branch not protected".

### Google Workspace (must) — 8 checks
- **Connect:** admin OAuth, `admin.directory.user.readonly` +
  `admin.reports.audit.readonly`. Both read-only; the token API (`users.tokens`)
  would list app grants too but its scope can revoke them — not asked for.
- **Checks:** 2SV *enforced* (names the org unit); everyone enrolled; admins
  with 2SV; ≤3 super admins; dormant 90+ days (new joiners excepted); leavers;
  unknown accounts. Good to know: third-party apps that can read Gmail / all of
  Drive / admin settings → "Add to Vendors" or approve with a reason.
- **Noise avoided:** suspended and archived accounts aren't live; `drive.file`
  isn't "all of Drive"; sign-in-only apps aren't listed.

### Microsoft 365 / Entra (must) — 12 checks
- **Connect:** the customer's own app registration, application permissions
  with admin consent. Only `User.Read.All` is required; each other permission
  adds checks (`AuditLog.Read.All`, `Policy.Read.All`,
  `RoleManagement.Read.Directory`, `Directory.Read.All`,
  `DeviceManagementManagedDevices.Read.All`) and its absence is "can't tell".
- **Checks:** MFA *required* (Security Defaults, or a Conditional Access policy
  for all users and all apps — report-only doesn't count); everyone registered
  (needs Entra ID P1 — says so); admins with MFA; ≤4 Global Admins; leavers;
  unknown accounts. Good to know: guests, apps consented to read mail/files.
  Intune: encryption, check-in, coverage, leavers' laptops.

### HR systems — Personio, HiBob, BambooHR (must, 25+ people) — 3 checks each
- **Connect:** read-only API credentials / service user / API key.
- **What it does:** syncs Personnel every morning — joiners added, notice
  periods kept active with their leaving date, leavers offboarded, hand-made rows
  adopted by email, nobody deleted. Every other leaver check then runs off HR.
- **Checks:** work email on file; every leaver has a leaving date; joiners
  finish security training within 30 days. **Population:** last 12 months'
  leavers, filed daily on the offboarding measure.
- **Not yet:** Rippling, Gusto, Deel.

### MDM — Kandji, Jamf Pro, Intune (must) — 4 checks each
- **Checks:** disk encryption on every device (stale = can't tell); checked in
  within 14 days; everyone in Personnel has a managed device; no device still
  checking in for a leaver. **Population:** the day's device list on *Protect
  company devices*.
- **Not yet:** Google endpoint management, JumpCloud, Kolide.

### Cloudflare (should) — 6 checks
TLS (Full strict + 1.2 + HTTPS only), HSTS, DNSSEC (pending = can't tell),
members' 2FA (unless the account enforces it), leavers, unknown members.

### Google Cloud (should) — 9 checks
Every project the service account sees (Viewer + Security Reviewer): ≤3 owners,
nothing granted to allUsers, personal Gmail accounts, service accounts with
Owner/Editor, user-managed keys > 90 days, public buckets, SSH/RDP open to the
internet, Cloud SQL public or without SSL, Cloud SQL without backups. A disabled
API means "not used" — nothing to check — not "can't tell".
**Not yet:** workload-identity federation instead of a JSON key; SCC findings.

### Okta (should) — 9 checks
MFA on **every** active account (the old 50-user sample is gone; a rate limit
mid-way is "can't tell"), SMS/voice/email-only, admins without a strong factor,
≤3 Super Administrators, dormant, password minimum, apps that still keep a
password, leavers, unknown accounts. **Not yet:** reading authentication
policies (whether MFA is *required* at sign-in).

### GitLab (should) — 7 checks
gitlab.com or a self-managed server (https, public hostname). Group 2FA, default
branch only via MRs, approvals required (a Premium feature — on Free this
fails, honestly), merged MRs without an approval, public projects; good to know:
force push, write deploy keys. **Population:** merged MRs, filed daily.

### Jira / Linear (should)
Each merged change's ticket ID looked up (title, status, link); changes with no
ticket or a non-existent one listed; incident tickets (type Incident or label
incident / security-incident) kept and filed on the incident log. **Opt-in:**
"Create a ticket" for a failing check, into the project/team chosen — the only
thing ShieldFlow ever writes.

### Slack (should)
A message when a check starts failing in the morning scan (informational ones
never alert), and the digest every Monday. Both on by default, both switchable.

## Never

- An endpoint agent: MDM covers it and "no agent" is part of the pitch.
- Write access anywhere, except opt-in ticket creation.
- A pass on a partial read.

## Sources

Vendor API references: GitHub REST/GraphQL (branch rules, Dependabot, secret
scanning, app manifests); Google Admin SDK Directory and Reports; Microsoft
Graph (userRegistrationDetails, conditionalAccess, directoryRoles,
managedDevices); Personio v1, HiBob People search, BambooHR custom reports;
Kandji device API, Jamf Pro computers-inventory; Cloudflare v4 (zones, settings,
DNSSEC, account members); Google Cloud IAM, Storage, Compute, Cloud SQL Admin;
Okta Users, Factors, IAM role assignees, Policies; GitLab REST (protected
branches, approval rules, merge requests); Jira Cloud REST v3; Linear GraphQL.
Auditor evidence lists and competitor reviews: see CUSTOMER_NEEDS_RESEARCH.md.
