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

### 0.2 Notifications infrastructure (email + in-app) 🔴
**Why it matters.** Today the only outbound signal is an on-demand Slack digest. A premium tool tells the right person "your control just broke" without them opening the app. Everything in Phase 1–3 needs this rail.

**Shape.** `notifications` table (user_id, company_id, type, title, body, link, read_at, created_at). In-app notification center (bell + unread count). Email via Resend with per-user, per-type preferences (`notification_prefs`). A batching layer so a cron run that flips 40 controls sends **one** digest, not 40 emails.

**Acceptance.** Assigning work or breaking a control produces an in-app notification and (if opted in) a batched email; SMTP failure never blocks the underlying action; removed members stop receiving anything.

**Edge cases →** EDGE_CASES §E4 · **Tests →** TESTING §40

---

## Phase 1 — Continuous Control Testing (the core differentiator) 🔴

This is the product. It makes the existing 10 integrations 10× more valuable.

### 1.1 Structured findings from integrations 🔴
**Why it matters.** Right now a sync emits a human-readable CSV and stops. We need machine-readable findings the engine can reason over.

**Shape.** Each sync writes rows to `integration_findings` (company_id, provider, check_key, value, observed_at, raw jsonb) — e.g. `aws / root_mfa_enabled / false`. The CSV stays as human evidence; the findings drive the engine.

### 1.2 Check engine: finding → control test → pass/fail 🔴
**Why it matters.** This is the closed loop. A "check" maps one or more findings to one or more controls and evaluates pass / fail / inconclusive.

**Shape.** `checks` catalog (check_key, title, framework control codes it satisfies, severity, evaluator). `control_check_results` (company_id, control_id, check_key, result, detail, evaluated_at). A control's automated status = aggregate of its checks. **Disconnected/partial/permission-denied data is `inconclusive`, never `pass`** — we never show green from absent data.

**Acceptance.** Connect AWS with root MFA off → the mapped control auto-fails with a finding; enable MFA + re-sync → flips to pass; the report is auto-attached as evidence. Manual status and automated status are both visible; a conflict (human says "complete," check says "fail") is surfaced, never silently overwritten.

### 1.3 Auto-attach evidence to controls 🔴
**Why it matters.** The PRD's headline promise ("automated evidence collection") is only half-built — evidence lands in the vault unattached ([lib/integration-evidence.ts:52](../lib/integration-evidence.ts#L52)).

**Shape.** When a check runs, link its report to every control the check satisfies (`evidence.control_id` set, or a join table for many-to-many). Re-runs **replace** the prior auto-evidence for that check (no pileup); manual uploads are never touched.

### 1.4 Scheduled / continuous syncs 🔴
**Why it matters.** "Continuous monitoring" is in the tagline but every sync is a manual button today. Premium = daily background re-sync + drift detection.

**Shape.** A protected cron endpoint (Vercel Cron / Supabase scheduled function) authenticated by a secret header. Per-company, per-integration isolation so one bad token doesn't abort the batch; exponential backoff on permanently-erroring integrations; a run lock so overlapping invocations don't stack; skips churned/canceled accounts.

**Acceptance.** The cron re-syncs all connected integrations, re-runs checks, and emits drift notifications; the endpoint 401s without the secret; a single revoked token flags that one company and the rest still sync.

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

### 2.3 Policy attestation by employees 🔴
**Why it matters.** Generating a policy isn't enough — auditors want proof each employee read and accepted the current version.

**Shape.** Publish a policy version → employees get an attestation request (in-app + email) → they acknowledge a specific version. Bumping the version flags everyone "needs re-attestation." Removed employees keep their historical attestation snapshot.

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

### 3.3 Tasks, remediation & compliance calendar 🔴
**Why it matters.** Controls have an owner/due-date but there's no task inbox and no recurring obligations (annual access review, quarterly pen test, yearly policy review).

**Shape.** `tasks` (assignee, due, status, linked control/risk/vendor). Recurring tasks spawn the next instance on completion. Calendar view of upcoming obligations. Drives notifications (Phase 0.2).

**Edge cases →** EDGE_CASES §E7 (RBAC/auditor) + §E8 (SSO/SCIM) + §E6 (tasks) · **Tests →** TESTING §43 + §45 + §42

---

## Phase 4 — Sales accelerators 🔴

Features that directly close deals. Can follow Phase 1–3.

### 4.1 Security questionnaire / RFP automation 🔴
**Why it matters.** A top buying trigger — "answer security questionnaires for us." You already have the AI rail (Groq).

**Shape.** Upload a questionnaire (xlsx/csv) → AI drafts answers **grounded only in this company's data** → human reviews → export in the original format. Answers it can't ground are flagged "needs review," never fabricated.

### 4.2 Vendor questionnaires & SOC 2 collection 🔴
**Why it matters.** The PRD promised "questionnaire sending"; the vendor module is a register today.

**Shape.** Send a token-scoped, expiring, unauthenticated link to a vendor email; vendor answers + uploads their SOC 2 report (mime/size validated, scoped storage). Reminder cadence for non-responders.

### 4.3 Policy lifecycle (versioning + approval) 🔴
**Why it matters.** Auditors want version history, an approval step, and attestations (4.x ties into 2.3).

**Shape.** Editing a final policy creates an immutable new version; publish requires approval; export any version.

### 4.4 Trust Center depth 🔴
**Why it matters.** Today it's public read-only aggregates. Premium gates documents behind NDA/email request, lists subprocessors, and captures leads.

**Shape.** Gated docs require email/NDA acceptance before a short-lived signed URL is issued; an access-request flow with rate-limiting; a public subprocessor list.

**Edge cases →** EDGE_CASES §E9 (questionnaires) + §E11 (vendor questionnaires) + §E10 (policy lifecycle) + §E12 (trust depth) · **Tests →** TESTING §46–§49

---

## Recommended build order (TL;DR)

1. **0.1 Encrypt secrets** — removes a deal-killer, ~days of work.
2. **0.2 Notifications rail** — prerequisite for everything reactive.
3. **1.1–1.4 Continuous control testing** — *the* premium feature; delivers the actual PRD promise.
4. **3.1 Auditor role/portal** + **3.3 Tasks** — fast follow, high buyer value.
5. **2.2 Access reviews** + **2.3 Policy attestation** — the people pillar auditors demand.
6. **4.1 Questionnaire automation** — sales accelerant, reuses the AI rail.
7. **3.2 SSO/SCIM**, **4.2–4.4** — enterprise & growth, can trail.

Each item ships only when its EDGE_CASES Part 2 row has a real fix in code (move it up into Part 1 with a file ref) and its TESTING Part C section passes.

---

**Document Version:** 1.0 · **Last Updated:** June 2026
