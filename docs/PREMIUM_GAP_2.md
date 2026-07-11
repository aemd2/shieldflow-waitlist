# ShieldFlow — Premium Gap Plan 2 (Competitive)

**Date:** 2026-07-01 · **Status:** Documentation only — *nothing to build yet*. We are
testing what already exists first. This file records **what we're missing vs the market** so we
have a clear, prioritized roadmap when we decide to build.

Companion to `PREMIUM_GAP_PLAN.md` (which was our internal feature build-out). This one is the
**competitive** gap — measured against Vanta, Drata, Sprinto, and Secureframe as of mid-2026.

---

## 1. Where we stand (the good news)

Module coverage is **near-complete**. ShieldFlow already ships essentially every category the big
platforms have — this is not a "missing whole features" situation, it's a "breadth + one
architecture item" situation.

**At parity (feature exists and is built properly):**
- Guided onboarding (14-Day Sprint — arguably *ahead* of competitors' generic checklists)
- Per-control guidance + suggested evidence (all 74 controls)
- Continuous control monitoring (automated checks + cron sync + drift alerts)
- Evidence vault (manual + auto-collected)
- Policies: draft → approve → publish → acknowledge, with versioning
- Risk register (inherent/residual + heat-map + mitigating controls)
- Vendor / third-party risk (cadence, SOC 2 expiry, data classification)
- Security questionnaire AI
- Trust Center (public page, subprocessors, access requests, rate limiting)
- Access reviews · Personnel + training tracking · Tasks · Reports
- SSO (SAML) · RBAC with read-only auditor · AI Co-Pilot

**Differentiators to protect (do not regress these):**
- **14-Day Sprint** guided path — opinionated and finishable.
- **Price** — the "~80% less than Vanta" wedge.
- **Simplicity** — fewer knobs than Vanta/Drata (a frequent complaint about them).

---

## 2. The gaps, prioritized

### P0 — highest leverage (build these first, when we build)

**G1 · Integration breadth.**
- *Now:* 4 integrations — GitHub, AWS, Google Workspace, Slack.
- *Benchmark:* Vanta 400+ (1,200+ automated tests, hourly); Drata 300+ (1,000+ infra tests);
  Sprinto/Secureframe 100–150+.
- *Target for our ICP:* ~10–12 that cover 80% of SMB stacks. Highest-value missing:
  1. **Identity provider — Okta / Microsoft Entra** (access, MFA, joiners/leavers evidence)
  2. **HRIS — Gusto / Rippling / BambooHR** (personnel, onboarding/offboarding — the remaining gap
     after G17's Personnel bulk-add; every competitor treats manual/CSV entry as the fallback, HRIS
     sync as the real answer)
  3. **Ticketing — Jira / Linear** (change management + task evidence)
  4. **Cloud — Azure / GCP** (parity with AWS)
  5. **MDM — Kandji / Jamf** (endpoint/device checks)
- *Why:* directly caps how much evidence auto-collects; identity + HRIS are the two an auditor
  leans on most.

**G2 · Cross-framework control mapping (the one architectural must-have).**
- *Now:* one control belongs to exactly one framework (`controls.framework_id`). "Access Control"
  exists as 4 separate rows (SOC 2 CC6.1, ISO A.5.15, HIPAA 164.312(a)(1), PCI Req 7). A customer
  doing SOC 2 **and** ISO 27001 does the overlapping work — and uploads evidence — twice.
- *Benchmark:* Drata **DCF** (unified, framework-agnostic control set) and Vanta cross-mapping —
  implement once, satisfy many. 2026 buyer guides list "map once, apply across frameworks" as a
  **must-have**.
- *Target:* a shared control library + a many-to-many control↔requirement mapping, so status and
  evidence are entered once and flow to every mapped framework.
- *Cost:* real re-architecture (restructures how `control_status` seeds and how the dashboard
  scores). Do it deliberately, not rushed. This is the top lever for retaining multi-framework
  customers and moving upmarket.

### P1 — deepen what we have

- **G3 · Automated-test depth** — more checks per already-connected tool (more GitHub/AWS/Google
  signals), closer to competitors' hundreds-per-integration.
- ~~G4 · Monitoring cadence~~ — **done 2026-07-01**: hourly via Supabase `pg_cron` + `pg_net`
  (secret in Vault), matching Vanta's benchmark. Vercel's daily cron stays as a fallback. See
  `docs/CRON_SETUP.md`.
- **G5 · AI depth** — we have Co-Pilot + questionnaire AI. Competitors have autonomous agents:
  auto policy drafting, vendor auto-scoring, remediation suggestions, risk graphs. Incremental.
- **G10 · Notification trigger coverage** — found during §1/§3 testing: the notification system
  (bell/`/notifications`) only fires on 4 events (task assigned, control owner assigned, policy
  published, cron drift). Two real events an assignee would expect to hear about **don't** notify
  them, and only ever surface as a dashboard-only alert card someone has to happen to see:
  1. **Overdue tasks/controls** — `computeAlerts()` (`lib/monitoring.ts`) builds the "Tasks
     overdue"/"Overdue control" banner live on every dashboard load; no `notify()` call anywhere
     in it. Drata's docs explicitly describe notifying/digesting the assignee when their tasks
     come due or go overdue — we only tell whoever happens to open the dashboard.
  2. **Evidence uploaded by a teammate** — `evidence.ts` only calls `logEvent` (Activity trail),
     never `notify()`. An owner has no way to know a teammate uploaded something except by
     manually checking `/activity`.
  - *Fix shape:* reuse the existing `notify()` path (same pattern as task-assignment) — overdue
    would need a scheduled check (the hourly `pg_cron` job we already run is a natural place to
    add this); evidence-upload would be a one-line addition at the existing upload call site.
    Scoped, low-risk, deferred per "testing first" — not built.
- ~~G11 · Task traceability~~ — **done 2026-07-03**: found during §3 testing that `tasks` already
  had `linked_type`/`linked_id` columns (migration `0019_tasks.sql`) but nothing ever wrote, read,
  or displayed them — every task was freestanding, unlike Vanta's Action Tracker (tasks map back
  to the risk/control) or Drata's split risk-tasks/control-tasks (explicitly for audit
  traceability). Wired end to end: `taskSchema` validates `linked_type`/`linked_id`, the task form
  has a "Link to" picker (controls/risks/vendors/policies), the row shows a linked-item chip
  (deep-links to `/controls/:id`), and recurring spawns carry the link forward.
- **G12 · Auto-created remediation tasks** — Secureframe auto-generates a task when a vendor risk
  score crosses a threshold; Vanta's "Create Task" lives directly on a risk. ShieldFlow now has
  the linking (G11) but nothing yet *originates* a task from a risk/vendor page — a user has to
  go to `/tasks` and pick the link manually. Natural next step: a "Create remediation task" button
  on an open risk (with a treatment plan) and on an under-review/SOC-2-expired vendor, pre-filled
  and pre-linked. Not built.
- **G13 · Overdue severity tiering** — the dashboard's "Tasks overdue" alert is binary (overdue or
  not). Sprinto's alerts are described as tiered and time-bound so a 2-day-late item doesn't read
  the same as a 60-day-late one. Would need a "days overdue" bucket on the alert card. Not built.
- ~~G14a · Access reviews — live roster pull~~ — **done 2026-07-03**: found during §8 testing
  that `/access-reviews` was 100% manual paste. Added a live, on-demand pull reusing each
  provider's own per-user fetch (`fetchUsersRaw` for Okta, `fetchWorkspaceUsers` for Google
  Workspace). Superseded by G14c below, which moved this into a per-system picker instead of one
  shared textarea.
- ~~G14c · Access reviews — system-scoped restructure~~ — **done 2026-07-05**: after live-testing
  G14a's shipped version, real UX friction surfaced (naming a review with no context, one
  free-text "Source" when a review usually spans several systems, still-manual people entry for
  anything not integrated). Researched Vanta's and Drata's actual field-by-field flow (help docs,
  not guessed) and found both model a review as **multiple in-scope systems**, each auto-pulled if
  connected or **CSV-template-uploaded** if not, with the reviewer screen grouped by system and a
  third **Out of scope** decision state (Drata) alongside Keep/Revoke.

  Restructured to match: new `access_review_systems` table (migration `0030`, one review → many
  systems → many items — mirrors `0023_questionnaires.sql`'s parent→child→grandchild shape, not
  the pure-link `risk_controls` table); `access_review_items.decision` widened to include
  `out_of_scope`; new components `SystemPicker.tsx` (checkboxes for connected integrations + add-
  a-custom-system input, mirrors `RiskManager.tsx`'s checkbox pattern), `SystemRosterEditor.tsx`
  (Pull / Upload CSV with downloadable template / paste, per system), `AccessReviewCreateForm.tsx`
  (orchestrates the above, auto-derives the review name from chosen systems + quarter until
  edited); `AccessReviewWorkspace.tsx` detail view now groups accounts by system with
  Keep/Revoke/Out-of-scope per row; `completeAccessReview`'s evidence CSV groups by system too.
  Kept ShieldFlow's single-phase create-then-decide model — deliberately skipped Vanta's two-phase
  draft→"Start Review" state machine with scheduled reviewer notifications, per the PRD's
  simpler-than-Vanta/Drata positioning.
- **G14b · Access reviews — persisted roster history + scheduling** — still open. A permanent
  per-user snapshot history (so a review reflects "who had access as of the last full sync" even
  if the integration is later disconnected) and recurring/scheduled reviews (`access_reviews` has
  no `recurrence` column, unlike `tasks`). Real schema/architecture work — not built, scoping
  conversation needed first.
- ~~G15a · Personnel auto-created on Team invite~~ — **done 2026-07-05**: found while testing that
  Team (`company_members`) and Personnel were fully disconnected — a workspace's Team members had
  no matching Personnel rows at all. Researched Vanta and Drata's docs: both treat Personnel as the
  source of truth, with app access layered **on top of** a personnel record (Drata: "when employee
  records are created, everyone is granted an EMPLOYEE role"). Scoped to the narrowest slice:
  `accept_invite` (migration `0031`, the first migration to version this function — it and two
  siblings existed only in the live DB before, outside any tracked migration) now also inserts a
  `personnel` row, name guessed from the invitee's email local part (no real name is available at
  invite-acceptance time), editable afterward like any normal row.
- **G15b · Personnel auto-creation — remaining paths** — deliberately deferred, narrowed down from
  a broader first attempt that a safety check correctly flagged as exceeding what was approved
  (it bundled unrelated RPCs plus a backfill spanning every company in the shared database, not
  just one workspace). Three pieces left, each its own decision:
  1. **SSO auto-join** (`join_company_via_sso`) — same shape as an invite (someone new joining a
     Team), not yet wired to create a Personnel row.
  2. **Owner/company provisioning** (`create_company_with_framework`) — a brand-new signup's owner
     doesn't get a Personnel row either, so the owner remains a permanent gap in "every Team member
     has Personnel" unless this is added.
  3. **Backfill for existing members** — the 3 pre-existing Team members in the test workspace this
     was found in are still not in Personnel; nothing retroactive ran. If ever done, must be scoped
     to one `company_id` at a time (explicitly approved per company), never a database-wide sweep.
- ~~G16 · Delete UX — undo toast instead of a blocking confirm~~ — **done 2026-07-05**: found while
  fixing the access-review delete bug that the confirm()-modal-then-delete pattern (used everywhere
  via `useConfirm`) is also the root cause class of that bug (a dialog awaited inside a shared
  `useTransition`, whose `pending` flag every button on the page was gated on). Researched delete-UX
  best practice: for a reversible action, an undo toast beats a blocking "are you sure?" dialog —
  one click instead of two, and structurally can't have this bug class at all (no dialog, nothing
  to await inside a transition). `Toast.tsx` now supports an optional action button
  (`toast(kind, message, { label, onClick })`, lingers 5s); `AccessReviewWorkspace.tsx`'s delete
  hides the row immediately, shows "Deleted — Undo", and only calls the server action if the 5s
  window passes without Undo. Same swap flagged for Tasks/Personnel/Risks/Vendors/Questionnaires —
  each still uses the older confirm-modal pattern for delete, not yet migrated.
- ~~G17 · Personnel — bulk add (pull / CSV / paste)~~ — **done 2026-07-06**: `/personnel` was
  one-person-at-a-time only. Checked 7 competitors before building, not just Drata: **Vanta has no
  bulk personnel import at all** (one-by-one or full IdP/HRIS sync only — bulk CSV exists only for
  their vendors module); **Drata, Secureframe, Sprinto, Scrut, Thoropass** all offer some form of
  bulk/CSV import as the "no HRIS yet" fallback; **OneTrust** centralizes it as one platform-wide
  Bulk Import system rather than a per-module feature. So 6 of 7 offer this — it was a real gap, not
  a nice-to-have.

  Reused the pull/CSV-template/paste architecture already shipped for access reviews (`SystemPicker`
  → `SystemRosterEditor` pattern) rather than inventing a new one: new `PersonnelBulkAdd.tsx` offers
  **Pull from Okta/Google Workspace** (if connected — widened `fetchUsersRaw`/`fetchWorkspaceUsers`
  to also return real names, not just emails, since neither requested that field before), **Upload
  CSV** with a downloadable template, and **paste a whole list**. Two rounds of follow-up after
  checking competitors more carefully:
  1. Duplicate detection — Drata's *vendor* bulk-import (a close analogue) dedupes by a stable key
     and shows what's excluded before committing; Personnel's first cut didn't. Now flags rows
     matching an existing email as "Already in Personnel" and excludes them automatically.
  2. Inline row editing — Secureframe's CSV import specifically lets you double-click a cell to fix
     a validation error before committing, rather than losing the row or failing the whole batch.
     Added the same idea: a Pencil icon turns any row into editable inputs with live validation
     feedback; invalid rows are flagged red and excluded from the count/insert until fixed.

  Net result: ahead of Vanta (no bulk option), matching Drata/Sprinto/Scrut/Thoropass (CSV fallback
  pattern), matching Secureframe's inline-fix polish. **Remaining gap vs. all seven**: native HRIS
  sync (BambooHR, Gusto, Rippling, Workday) — every competitor treats manual/CSV as the *fallback*,
  not the ideal path. That's G1 (integration breadth), not a UI problem — no quick fix here.

- **G6 · Framework breadth** — FedRAMP, HITRUST, NIST CSF / 800-53, CMMC, TISAX, plus
  **custom frameworks**. Regional variants: relabel **UK GDPR**, add **Cyber Essentials** (UK
  public-sector), **CCPA / US state privacy** (larger US firms). (See the country analysis in the
  session notes — none block US/UK outreach today.)
- **G7 · Native security-awareness training** — researched 5 competitors 2026-07-08; unanimous,
  and this one's a content gap, not a UX gap (unlike G14/G17). `/training` today is a pure
  record-keeper: person, free-text course name, status, due date — no actual content behind it.
  - **Vanta**: full in-house library (Security Awareness for SOC 2/ISO 27001/NIST, plus
    HIPAA/GDPR/CCPA/PCI DSS, AI Risk, Secure Coding, Insider Threat, Social Engineering) —
    auto-assigned, segmentable by group. *Also* integrates with a dedicated training vendor
    (**SoSafe**) for extra content, rather than relying solely on its own library.
  - **Drata**: embedded native training (phishing, malware awareness, policy adherence) built
    into the onboarding flow itself.
  - **Secureframe**: built-in courses (Security Awareness, HIPAA, GDPR, CCPA, PCI, Secure Coding)
    with real video lessons + embedded quiz + auto-saved progress + auto-generated subtitles in
    multiple languages; auto-assigned at onboarding, recurring for annual recert.
  - **Sprinto**: pre-built, customizable courses per framework, auto-assigned during onboarding.
  - **OneTrust**: full LMS — self-paced eLearning or instructor-led, certification tracks,
    completion badges.
  - *Why not a quick fix:* every competitor's version means either producing/licensing real
    training video content, or building a quiz/progress-tracking engine — a different kind of
    investment than the UI/workflow work elsewhere in this doc.
  - *Realistic path:* follow Vanta's own precedent and **integrate with an existing training
    vendor** (SoSafe, KnowBe4, etc.) rather than build content in-house — employees complete
    real courses there, completion status syncs back to `/training` the way an HRIS sync would.
    Not started — needs a vendor/partnership decision before any building.
- **G8 · Background-check integrations** (e.g. Checkr) for personnel evidence.
- **G9 · Auditor collaboration depth** — we have a read-only auditor role; competitors offer an
  auditor portal + auditor network + human compliance-manager services.

---

## 2b. Per-module deep-dive (added 2026-07-11)

A page-by-page pass through the actual nav (Evidence, Policies, Reports, Questionnaires,
Activity, Vendors, Controls) reading our own code vs. competitor help docs, to surface
gaps the capability-organized G1–G17 list above missed. Each item notes **how ours works
today**, **how the market does it**, and whether it's parity or a real gap. Parity items
are recorded deliberately — so we don't "fix" something that isn't broken.

### Evidence (`/evidence`)

- *Ours:* a flat, date-grouped list of files. Each row: filename, linked control (if any),
  timestamp, download. Evidence is either manually uploaded on a control page or
  auto-filed by an integration sync. Source of truth: `app/(app)/evidence/page.tsx`.
- **G18 · Evidence freshness / renewal dates — real gap (P1).** Our evidence has **no
  concept of going stale**. A file uploaded once counts forever; nothing ever prompts a
  re-collect. Drata has a first-class **Evidence Renewal Date**: per-item cadence
  (default 1 year, or a custom date), and crucially *"evidence past its renewal date is
  treated as outdated and linked controls lose their **Ready** status"* — plus an alert
  icon and status filters (Needs attention / Upcoming renewal / Ready). Vanta solves the
  same problem continuously (hourly re-tests keep evidence current) and surfaces
  "evidence freshness" on the Trust Report. This is an **audit-integrity** gap, not
  cosmetic: an auditor wants current evidence, and a year-old screenshot shouldn't silently
  still read as "complete." *Fix shape:* an `evidence.renews_at` column + a control-health
  rule that treats a control's evidence as stale past that date (the hourly `pg_cron` job
  is the natural place to flag it, same pattern as drift). Meaningfully smaller than G2.
- **G19 · Evidence organization — real but P2.** Ours is one flat chronological list.
  Vanta/Drata organize evidence **by control and framework** with a per-control collection
  status, so you can see at a glance which controls still need evidence. We show evidence
  *count* per control on the control page, but there's no "evidence coverage" view across
  controls, and no folders/tags. Lower priority — the flat list works at SMB scale.

### Policies (`/policies`)

- *Ours:* AI-generate → edit → **approve** → **publish** → **acknowledge**, with version
  bumps that reset acknowledgements. Left list + right editor. Source:
  `components/policies/PolicyGenerator.tsx`. The approve+acknowledge+versioning workflow is
  **at parity** with Vanta (each Vanta policy is tied to an "approved" test + an "accepted
  by employees" test — exactly our two gates) and arguably ahead on the AI-drafting path.
- **G20 · Policy ↔ control mapping — real gap (P1).** Our policies **don't link to
  controls at all** — a policy is a standalone document. Vanta's 15 policy templates ship
  **pre-mapped to the controls they satisfy** ("policy templates already have the
  appropriate controls mapped… additional controls can be added or removed"). In an audit
  you must show *which policy satisfies which control*; today that mapping lives only in
  someone's head. *Fix shape:* a `policy_controls` join table (mirrors `risk_controls`) +
  a "Satisfies controls" picker on the policy editor + showing linked policies on the
  control page. Modest, high audit-value, and pairs naturally with G2.
- *Note:* our policies are **AI-generated per company**, not picked from a static labelled
  library. That's a defensible different approach (more tailored), not a gap — but it does
  mean we can't show a "you still need these N required policies for SOC 2" checklist the
  way a fixed template library (Vanta's 15) can. Worth considering a required-policy
  checklist per framework as a lightweight add (call it **G20b**).

### Reports (`/reports`)

- *Ours:* a single one-page, print-to-PDF **snapshot** — score, framework progress, open
  alerts, a controls table, policies, vendors. Good for a prospect or a quick status share.
  Source: `app/(app)/reports/page.tsx`.
- **G21 · Auditor export package / immutable evidence bundle — real gap (P1/P2).** Our
  report is a *live* one-pager; it has no auditor-grade export. Vanta produces **immutable
  "Workpaper" exports** — a locked copy of the latest test run with full metadata, "designed
  to meet auditor standards" — plus per-framework evidence exports and an auditor-facing
  evidence/policy-packet export. Drata builds an **Audit Package** that auto-attaches
  evidence by the auditor's selected audit dates and even splits personnel into
  current/new-hire/former folders for sampling. The two missing properties are
  **(a) immutability / point-in-time locking** (ours regenerates live, so it can't be a
  fixed audit artifact) and **(b) a bundled evidence export** (ours lists evidence but
  doesn't package the actual files for an auditor). *Fix shape:* a "Generate audit package"
  action that snapshots controls+evidence to a dated, immutable bundle (zip of files +
  manifest). Bigger than G18/G20; scope before building.

### Questionnaires (`/questionnaires`)

- *Ours:* AI-drafted security-questionnaire answers, grounded (never fabricated), with
  approve/needs-review states + CSV export. Deferred in testing (§7) pending quality work,
  not a structural gap. No new competitive gap found here beyond that known quality item —
  the *shape* matches how competitors position questionnaire automation.

### Activity (`/activity`)

- *Ours:* a company-wide audit trail (`audit_events`, 131 rows in the test workspace),
  filterable, append-only via `logEvent`. This is genuinely **at parity** — an immutable
  activity log is exactly what competitors provide for audit traceability. No gap. (The
  related gap is G10: not every logged event also *notifies* the relevant person.)

### Vendors (`/vendors`) — extends G12

- *Ours:* a flat list with inline add/edit. Per vendor: risk level, status, SOC 2 status +
  expiry, data-sensitivity tier, review cadence + overdue flag + one-click "Mark reviewed."
  Genuinely solid data model (the SOC 2-expiry + data-classification depth is real).
- **G22 · Vendor review *workflow* + detail page — real but P2.** We record *that* a review
  happened (a date); Drata records the *substance* — a per-vendor detail view with a
  structured "complete report review" workflow (attach the SOC 2 report, capture findings,
  track the assessment over time). Same shape as the control-detail gap: we have the data,
  competitors have a richer per-item page on top of it. Pairs with the broader
  "list items need detail pages, not just inline edit" theme (also true of controls).

### Risk Register (`/risks`)

- *Ours:* genuinely feature-rich — a **risk library** to start from, **inherent** likelihood×impact
  → severity, a separate **residual** score (post-mitigation), **control mapping**
  (`risk_controls` — risks *do* link to controls, unlike policies), a **heat-map**, owner,
  free-text treatment, and open/mitigating/accepted/closed status. Source:
  `components/risks/RiskManager.tsx`. Structurally this is the *most* competitive module we
  have — inherent/residual + control-linked is exactly the model Vanta/Drata use.
- **G24 · Risk depth — three concrete gaps, P2 (none blocking).**
  1. **Library size:** ours ships **~14 scenarios**; Drata's library is **200+**, Vanta's
     **100+** (both with suggested control mappings). Ours covers the obvious SMB risks well,
     but it's a fraction of the breadth. Pure content work — add more entries to
     `lib/risk-library.ts`, cheap.
  2. **Scoring scale:** ours is **3×3 qualitative** (low/medium/high → Critical/High/Med/Low).
     Drata uses a fixed **5×5 numeric** (1–5 × 1–5 = score); Vanta defaults 1–5 with custom
     matrices. 3×3 is simpler (on-brand for us) but reads as less rigorous to an auditor used
     to a 5×5. A defensible *choice*, not strictly a defect — flag, don't rush.
  3. **Treatment is free-text.** Competitors offer the four **named ISO treatment options**
     (mitigate via controls / transfer / avoid / accept) as structured choices. Ours has a
     free-text `treatment` field + a status. Small structured-field add would make treatment
     reportable/filterable and read more standards-aligned. Vanta also has a **submit-for-
     approval** step on a risk assessment we don't model — deliberately skipped for simplicity,
     same call as the access-review two-phase state machine (G14c).

### Controls (nav placement) — architectural, ties to G2

- **G23 · Promote Controls to a top-level nav item — real, low-effort, high-signal (P1).**
  Every competitor (Vanta, Drata, Sprinto) makes **Controls a first-class top-level nav
  page** — it's the heart of a compliance tool. Ours lives *inside* the Dashboard (the
  scrollable list on the dashboard page); there's no `/controls` index route, only
  `/controls/[id]` detail pages. This is why "move between controls" felt awkward (fixed
  interim with Prev/Next, 2026-07-11). Cheap structural win: lift the existing
  `ControlsExplorer` onto its own `/controls` page and add it to `nav-items.ts` under
  Compliance. Doesn't need G2's re-architecture — purely nav/routing.

---

## 3. Explicitly deprioritized (not worth it for our ICP now)

- Thousands of automated tests, FedRAMP/HITRUST/gov frameworks, and a native training-video
  library are **overkill for SMB / first-cert customers**. Revisit only when moving upmarket.

---

## 4. Suggested sequencing (if/when we build)

1. **G1** — 3 integrations: Okta/Entra, an HRIS, Jira (biggest evidence-automation ROI).
2. **G2** — cross-framework mapping (the architectural must-have).
3. **G3/G4** — deepen tests + cadence on what's connected.
4. **P2** items — add reactively, as prospects request them.

---

## 5. Sources (July 2026)

- Vanta — automated compliance (400+ integrations, 1,200+ hourly tests, AI Agent 2.0):
  https://www.vanta.com/products/automated-compliance
- Drata — controls & evidence (reuse across frameworks, 300+ integrations); DCF cross-mapping:
  https://drata.com/products/compliance/controls-and-evidence
- Sprinto vs Secureframe — integration & framework breadth:
  https://www.brightdefense.com/resources/secureframe-vs-sprinto/
- Buyer's guide to compliance automation 2026 ("map once, apply across frameworks"):
  https://quantarra.io/blog/the-buyers-guide-to-compliance-automation-software-in-2026
- Scytale — must-have compliance-automation features 2026:
  https://scytale.ai/resources/top-compliance-automation-tools/

**Per-module deep-dive (§2b, added 2026-07-11):**
- Drata — Evidence Renewal Date (staleness → controls lose "Ready", renewal cadence):
  https://help.drata.com/en/articles/6163983-evidence-renewal-date
- Vanta — policy templates pre-mapped to controls (15 templates, approve+accept tests):
  https://help.vanta.com/en/articles/11345431-custom-mapping-controls-to-policies
- Vanta — auditor exports / immutable Workpaper evidence exports:
  https://help.vanta.com/en/articles/11345427-audit-evidence
- Drata — Audit Package (auto-attached evidence by audit date, personnel sample folders):
  https://help.drata.com/en/articles/7881903-audit-package-control-evidence
- Drata — Vendors overview (per-vendor report-review workflow):
  https://help.drata.com/en/articles/13557179-vendors-overview-in-drata
- Vanta — new UI navigation (Controls as a top-level page):
  https://help.vanta.com/en/articles/11345409-new-vanta-ui
