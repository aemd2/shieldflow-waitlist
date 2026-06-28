# ShieldFlow — Premium Gap Plan

**What separates the current app from a Vanta/Drata-class platform you can charge €599–1,299/mo for — and the build order to close it.**

Status legend: 🔴 not started · 🟡 partial · 🟢 shipped
Date: June 2026 · Owner: founder/PM

---

## How to read this

ShieldFlow is already a real product: hardened auth, 10 integrations, 5 frameworks, risk register, training, audit trail, billing, Trust Center, team/RBAC. The gaps below are **not** "you forgot to build it." They are the features that turn a compliance *tracker* into a compliance *platform* — the things a security buyer or auditor expects when they pay premium money.

Every feature here has:
- **Why it matters** (the buyer/auditor reason)
- **Shape** (rough schema / endpoints / approach — not final design)
- **Acceptance** (how we know it's done)
- **Edge cases →** pointer into [EDGE_CASES.md](./EDGE_CASES.md) Part 2
- **Tests →** pointer into [TESTING.md](./TESTING.md) Part C

> The single most important finding from the code audit: **the integration → control loop is never closed.** Synced reports are filed into the evidence vault with `control_id: null` ([lib/integration-evidence.ts](../lib/integration-evidence.ts)), and the alert engine ([lib/monitoring.ts](../lib/monitoring.ts)) only reasons over data you typed in by hand — it never reads what the integrations actually found. Closing that loop (Phase 1) is the heart of the premium product.

---

## Phase 0 — Credibility & foundations 🔴

Cheap, fast, and they unblock everything after them. Do these first.

### 0.1 Encrypt integration secrets at rest 🔴
**Why it matters.** We sell security, but every integration token/key is stored unencrypted (see SETUP.md ops note + EDGE_CASES Google note). The first question in any security review is "how do you store our API keys." Plaintext is a deal-killer and a hypocrisy.

**Shape.** App-layer envelope encryption: a `SHIELDFLOW_ENCRYPTION_KEY` (32-byte, from env/KMS) encrypts each secret with AES-256-GCM before insert; decrypt only at sync time. Alternatively Supabase Vault / `pgcrypto`. New columns: `secret_ciphertext`, `secret_iv`, `secret_tag`, `key_version`.

**Acceptance.** A raw `select` on the integrations table shows ciphertext only. Removing the key env var makes the app refuse to store/read secrets (fail closed) rather than fall back to plaintext. Key rotation re-encrypts without downtime.

**Edge cases →** EDGE_CASES §E1 · **Tests →** TESTING §37

### 0.2 Notifications infrastructure (email + in-app) 🟢 shipped
**Why it matters.** Today the only outbound signal is an on-demand Slack digest. A premium tool tells the right person "your control just broke" without them opening the app. Everything in Phase 1–3 needs this rail.

**Shape.** `notifications` table (user_id, company_id, type, title, body, link, read_at, created_at). In-app notification center (bell + unread count). Email via Resend with per-user, per-type preferences (`notification_prefs`). A batching layer so a cron run that flips 40 controls sends **one** digest, not 40 emails.

**Acceptance.** Assigning work or breaking a control produces an in-app notification and (if opted in) a batched email; SMTP failure never blocks the underlying action; removed members stop receiving anything.

**Shipped (migration 0017_notifications).** `notifications` + `notification_prefs` tables with RLS (user reads only own rows); `notify_users()` SECURITY DEFINER RPC is the sole writer (validates membership, honors per-category prefs, returns email-opted-in recipients). [lib/notify.ts](../app/lib/notify.ts) writes in-app rows + best-effort email via the Resend HTTP API (no SDK; no-op without `RESEND_API_KEY`). Topbar bell + unread badge, `/notifications` center, per-category prefs in Settings. First trigger live: assigning a control to a teammate notifies them. **Still to wire:** triggers for control-broke/overdue and removed-member silence come with the Phase 1 check engine + cron; set `RESEND_API_KEY` in Vercel to turn on email.

**Edge cases →** EDGE_CASES §E4 · **Tests →** TESTING §40

---

## Phase 1 — Continuous Control Testing (the core differentiator) 🟢 shipped (Google sync + run-lock/scale deferred)

This is the product. It makes the existing 10 integrations 10× more valuable.

### 1.1 Structured findings from integrations 🟢 shipped
**Why it matters.** Right now a sync emits a human-readable CSV and stops. We need machine-readable findings the engine can reason over.

**Shape.** Each sync writes rows to `integration_findings` (company_id, provider, check_key, value, observed_at, raw jsonb) — e.g. `aws / root_mfa_enabled / false`. The CSV stays as human evidence; the findings drive the engine.

**Shipped (migration 0018).** `integration_findings` table (member-read RLS) + `record_integration_findings` SECURITY DEFINER RPC (replace-per-provider). `recordChecksForSync` now writes findings alongside checks on every manual sync, and the cron (1.4) writes them via the admin client. [lib/checks.ts](../app/lib/checks.ts).

### 1.2 Check engine: finding → control test → pass/fail 🟢 shipped
**Why it matters.** This is the closed loop. A "check" maps one or more findings to one or more controls and evaluates pass / fail / inconclusive.

**Shape.** `checks` catalog (check_key, title, framework control codes it satisfies, severity, evaluator). `control_check_results` (company_id, control_id, check_key, result, detail, evaluated_at). A control's automated status = aggregate of its checks. **Disconnected/partial/permission-denied data is `inconclusive`, never `pass`** — we never show green from absent data.

**Acceptance.** Connect AWS with root MFA off → the mapped control auto-fails with a finding; enable MFA + re-sync → flips to pass; the report is auto-attached as evidence. Manual status and automated status are both visible; a conflict (human says "complete," check says "fail") is surfaced, never silently overwritten.

**Shipped.** [lib/checks.ts](../app/lib/checks.ts) has 8 provider evaluators → `record_control_checks` RPC writes `control_checks` (pass/fail/inconclusive, absent data = inconclusive). The control page renders the automated checks and **flags the complete-but-failing conflict** ([app/(app)/controls/[id]/page.tsx](<../app/app/(app)/controls/[id]/page.tsx>)); the dashboard shows the passing/failing summary. **Remaining for 1.1:** the raw `integration_findings` layer (checks currently read posture directly from the sync handler).

### 1.3 Auto-attach evidence to controls 🟢 shipped
**Why it matters.** The PRD's headline promise ("automated evidence collection") is only half-built — evidence lands in the vault unattached ([lib/integration-evidence.ts:57](../app/lib/integration-evidence.ts#L57)).

**Shape.** A synced CSV maps to many controls, so rather than set the single `evidence.control_id`, surface a control's auto-evidence through the existing `control_checks.evidence_id` link (read-side). Re-runs replace prior auto-evidence per check; manual uploads are never touched.

**Shipped.** `listEvidence` now merges the integration reports linked via `control_checks.evidence_id` into a control's evidence list (tagged `source:"integration"`), and both `evidenceCounts` (dashboard badge + "completed without evidence" alert) and the control-detail count include them, de-duped per control. The control page shows these reports with an **Auto** badge and no manual delete (they're FK-referenced and auto-managed); download reuses the existing signed-URL action. [lib/db/queries.ts](../app/lib/db/queries.ts), [components/evidence/EvidenceList.tsx](../app/components/evidence/EvidenceList.tsx).

### 1.4 Scheduled / continuous syncs 🟢 shipped (v1)
**Why it matters.** "Continuous monitoring" is in the tagline but every sync is a manual button today. Premium = daily background re-sync + drift detection.

**Shape.** A protected cron endpoint (Vercel Cron / Supabase scheduled function) authenticated by a secret header. Per-company, per-integration isolation so one bad token doesn't abort the batch; exponential backoff on permanently-erroring integrations; a run lock so overlapping invocations don't stack; skips churned/canceled accounts.

**Acceptance.** The cron re-syncs all connected integrations, re-runs checks, and emits drift notifications; the endpoint 401s without the secret; a single revoked token flags that one company and the rest still sync.

**Shipped (v1).** `GET|POST /api/cron/sync` ([app/api/cron/sync/route.ts](<../app/app/api/cron/sync/route.ts>)), `CRON_SECRET`-gated (401 without it), service-role admin client. Re-fetches posture for the 6 token-based providers (`aws/github/okta/gcp/cloudflare/gitlab` — Google OAuth is manual-only), re-evaluates checks via `recordChecksForSyncAdmin` (preserves the evidence link, writes findings), and emits **one drift digest per company** when a check crosses into/out of `fail` (in-app via `notifyCompanyViaAdmin`). Per-integration isolation; auth-errors flip that integration to `needs reconnect`. Scheduled by `app/vercel.json` (daily) — see [CRON_SETUP.md](./CRON_SETUP.md). **Deferred:** run-lock, backoff, pagination/queue at scale, and email drift digests (needs `RESEND_API_KEY`); a sub-daily `pg_cron` recipe is in CRON_SETUP.

**Edge cases →** EDGE_CASES §E2 (engine) + §E3 (scheduler) · **Tests →** TESTING §38 (engine) + §39 (scheduler)

---

## Phase 2 — People & Access pillar 🔴

A third of SOC 2 is about people, and it's currently a blank space.

### 2.1 HRIS / personnel roster 🟡
**Why it matters.** Auditors want a roster: who works here, when they joined/left, did they finish security training, did they accept the policies. Training exists; the roster and the rest don't.

**Shape.** `personnel` table (can seed from Okta/Google directory or HRIS later). Links to training records and policy attestations. Onboarding/offboarding checklist per person.

### 2.2 Access reviews 🔴
**Why it matters.** "Periodic access review" is a named control in every framework. Today there's no way to run one.

**Shape.** A review *campaign* snapshots user/access lists from connected identity systems (Okta/Google/GitHub) **at start**, assigns a reviewer, who attests keep/revoke per row; completion generates a signed evidence record and satisfies the control. We record the attestation — we do **not** actually revoke access (read-only; revocation is a liability we don't own).

**Acceptance.** Start a review from Okta data → snapshot frozen even if the token later dies; reviewer attests all rows → evidence PDF generated, control satisfied; re-running creates a new versioned campaign, never overwrites the prior one.

### 2.3 Policy approval + employee acknowledgement 🟢 shipped (v1)
**Why it matters.** This is the #1 gap a real SOC 2 / ISO buyer notices. Generating a policy isn't enough — **a policy only counts as evidence once a named person has approved it and employees have acknowledged it.** Today we have a lightweight `draft → final` toggle ([components/policies/PolicyGenerator.tsx](../app/components/policies/PolicyGenerator.tsx)) but no approver of record and zero acknowledgement tracking. Auditors literally ask for the acknowledgement records.

**How Vanta/Drata do it (validated June 2026).** Each policy is tied to **two tests**: (1) is it *approved* by a designated approver — the person who'd answer the auditor's questions, and (2) have *all relevant employees accepted* the current version. The linked control stays **failing** until both tests pass. Policies also **expire annually** and re-prompt approval + re-acknowledgement.

**Shape.**
- **Approval.** A policy is submitted for approval to a named approver (owner/admin). Approval stamps `approved_by`, `approved_at`, and the version. Only an *approved* policy can be published for acknowledgement. (Optional later: multi-step approval, up to a few approvers per step — Drata's Pro/Enterprise model.)
- **Acknowledgement.** Publishing an approved version creates an attestation request (in-app + email) for each active person on the roster (§2.1). They acknowledge a **specific version**. We track who has / hasn't, with a live "N of M acknowledged" count.
- **Renewal.** Each policy has a review cadence (default annual). On expiry it flips to "needs re-approval"; a new version flags everyone "needs re-attestation." Removed employees keep their historical attestation snapshot.
- **Control mapping.** A control linked to a policy is **not satisfied** until the policy is both approved and fully acknowledged — mirrors the integration→control loop in Phase 1.

**Acceptance.** Generate a policy → submit → approver approves (stamped + versioned) → publish → every active employee gets an acknowledgement request → dashboard shows "N of M acknowledged" → linked control only goes green when approved **and** 100% acknowledged. Bumping the version resets acknowledgement and re-prompts. An expired policy surfaces a "needs review" alert.

**Shipped (migration 0020).** `policies` gained `approved_by/approved_at/version/published_at/review_cadence_months`; new `policy_acknowledgements` table (one immutable row per policy+version+person; member-read, acknowledge-own RLS). Acknowledgers = team members (people with logins). Owner/admin **Approve** → **Publish for acknowledgement** (notifies all members via the `policy` category) → each member sees an **"I acknowledge"** button; the editor + list show live **"N of M acknowledged"**. Editing an approved/published policy **bumps the version and resets approval + acks** (old acks are version-scoped, so they no longer count). Dashboard alerts: "policy awaiting acknowledgement" and "policy due for review" (cadence). [app/actions/policies.ts](../app/app/actions/policies.ts), [components/policies/PolicyGenerator.tsx](../app/components/policies/PolicyGenerator.tsx). **Deferred:** email acknowledgement requests (needs `RESEND_API_KEY`), a non-user personnel roster (§2.1), control↔policy gating, multi-step approval. This also delivers the core of **§4.3** (policy versioning).

**Edge cases →** EDGE_CASES §E5 (access reviews) + §E10 (policy lifecycle) · **Tests →** TESTING §41 + §44

---

## Phase 3 — Enterprise enablers 🔴

You charge €1,299 for "Enterprise." These are what that tier actually means.

### 3.1 Granular RBAC + Auditor role & portal 🔴
**Why it matters.** Roles are owner/member only ([app/actions/team.ts](../app/actions/team.ts)). Enterprises need admin / contributor / viewer, and — the big one — a **read-only, time-boxed auditor** who can review evidence without seeing billing, secrets, or team management. Kills the screenshot-emailing dance.

**Shape.** Extend the role enum; RLS policies per role; an auditor is read-only across controls/evidence/policies and **blocked server-side** (not just UI-hidden) from every write, plus billing/settings/team/integration-secrets. Auditor invites are time-boxed and auto-expire. The last owner can never be removed/downgraded.

**Acceptance.** An auditor session can read finalized evidence and nothing else; every write and every admin surface is rejected at the server; access expires on schedule.

### 3.2 SSO / SAML + SCIM 🔴
**Why it matters.** Table-stakes for enterprise procurement; you only have consumer Google login.

**Shape.** SAML via Supabase Auth SSO (or WorkOS). JIT provisioning on first login; SCIM for deprovisioning (removing a user in the IdP removes app access and invalidates sessions). Domain-ownership verification so one tenant can't capture another's email domain. A break-glass owner login for when the IdP is down.

**Acceptance.** Forged/unsigned/replayed/wrong-audience assertions are rejected; SCIM deprovision revokes access immediately; SSO-enforced orgs still have a documented break-glass path.

### 3.3 Tasks, remediation & compliance calendar 🟢 shipped (v1)
**Why it matters.** Controls have an owner/due-date but there's no task inbox and no recurring obligations (annual access review, quarterly pen test, yearly policy review).

**Shape.** `tasks` (assignee, due, status, linked control/risk/vendor). Recurring tasks spawn the next instance on completion. Calendar view of upcoming obligations. Drives notifications (Phase 0.2).

**Shipped (migration 0019).** `tasks` table (member-read / can_write_company RLS), `/tasks` inbox ([components/tasks/TaskManager.tsx](../app/components/tasks/TaskManager.tsx)) with priority/status/due/recurrence, sidebar nav, and full CRUD ([app/actions/tasks.ts](../app/app/actions/tasks.ts)). Completing a recurring task (weekly/monthly/quarterly/annually) **spawns the next instance** with the due date advanced. Assigning a task to a teammate fires a `task` notification (new notification category); overdue tasks raise a dashboard alert via `computeAlerts`. **Deferred:** the link-to-control/risk/vendor/policy picker (columns exist, no UI yet) and a month-grid calendar (the due-sorted list + overdue highlighting is the v1 "calendar").

**Edge cases →** EDGE_CASES §E7 (RBAC/auditor) + §E8 (SSO/SCIM) + §E6 (tasks) · **Tests →** TESTING §43 + §45 + §42

---

## Phase 4 — Sales accelerators 🔴

Features that directly close deals. Can follow Phase 1–3.

### 4.1 Security questionnaire / RFP automation 🔴
**Why it matters.** A top buying trigger — "answer security questionnaires for us." You already have the AI rail (Groq).

**Shape.** Upload a questionnaire (xlsx/csv) → AI drafts answers **grounded only in this company's data** → human reviews → export in the original format. Answers it can't ground are flagged "needs review," never fabricated.

### 4.2 Vendor risk depth (register → engine) 🟡 partial (assessment + cadence shipped; questionnaire + AI parse remain)
**Why it matters.** Today the vendor module is a **manual register** ([components/vendors/VendorManager.tsx](../app/components/vendors/VendorManager.tsx)): you type the name, hand-pick a `risk_level` from a dropdown, and drop "SOC 2 on file" in a notes box. Vanta/Drata turn this into a **workflow that pulls data in and pushes work out** — that's the "missing something" gap. The PRD itself promised "questionnaire sending"; it's a register today.

**How Vanta/Drata do it (validated June 2026).** Centralize a vendor inventory, **auto-ingest the vendor's SOC 2 / DPA** (AI extracts findings instead of a notes box), **send security questionnaires** and chase responses, assign a **risk score from evidence** (not a hand-picked level), and feed vendor findings **directly into the risk register** for one unified view.

**Shape.**
- **Questionnaire sending.** Token-scoped, expiring, unauthenticated link to a vendor email; vendor answers + uploads their SOC 2 report (mime/size validated, scoped storage). Reminder cadence for non-responders.
- **SOC 2 / DPA auto-parse.** AI reads an uploaded report and extracts structured findings (report type, audit period, exceptions) → attaches to the vendor instead of free-text notes.
- **Auto-discovery.** Surface candidate vendors from connected integrations (Google/Okta OAuth grants, AWS spend) so the inventory isn't 100% manual entry.
- **Review cadence.** The existing unused `reviewed_at` field drives a recurring "re-review every N months" obligation with reminders (Phase 0.2 rail) and a dashboard "vendor review overdue" alert.
- **Findings → risk register.** A high-risk vendor or a questionnaire red flag can spawn a linked entry in the risk register (§4.5) — one unified risk view.

**Shipped (migration 0022).** Vendors gained `review_cadence_months`, `contact_email`, `soc2_status` (none/requested/on_file), `soc2_expires_at`, `data_sensitivity` (none/internal/pii/phi). The register is now a reviewable assessment: a **Mark reviewed** action stamps `reviewed_at` (editing other fields no longer does), the cadence drives a **"vendor review overdue"** dashboard alert, and an expired SOC 2 raises **"vendor SOC 2 expired."** The list shows SOC 2 / PII / review-overdue badges. [app/actions/vendors.ts](../app/app/actions/vendors.ts), [components/vendors/VendorManager.tsx](../app/components/vendors/VendorManager.tsx). **Remaining for 4.2:** the public token-scoped vendor questionnaire + SOC 2 upload, AI SOC 2 parsing, auto-discovery from integrations, and vendor-finding → risk spawn.

**Acceptance.** Send a questionnaire → vendor responds + uploads SOC 2 → AI surfaces findings on the vendor → risk score reflects the evidence, not a dropdown → an overdue review raises a dashboard alert → a critical finding can open a linked risk.

### 4.3 Policy lifecycle (versioning + approval) 🔴
**Why it matters.** Auditors want version history, an approval step, and attestations (4.x ties into 2.3).

**Shape.** Editing a final policy creates an immutable new version; publish requires approval; export any version.

### 4.4 Trust Center depth 🔴
**Why it matters.** Today it's public read-only aggregates. Premium gates documents behind NDA/email request, lists subprocessors, and captures leads.

**Shape.** Gated docs require email/NDA acceptance before a short-lived signed URL is issued; an access-request flow with rate-limiting; a public subprocessor list.

### 4.5 Risk register depth (register → engine) 🟢 shipped (treatment→tasks deferred)
**Why it matters.** Same shape of gap as vendors (§4.2). The risk register ([components/risks/RiskManager.tsx](../app/components/risks/RiskManager.tsx)) is a clean **manual register** — it auto-computes severity from `likelihood × impact` (good), but every risk is hand-typed from a blank box, floats **disconnected from the controls** that mitigate it, and the `treatment` field is just a paragraph with no tracking. Auditors expect a risk *assessment process*, not a list.

**How the incumbents do it.** A risk **library/templates** so users pick from common framework risks instead of inventing them; **risk → control linking** (the control is the mitigation); **treatment plans as tracked tasks** with owners + due dates; a **risk matrix heat-map** view; and **inherent vs. residual** scoring (severity before mitigation vs. after).

**Shape.**
- **Risk library.** Seed a catalog of common risks per framework (SOC 2 / ISO / HIPAA …); "add from library" pre-fills title, category, default likelihood/impact.
- **Control linking.** A join table `risk_controls` maps each risk to the controls that treat it; a risk's residual score reflects how many linked controls are complete.
- **Inherent vs. residual.** Capture likelihood/impact **before** mitigation (inherent) and **after** (residual); the dashboard alert keys off residual.
- **Treatment as tasks.** The `treatment` paragraph becomes (or spawns) tracked tasks (§3.3) with assignee + due date, not free text.
- **Heat-map view.** A likelihood × impact grid (the 3×3 matrix auditors ask for), each cell linking to its risks.

**Acceptance.** Add a risk from the library → link it to 2 controls → set inherent High, residual Medium → completing the linked controls drops the residual badge → the risk shows on a heat-map → its treatment appears in the task inbox with an owner and due date.

**Shipped (migration 0021).** `risks` gained `residual_likelihood/residual_impact` (existing fields = inherent); new `risk_controls` join (member-read / can_write RLS). The form has separate **Inherent** and **Residual** scoring blocks, a **control multi-select** (link the mitigating controls), and an **"add from library"** picker ([lib/risk-library.ts](../app/lib/risk-library.ts), 14 common risks). The list shows **inherent → residual** badges + linked-control count, a **3×3 heat-map** ([components/risks/RiskHeatmap.tsx](../app/components/risks/RiskHeatmap.tsx)) sits above it, and the dashboard risk alerts key off **residual** when set. [app/actions/risks.ts](../app/app/actions/risks.ts) replaces the link set on save. **Deferred:** treatment → spawned tracked task, and auto-deriving residual from linked-control completion (residual is set manually for now).

**Edge cases →** EDGE_CASES §E9 (questionnaires) + §E11 (vendor questionnaires) + §E10 (policy lifecycle) + §E12 (trust depth) + §E13 (risk depth) · **Tests →** TESTING §46–§50

---

## Recommended build order (TL;DR)

1. **0.1 Encrypt secrets** — removes a deal-killer, ~days of work.
2. **0.2 Notifications rail** — prerequisite for everything reactive.
3. **1.1–1.4 Continuous control testing** — *the* premium feature; delivers the actual PRD promise.
4. **3.1 Auditor role/portal** + **3.3 Tasks** — fast follow, high buyer value.
5. **2.2 Access reviews** + **2.3 Policy approval + acknowledgement** — the people pillar auditors demand; acknowledgement records are a literal audit ask.
6. **4.1 Questionnaire automation** — sales accelerant, reuses the AI rail.
7. **3.2 SSO/SCIM**, **4.2–4.5** — enterprise & growth, can trail. (4.2 vendor depth + 4.5 risk depth turn the two manual registers into engines — same "close the loop to controls + pull data in" theme as Phase 1.)

Each item ships only when its EDGE_CASES Part 2 row has a real fix in code (move it up into Part 1 with a file ref) and its TESTING Part C section passes.

---

**Document Version:** 1.0 · **Last Updated:** June 2026
