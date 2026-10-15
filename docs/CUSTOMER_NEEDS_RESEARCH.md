# What Sam Needs From ShieldFlow — and What We're Missing

**Date:** 2026-09-29 · **Customer:** the persona in `USER_PERSONA.md` — an engineer
who inherited compliance at an 11–200 person SaaS company, asked for SOC 2 by a
US buyer and NIS2/DORA by an EU one.

**Method.** Three sources, cross-checked against the code as it is today:

1. **What the auditor actually tests** — published fieldwork checklists and PBC
   (prepared-by-client) request lists. This decides *must-have*: if the auditor
   asks for it and we can't produce it, Sam fails or does it by hand.
2. **What competitors ship and what their users complain about** — Vanta, Drata,
   Secureframe, Comp AI, Oneleet; G2, Capterra and review-site summaries.
3. **What EU customers demand of suppliers** — NIS2 Article 21 and DORA
   Article 30 guidance written for SaaS vendors.

Every gap below was checked in the codebase before being listed as missing.

> **Update, 2026-10-09: the AWS round (branch `aws-deep`).** Gap #1 is closed and
> then some. AWS now connects through a read-only role (SecurityAudit plus an
> explicit deny on data reads, External ID per workspace), across several
> accounts each in or out of audit scope, with 36 checks. Every failure names the
> resource with a Terraform-first fix, and the Extended Support cost is shown. On top
> of the checks are the four things the research said nobody does for Sam: **who can reach
> production** (Identity Center + IAM, matched to Personnel → leavers and
> unknown logins, one-click access-review roster), **changes made by hand**
> (console/root writes from CloudTrail, kept past 90 days, "record why"),
> **restore tests** (AWS Backup + native restores, remembered), and **verified
> facts** (where data lives and whether it's in the EU, encryption, backups,
> logging) feeding questionnaire drafts, Co-Pilot, a DORA/NIS2 supplier data
> sheet and — opt-in — the Trust Center. Day-by-day `check_history` is the
> Type II groundwork. Setup and code map: `docs/AWS_SETUP.md`. Gaps #2–#10 and
> the other integrations are unchanged.

---

## The short version

**The product's shape is right; its depth is thin.** Measures, cross-framework
credit, EU frameworks, honest "inconclusive" results, the questionnaire and
Trust Center are genuine strengths. What's missing is *depth under the
integrations* and *the audit-day plumbing* — the parts a buyer only notices in
week three, which is exactly when they churn.

| | ShieldFlow (2026-09-29 → status 2026-10-15) | What the category ships |
|---|---|---|
| Automated checks, total | **17**, across 8 integrations + 1 internal → **125** across 15 integrations, every one with a "can't tell" path | Vanta advertises **1,400+** tests; Prowler (open source) maps **191 AWS checks** to SOC 2 alone |
| AWS checks | **2** (root MFA, password policy) → **39**, every account and used region | Vanta ~150 AWS tests; Drata numbered tests for CloudTrail, RDS, EBS, KMS, EFS… |
| Device / laptop evidence | **None** → ✅ Intune, Kandji, Jamf (no agent): encryption, check-in, coverage vs Personnel | Every competitor: an agent *or* an MDM integration |
| HR system (source of truth for joiners/leavers) | **None** → ✅ Personio, HiBob, BambooHR sync Personnel daily | Standard: Rippling, Gusto, BambooHR, Deel, HiBob, Personio |
| Vulnerability management | **None** → ✅ Dependabot / secret / code-scanning alerts with SLA (GitHub), AWS Inspector | Dependabot / Snyk / Inspector feeds with remediation SLAs |
| Evidence for the auditor | Per-control, download one file at a time | Exportable audit package; auditor portal |
| Check history (needed for Type II) | **Overwritten on every sync** | Kept, dated, exportable |

### The ten gaps that matter most, ranked

| # | Gap | Why it ranks here | Effort |
|---|---|---|---|
| 1 | **AWS depth: ~25 checks, not 2** | AWS is in almost every Sam's stack, and it's where auditors find the most exceptions (unencrypted new resources, public buckets, missing CloudTrail). Two checks makes "continuous monitoring" hard to defend in a demo. | M |
| 2 | **Device evidence via MDM (no agent)** | Auditors ask every time: disk encryption, screen lock, OS updates on every laptop. Reading it from Intune / Jamf / Kandji / Google endpoint management keeps the "no agent" promise *and* closes the gap. | M |
| 3 | **Keep check history** | Every sync deletes and rewrites results, so there is no record of what was true last month. Blocks Type II completely — which the 11–50 customer will need in year two. Without it we're a one-year product. | M |
| 4 | **GitHub depth: change management + Dependabot** | Change management (CC8.1) is sampled in every audit: "show me this deploy's PR, its reviewer, its approval." We check branch protection exists, not that changes were actually reviewed. Dependabot alerts are free data in the same token. | M |
| 5 | **Auditor evidence package** | Auditors want 40–60 items at a time, labelled by control. Today Sam downloads files one by one. An "Export for auditor" (zip by control, with check results and populations) is table stakes. | S–M |
| 6 | **HRIS integration** | Joiner/leaver checks are our best feature, but they compare the identity provider against a roster Sam maintains by hand. The HR system should be the roster. Start with one US (Rippling or Gusto) and one EU (Personio or HiBob). | M each |
| 7 | **Microsoft 365 MFA** | We read Google 2FA and Okta MFA, but not Microsoft's — the code notes it needs one more consent. Half of Sam's market is on Microsoft. | S |
| 8 | **Populations for sampling** | Auditors start with "every hire, every leaver, every production change, every access change in the period", then sample. We have the roster but no dated populations or completeness proof. | M |
| 9 | **Questionnaires in the customer's format** | Munich sends an Excel file or a OneTrust portal link, not pasted text. Import XLSX/Word, export back in the same layout, and a reusable answer library. | M |
| 10 | **NIS2/DORA supplier kit** | The EU buyer needs a 24-hour incident-notice commitment, subprocessor list, exit plan and DORA "register of information" data. We cover the frameworks; we don't yet produce the supplier *deliverables*. This is the edge Vanta and Drata don't have. | S–M |

---

## How to read the rest

- **Must-have** — the auditor tests it, or the buyer won't sign without it. Missing it means Sam does it by hand or fails.
- **Should-have** — a real buying factor, and a common complaint when a competitor lacks it.
- **Nice-to-have** — makes the product feel premium; nobody leaves over it.

Status: ✅ have · 🟡 partial · ❌ missing.

---

## Part 1 — Integration depth (the part you asked about)

### What "depth" means here

Review sites repeatedly make the same criticism of the category: connectors that
"sync but don't pick up the right evidence", and tests that "confirm a setting
exists rather than proving the control operates". Depth has three layers:

1. **Configuration** — is MFA enforced? is the bucket encrypted? (point-in-time)
2. **Operation** — did every change get reviewed? was every leaver removed within the SLA? (a population over time)
3. **History** — was it true on each day of the audit period? (Type II)

ShieldFlow is mostly at layer 1, reaches layer 2 for leavers and untracked
accounts (a genuine strength), and has no layer 3.

### AWS — 2 checks today

We read root-account MFA and the IAM password policy. The auditor fieldwork
checklist names **"new cloud resources created during the period that lack
encryption"** and **"new cloud resources not in the asset inventory"** as the
*most frequently cited exceptions* in their areas. We check neither.

**Must-have (the ~25 checks that cover what auditors actually cite):**

| Area | Checks | SOC 2 |
|---|---|---|
| Logging | CloudTrail on in all regions; log file validation on; CloudTrail logs encrypted; VPC Flow Logs on | CC7.2, CC7.3 |
| Threat detection | GuardDuty enabled in every active region; no open high-severity findings | CC7.1, CC7.2 |
| Storage | S3 Block Public Access at account level; no public buckets; default encryption on every bucket; versioning on buckets marked critical | CC6.1, CC6.7 |
| Databases | RDS encrypted at rest; not publicly accessible; automated backups on; deletion protection on | CC6.1, A1.2 |
| Compute | EBS default encryption on in every region; no public EBS snapshots/AMIs; IMDSv2 required | CC6.1 |
| Network | No security group open to 0.0.0.0/0 on 22, 3389 or database ports | CC6.6 |
| Identity | Every IAM user with a console password has MFA; access keys older than 90 days; unused access keys and console users; no users with admin policies attached directly | CC6.1–6.3 |
| Keys | KMS customer-key rotation on | CC6.1 |
| Config | AWS Config recorder on (it's what proves "inventory") | CC7.1, CC8.1 |

**Should-have:** Security Hub enabled; CloudWatch alarms on root login and IAM
policy changes; log retention ≥ 1 year; AWS Backup plans exist; an **asset
inventory generated from the account** (EC2, RDS, S3, Lambda) that feeds the
Assets measure — this answers the reconciliation test directly.

**The permission question.** We tell prospects we need two read permissions
(Maaz heard this). Twenty-five checks need more reads — but AWS publishes a
managed, read-only policy for exactly this, `SecurityAudit`. Say "AWS's own
read-only SecurityAudit policy, no write access of any kind"; that is still an
honest, strong answer to a DevOps buyer.

**Effort:** M. The pattern exists (`lib/aws.ts` → `EVALUATORS`); the work is the
checks, multi-region iteration, and mapping each to measures.

### GitHub — 2 checks today (branch protection, repo visibility)

**Must-have**
- **Change-management population.** For the audit period: every merged PR into
  the default branch, its author, its approving reviewer, and whether the author
  approved their own change. Auditors sample 25–40 of these; "the engineer who
  wrote the code is the same person who approved it" is the named
  separation-of-duties finding. This single report is the strongest evidence a
  small team can hand over for CC8.1.
- **Required reviews are actually required** (branch protection with ≥1 approving
  review and dismiss-stale-reviews), not just "protection exists".
- **Org requires 2FA** for members.
- **Dependabot alerts:** open critical/high alerts and their age against a
  remediation SLA (e.g. critical 7 days, high 30). This is the vulnerability-
  management evidence most startups can produce for free.

**Should-have:** secret-scanning alerts; code-scanning alerts; outside
collaborators with write access; number of org owners.

**Effort:** M. Needs PR/review reads and the Dependabot alerts permission.

### Google Workspace — 3 checks (2-step verification, leavers, untracked accounts)

Strong on layer 2. Cheap additions using data the Directory API already returns:
- **Must-have:** 2-step verification **enforced**, not just enrolled (the user
  record distinguishes the two); number of super admins (auditors like ≤3).
- **Should-have:** accounts with no sign-in for 90+ days (dormant, the check
  Oneleet sells); endpoint/device inventory if Google endpoint management is used
  (see devices below).

**Effort:** S.

### Microsoft 365 / Entra ID — 2 checks (leavers, untracked accounts)

- **Must-have:** **MFA registration** for every active user. The code deliberately
  skipped it because it needs one more admin consent (authentication-methods
  reports). Ask for it: MFA is the first thing every auditor and every
  questionnaire checks, and we already do it for Google and Okta.
- **Should-have:** Security Defaults or Conditional Access requiring MFA; global
  admin count; Intune device compliance (doubles as the device check below).

**Effort:** S (MFA), M (Intune).

### Okta — 5 checks (MFA, password policy, SSO coverage, leavers, untracked)

The deepest integration we have, and it already pages through every user.
**Should-have:** admin count; inactive users.

### Google Cloud — 1 check · Cloudflare — 1 check · GitLab — 2 checks

- **GCP (should-have):** audit logs on, Cloud SQL encryption and public IPs,
  firewall rules open to the internet, service-account key age — the GCP mirror
  of the AWS list, smaller because fewer of Sam's peers run on GCP.
- **Cloudflare (nice-to-have):** WAF enabled, minimum TLS 1.2, HSTS on.
- **GitLab:** same shape as GitHub; do it after GitHub.

### Jira / Linear — connected, but read an inventory only

Today we read the project list as "change-management evidence". That proves a
ticket queue exists, not that changes were approved.
- **Should-have:** **link PRs to tickets** (branch or PR title references) so the
  change population shows ticket → PR → review → merge; **push remediation
  tasks** from failing checks into Jira/Linear, where Sam's team actually works.

### Slack — daily digest

- **Should-have:** post a failing check to a channel as it happens (we now
  email it; engineers live in Slack).

### Integrations we don't have at all

| Category | Must / Should / Nice | Why | Start with |
|---|---|---|---|
| **Devices (MDM)** | **Must** | Auditors require proof of disk encryption, screen lock, OS updates and MDM enrolment for every laptop that touches production. The persona's "no agent" answer is honest, but it leaves Sam taking screenshots. MDM integrations fix it without an agent. | Microsoft Intune, Jamf, Kandji (now Iru), Google endpoint management; later JumpCloud, Kolide |
| **HRIS** | **Must** (for 25+ people) | The HR system is the auditor's source of truth for hires and terminations. It should drive Personnel, so the leaver check compares identity provider against HR, not against a hand-kept list. | US: Rippling, Gusto, BambooHR, Deel · EU: Personio, HiBob |
| **Vulnerability scanning** | **Must** | Auditors sample critical/high findings and trace each to a fix within the SLA. | Dependabot (via GitHub — free), then Snyk, AWS Inspector |
| **Azure** | **Should** | Microsoft-shop customers often host on Azure; we have no Azure checks. | Defender for Cloud secure score + storage/SQL encryption + public exposure |
| **Background checks** | **Should** | Required evidence for new hires in most SOC 2 control sets. Vanta resells Certn. | Certn (US + EU), Checkr (US) — or simply a tracked field + upload on Personnel |
| **Security training content** | **Should** | We track completions; Sam still has to find training. Vanta and Oneleet include it. | Built-in short annual module, or KnowBe4 / Curricula import |
| **Logging & alerting** | **Should** | "Alerts firing without documented resolution" is the most common monitoring finding. | Datadog monitors, PagerDuty/Opsgenie incident history |
| **Password manager** | Nice | Proves "passwords are in a password manager" (a measure we already have). | 1Password, Bitwarden admin reports |
| **EDR / antivirus** | Nice | Some customers answer the malware control this way instead of MDM. | CrowdStrike, SentinelOne |
| **EU hosting** | Nice — but a real angle | EU startups often run on Hetzner, OVH or Scaleway; the big platforms barely cover them. | Hetzner Cloud API (firewalls, backups, volumes) |

---

## Part 2 — The audit itself

What the auditor requests in fieldwork, area by area, against what ShieldFlow
produces today.

| Area | Auditor asks for | ShieldFlow | Gap | Priority |
|---|---|---|---|---|
| Access provisioning | Every access change in the period; sampled approvals | ❌ | No record of access *grants* or approvals | Should |
| Terminations | Every leaver, and proof access went within 24–48h | ✅ leaver check (Google, Microsoft, Okta) | Dated history of when each leaver was actually removed (needs check history) | Must |
| Access reviews | Each cycle, with attestations | ✅ access reviews + signed CSV + cadence check | — | — |
| MFA | Configuration evidence | 🟡 Google, Okta, AWS root | Microsoft MFA; AWS IAM users | Must |
| Change management | Every production deploy → ticket → review → approval | 🟡 branch protection only | PR-level population | Must |
| Training | Completion for everyone incl. contractors; new hires within 30 days | 🟡 manual records | No content; no "within 30 days of start" check (we have start dates — easy win) | Should |
| Policies | Approved, versioned, acknowledged annually | ✅ generate, approve, publish, acknowledge | Annual re-acknowledgement reminder | Nice |
| Background checks / NDAs | Proof for each sampled hire | ❌ | Not tracked on Personnel at all | Should |
| Incident response | Formal incident log (not Slack), tabletop exercise | 🟡 as a measure + evidence | A real incident log with severity, dates, closure | Should |
| Encryption | Every data store, including ones created in the period | ❌ | AWS checks (Part 1) | Must |
| Backups / DR | A restore test with results against RTO/RPO | 🟡 as a measure + evidence | "A plan with no test results" is the top finding here — add a tracked DR-test record | Should |
| Monitoring | Logging on; alerts resolved | ❌ | AWS logging checks; alert integrations | Must / Should |
| Vulnerabilities | Scan history; criticals traced to fixes within SLA | ❌ | Dependabot / Snyk | Must |
| Vendors | Register, tiering, current SOC 2 reports, DPAs | ✅ register, risk, SOC 2 status; 🟡 expiry | Alert when a vendor's report expires; DPA tracking | Should |
| Risk assessment | Register, reviewed | ✅ risk register + heat map | — | — |
| Assets | Inventory reconciled against the cloud | 🟡 manual | Generate from AWS/GCP (Part 1) and MDM | Should |
| Evidence delivery | 40–60 items at a time, labelled by control | ❌ one file at a time | **Audit package export** | Must |
| Population completeness | The query/filter used to produce each list | ❌ | Stamp every export with source, date range and query | Should |
| Type II | Evidence that controls operated across 3–12 months | ❌ history overwritten | **Keep check history** | Must (year 2) |
| Auditor access | Read-only access to controls and evidence | ✅ auditor role | Auditor request/comment workflow | Nice |
| Auditor to hire | A firm that accepts our evidence | ❌ | Partner firms (not a feature — a business deal) | Should |

---

## Part 3 — Winning the deal: questionnaires and Trust Center

Sam buys ShieldFlow because a customer sent a questionnaire. This is the first
job the product does for them.

| Feature | ShieldFlow | Priority | Notes |
|---|---|---|---|
| AI draft grounded in real work | ✅ (fixed this week — measures, checks, documents) | — | A genuine strength: it flags what it can't back up |
| Import **Excel / Word / PDF** questionnaires | ❌ paste text only | **Must** | That's the format questionnaires actually arrive in |
| Export in the **customer's original format** | ❌ CSV only | **Must** | Customers want their own file back, filled in |
| **Answer library** (approved answers reused next time) | ❌ | Should | Loopio/Whistic's core; the second questionnaire should take minutes |
| Answers cite the evidence document | 🟡 names it | Should | Link to the file or Trust Center |
| Standard templates (SIG Lite, CAIQ) | ❌ | Nice | Pre-answered once, reused everywhere |
| Portal questionnaires (OneTrust, Whistic, Ariba) | ❌ | Nice | Browser-extension territory; later |
| Trust Center: live score, frameworks, subprocessors | ✅ | — | Numbers now match the dashboard |
| Trust Center: **NDA-gated document downloads** | ❌ request form only | Should | Prospects want the SOC 2 report or pen-test summary behind a click-through NDA |
| Trust Center: custom domain (trust.company.com) | ❌ | Nice | Looks professional in a sales email |

---

## Part 4 — The EU edge: NIS2 and DORA supplier deliverables

Vanta and Drata don't cover these frameworks; we do. But an EU customer doesn't
send a framework, they send **demands on the supplier**. Each is a small feature
that turns our framework coverage into something Sam can hand over.

| What the EU customer demands | ShieldFlow | Priority | The feature |
|---|---|---|---|
| Incident notice within **24 hours** (NIS2 early warning), with a route and minimum content | ❌ | **Must** for EU | Incident record with a customer-notification clock and a notice template |
| Subprocessor list, and notice of changes | ✅ list on Trust Center | Should | Change log + "notify subscribers" |
| Security measures mapped to NIS2 Article 21 | ✅ via framework mapping | — | Export as a one-page "Article 21 statement" |
| Secure development practices (Art. 21(3)) | ❌ | Should | GitHub depth (Part 1) produces this |
| **DORA register of information** data for the bank's register | ❌ | Should (fintech customers) | A structured supplier data sheet (entity, services, data locations, subcontractors) exportable as CSV |
| DORA Art. 30 contract addendum | ❌ | Should | Template + tracked status per customer |
| **Exit plan** and data portability (DORA) | ❌ | Should | Template + evidence of a tested export |
| Pen test / TLPT participation | 🟡 tracked as a task | Nice | Pen-test record with findings and fix dates |
| EU data residency | ✅ data hosted in eu-west-1 | — | **Say it on the pricing page.** It's a real differentiator for EU buyers |
| GDPR records (processing register, DPIA) | 🟡 privacy measures exist | Should | Record-of-processing template tied to the data inventory measure |

---

## Part 5 — Staying compliant (the four-hours-a-week promise)

| Need | ShieldFlow | Priority |
|---|---|---|
| Daily checks, email on change | ✅ | — |
| One place that says what to do next | ✅ Co-Pilot (now leads with failing checks), 14-day sprint | — |
| Accept a failing check as a known risk, with a reason and expiry | 🟡 only for untracked accounts ("not a person") | **Should** — every false positive currently stays red forever |
| Quiet alerts | 🟡 every high-risk vendor is its own alert even after review | Should |
| Remediation tickets in Jira/Linear | ❌ | Should |
| Recurring tasks (reviews, pen tests) | ✅ | — |
| Team invite emails | ❌ link must be sent by hand | **Must** — first-week friction |
| Trial-expiry email | ❌ | Should |
| SSO for ShieldFlow itself | 🟡 settings tab exists | Nice for 11–50, Should for 51–200 |
| SCIM | ❌ | Nice (Vanta charges extra for it) |

---

## What competitors charge, and what that means for us

| | Price (reported) | What's bundled | What it tells us |
|---|---|---|---|
| Vanta | $7.5k–$57k/yr, ~$20k median; renewals jump | 400+ integrations, 1,400+ tests, agent, training, background checks | Depth is the moat; price is the complaint |
| Drata | Similar to Vanta | 200+ apps, numbered AWS tests, custom tests | Custom tests let customers cover what connectors miss |
| Secureframe | Quote | 300+ integrations, agent **and** 17 MDM integrations | MDM is an accepted alternative to an agent |
| Oneleet | $15k–$30k | Pen test, code scanning, vCISO, agent | Small teams value "someone does it with me" |
| Comp AI | Quote, open source | ~590 integrations (depth disputed), agent, AI automations | Integration *count* is cheap; reviewers still hit manual work |

**The takeaway.** We shouldn't chase integration *count*: Comp AI lists 590 and
reviewers still say "connectors didn't automate nearly as much as expected".
Chase **depth in the six systems Sam actually runs** — AWS, GitHub, Google or
Microsoft, one HRIS, one MDM, Dependabot — and the audit-day plumbing. That
beats a long logo wall for this buyer.

---

## Recommended order

**Next 4–6 weeks — "pass the audit without screenshots"**
1. AWS depth (~25 checks) with the SecurityAudit policy
2. Keep check history (unblocks Type II and dated leaver evidence)
3. GitHub: PR change population + Dependabot + org 2FA
4. Microsoft 365 MFA; Google 2SV enforced + admin count
5. Audit package export (zip by control, with populations and check history)
6. Team invite emails

**Following 6–8 weeks — "no manual roster, no laptop screenshots"**
7. MDM: Intune first (it also completes the Microsoft story), then Jamf / Kandji / Google endpoint
8. HRIS: Rippling or Gusto (US) + Personio or HiBob (EU)
9. Questionnaire Excel/Word import and same-format export; answer library
10. NIS2 incident-notice workflow + DORA supplier data sheet

**After that — "premium"**
Background checks, built-in training, Azure, Jira/Linear remediation sync,
risk acceptance on any check, NDA-gated Trust Center downloads, SIG/CAIQ
templates, Hetzner.

**Don't build (yet):** an endpoint agent (MDM covers it, and "no agent" is a
selling point), portal-questionnaire browser extensions, hundreds of shallow
connectors.

---

## What we already do that competitors don't

Keep saying these; the research supports every one:
- **Do the work once**, including evidence (fixed this week): 328 requirements, 71 measures.
- **NIS2, DORA, CRA** alongside SOC 2 and ISO 27001.
- **Honest results**: "inconclusive" instead of a false pass; the questionnaire flags what it can't back up.
- **Leaver and untracked-account checks** reach layer 2 (operation, not just configuration).
- **No agent**, EU-hosted data, flat pricing.

---

## Sources

- Auditor fieldwork by area: [SOC 2 Audit Checklist — soc2auditors.org](https://soc2auditors.org/insights/soc-2-audit-checklist/)
- Population completeness: [Keiter CPA](https://keitercpa.com/blog/soc-2-challenges-population-completeness-va-cpa-firm/)
- PBC lists: [Agency](https://getagency.com/auditor-pbc-list)
- AWS SOC 2 check mapping (191 checks): [Prowler soc2_aws.json](https://github.com/prowler-cloud/prowler/blob/master/prowler/compliance/aws/soc2_aws.json)
- Vanta AWS tests in practice: [DEV — 23 Vanta red tests](https://dev.to/aayostem/i-turned-23-vanta-red-tests-green-in-14-days-here-is-the-exact-command-for-each-one-ihp), [Vanta AWS](https://www.vanta.com/integrations/aws)
- Drata AWS tests: [Test 222](https://help.drata.com/en/articles/9828725-test-222-aws-cloudtrail-logs-encrypted), [Drata monitoring](https://help.drata.com/en/collections/2653986-monitoring)
- Test and integration counts: [Sprinto comparison](https://sprinto.com/blog/secureframe-vs-vanta-vs-drata/), [tech-insider pricing](https://tech-insider.org/vanta-vs-drata-vs-secureframe-2026/)
- Vanta reviews and limits: [soc2auditors.org Vanta review](https://soc2auditors.org/insights/vanta-review/), [ComplyJet Vanta reviews](https://www.complyjet.com/blog/vanta-reviews), [G2](https://www.g2.com/products/vanta/reviews)
- MDM as agent alternative: [Secureframe supported MDMs](https://support.secureframe.com/en/articles/15111590-supported-mdms-and-their-endpoint-security-capabilities), [Screenata on remote endpoints](https://screenata.com/resources/answers/how-do-i-prove-endpoint-security-for-soc-2-as-a-remote-first-startup)
- Background checks & training: [Vanta background checks](https://help.vanta.com/en/articles/11345825-background-checks-in-vanta), [Vanta SAT](https://help.vanta.com/hc/en-us/articles/4404436950420-Vanta-Security-Awareness-Training-SAT)
- Comp AI: [review](https://soc2auditors.org/insights/comp-ai-review/), [device agent](https://www.trycomp.ai/docs/device-agent)
- Oneleet: [Sprinto review](https://sprinto.com/blog/oneleet-review/)
- Questionnaire formats: [AutoRFP buyer's guide](https://autorfp.ai/blog/best-security-questionnaire-software)
- NIS2 supplier demands: [Outlex NIS2 checklist](https://outlex.ai/blog/nis2-compliance-checklist-saas-startups), [NIS2Dir Art. 21(2)(d)](https://nis2dir.eu/en/articles/nis2-supply-chain-security)
- DORA for SaaS vendors: [Atlant Security](https://atlantsecurity.com/blog/dora-for-saas-companies), [Article 30](https://www.springlex.eu/en/packages/dora/dora-regulation/article-30/)
- HRIS landscape: [Trackr small-business HR comparison](https://www.trytrackr.com/blog/best-hr-software-for-small-business)

*Codebase facts checked 2026-09-29: 17 automated checks (`lib/checks.ts`,
`lib/identity-checks.ts`); check results replaced on every sync
(`lib/checks.ts`, delete-then-insert); training is completion tracking only;
no evidence export; GitHub reads branch protection and visibility; no Azure,
HRIS, MDM or vulnerability-scanner integration.*

*Status 2026-10-15: gaps 1 (AWS depth), 2 (MDM, no agent), 4 (GitHub change
management + Dependabot), 6 (HRIS: Personio, HiBob, BambooHR), 7 (Microsoft 365
MFA) and 8 (populations: merged changes, leavers, devices, incidents filed daily)
are built — see docs/INTEGRATIONS_DEEP_RESEARCH.md. Rippling and Gusto are not
yet integrated.*
