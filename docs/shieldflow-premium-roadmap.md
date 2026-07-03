---
name: shieldflow-premium-roadmap
description: "ShieldFlow premium build-out is a phased, multi-session roadmap; how it's sequenced and what's done"
metadata: 
  node_type: memory
  type: project
  originSessionId: ccfd7731-767d-4050-a56f-fc9a3840fbbb
---

ShieldFlow (compliance SaaS, Vanta/Drata-style) is being built out from a tracker into a premium platform across ~13 features. The user approved a **phased roadmap, built one phase per session**, verifying each before the next.

Plan file: `C:\Users\Bate Emo\.claude\plans\ok-can-you-now-imperative-lake.md`. Source of features: `shieldflow/docs/PREMIUM_GAP_PLAN.md` (status markers updated as features land). See [[shieldflow-infra]] for repo/deploy/schema facts.

**Done (on branches, NOT yet merged to main as of 2026-06-28):**
- Secret encryption (pre-existing, `lib/crypto.ts`).
- **Phase 0.2** notifications rail — branch `phase-0-notifications` (migration 0017; bell, `/notifications`, prefs; trigger = control assignment).
- **Phase 1 complete** — branch `phase-1-control-testing` (stacked on phase-0, so it contains phase-0 too):
  - 1.2 check engine was already built (`lib/checks.ts`, `control_checks`, control page shows checks + complete-but-failing flag).
  - 1.3 integration evidence surfaced on controls (`listEvidence` merges via `control_checks.evidence_id`; "Auto" badge).
  - 1.1 `integration_findings` (migration 0018 + `record_integration_findings` RPC; `recordChecksForSync` writes findings).
  - 1.4 continuous cron `/api/cron/sync` (`CRON_SECRET`-gated, service-role admin client, `lib/integration-sync.ts` dispatch for aws/github/okta/gcp/cloudflare/gitlab; `recordChecksForSyncAdmin` bypasses RLS + preserves evidence link; drift digest per company via `notifyCompanyViaAdmin`; scheduled by `app/vercel.json` daily; see `docs/CRON_SETUP.md`).

Branches stacked: merging `phase-1-control-testing` brings phases 0+1. User merges to main themselves (production deploy); do NOT push to main without explicit ok.

**Action needed from user before cron works:** set `CRON_SECRET` (value is in `app/.env.local`) in Vercel env. Email drift digests need `RESEND_API_KEY` (not set). Deferred in 1.4: run-lock, backoff, scale pagination, Google continuous sync.

- **Phase 3.3 tasks** — branch `phase-tasks-calendar` (stacked on phase-1). Migration 0019 `tasks` table + `task` notification category; `/tasks` inbox (`components/tasks/TaskManager.tsx`, `app/actions/tasks.ts`); recurring tasks respawn on completion; assignee notification; overdue dashboard alert; nav entry.

- **Phase 2.3 policy approval + acknowledgement** — branch `phase-policy-approval` (stacked on tasks). Migration 0020 (policies +approved_by/approved_at/version/published_at/review_cadence_months; new `policy_acknowledgements`). Owner/admin Approve→Publish (notifies members), per-member "I acknowledge", "N of M acknowledged", version bump+reset on edit, dashboard alerts. Acknowledgers = team members. Also delivers core of 4.3 (versioning).

- **Phase 4.5 risk register depth** — branch `phase-risk-depth` (stacked on policy). Migration 0021 (`risks` +residual_likelihood/residual_impact; new `risk_controls` join). Inherent vs residual scoring, control multi-select linking, `lib/risk-library.ts` (14 templates), 3×3 `RiskHeatmap`, residual-aware dashboard alerts.

- **Phase 4.2 v1 vendor depth** — branch `phase-vendor-depth` (stacked on risk). Migration 0022 (vendors +review_cadence_months/contact_email/soc2_status/soc2_expires_at/data_sensitivity). Mark-reviewed action (edit no longer stamps reviewed_at), review-overdue + SOC2-expired dashboard alerts, SOC2/PII/overdue badges. Questionnaire/AI-parse/discovery deferred.

- **Phase 4.1 v1 questionnaire AI** — branch `phase-questionnaire-ai` (stacked on vendor). Migration 0023 (`questionnaires` + `questionnaire_items`). `/questionnaires` workspace: paste questions → `/api/questionnaire` drafts answers grounded in company context (Groq), ungroundable → needs_review; per-item edit/status, CSV export. Nav entry. Deferred: xlsx in/out, >25 Q batching.

- **Phase 2.2 v1 access reviews** — branch `phase-access-reviews` (stacked on questionnaire). Migration 0024 (`access_reviews` + `access_review_items`). `/access-reviews` workspace: create from pasted subject list (frozen snapshot), keep/revoke per row, complete → generates CSV evidence in vault + stamps completed. Never revokes access itself. Nav entry. Deferred: auto-snapshot from integration, control auto-satisfy.

- **Phase 4.4 v1 trust depth** — branch `phase-trust-depth` (stacked on access-reviews). Migration 0025 (`subprocessors` + anon `get_trust_subprocessors` RPC; `trust_access_requests` no-insert-policy). Public /trust/[slug] subprocessors section + lead-capture form → `/api/trust-request` (IP rate-limited + honeypot). Owner manages subprocessors + triages requests in settings. Deferred: gated docs → signed URLs.

- **Phase 2.1 v1 personnel roster** — branch `phase-personnel`. Migration 0026 (`personnel`). /personnel roster + per-person training status.
- **Phase 3.1 auditor hardening** — branch `phase-auditor-hardening` (stacked on personnel). Verified live DB: all write policies use `can_write_company` (auditors RLS-blocked everywhere incl. integrations); `remove_member` refuses to remove owner; expiry cuts access. Added `assertCanWrite` friendly gate to all 10 integration connect/sync/disconnect + shared `disconnectProvider`.

Branch order (each stacked on previous): notifications → control-testing → tasks-calendar → policy-approval → risk-depth → vendor-depth → questionnaire-ai → access-reviews → trust-depth → personnel → **`phase-auditor-hardening` (newest)**. Merging the newest brings ALL 12. As of 2026-06-28 the stack is **12 phases deep, NONE merged**. Migrations 0017–0026 applied to live Supabase (additive; harmless until code merges).

- **3.2 SSO Phase A (SSO app side)** — branch `phase-sso-a` (stacked on auditor-hardening, the 13th/newest). Migration 0027 (`company_sso_domains` globally-unique + `join_company_via_sso()` RPC). "Sign in with SSO" in AuthForm (`signInWithSSO({domain})`, graceful if no IdP); JIT auto-join wired into onboarding; owner SsoSettings (auto-verify when domain matches owner email). Needs Supabase Pro + a registered SAML IdP to fully light up.

**ENTIRE GAP PLAN BUILT (v1).** Every feature shipped including SSO Phase A. Only **3.2 Phase B (SCIM)** remains — documented in `docs/SSO_SCIM_PLAN.md` + gap plan §3.2; not built (needs WorkOS + an enterprise-deal trigger). Minor optional leftovers: 4.1 xlsx, 4.2 public vendor questionnaire + SOC2 AI-parse, 4.4 gated-doc signed URLs.

Branch order tip is now **`phase-sso-a`** (13 phases stacked; merging it brings everything). Test plan: `docs/PREMIUM_TEST_PLAN.md`. **Real next step: user merges + verifies the stack on shieldflow.cloud, sets CRON_SECRET (+ optional RESEND_API_KEY), and for SSO adds Supabase Pro + a test IdP.**

**Sequence (gap-plan TL;DR):** 0.2 notifications → 1.x continuous control testing (check engine is ~70% there: `lib/checks.ts`, `control_checks` table) → 3.1 auditor RBAC (~70%) + 3.3 tasks → 2.2 access reviews + 2.3 policy approval/acknowledgement → 4.1 questionnaire AI → 3.2 SSO/SCIM + 4.2 vendor depth + 4.5 risk depth.

**Per-phase workflow:** apply migration via Supabase MCP + mirror SQL into `app/supabase/migrations/`; `npm run build` in `shieldflow/app`; commit on a feature branch; push; user previews + merges (main auto-deploys). Reuse existing conventions (server-action `companyOrError` + Zod + `logEvent`; `lib/db/queries.ts` helpers; `components/ui/*`; alerts via `lib/monitoring.ts computeAlerts`).
