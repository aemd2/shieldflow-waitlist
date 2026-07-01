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
  2. **HRIS — Gusto / Rippling / BambooHR** (personnel, onboarding/offboarding)
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
- **G4 · Monitoring cadence** — scheduled sync today; competitors test hourly. Move to more
  frequent runs as integration count grows.
- **G5 · AI depth** — we have Co-Pilot + questionnaire AI. Competitors have autonomous agents:
  auto policy drafting, vendor auto-scoring, remediation suggestions, risk graphs. Incremental.

### P2 — breadth to add when customers ask

- **G6 · Framework breadth** — FedRAMP, HITRUST, NIST CSF / 800-53, CMMC, TISAX, plus
  **custom frameworks**. Regional variants: relabel **UK GDPR**, add **Cyber Essentials** (UK
  public-sector), **CCPA / US state privacy** (larger US firms). (See the country analysis in the
  session notes — none block US/UK outreach today.)
- **G7 · Native security-awareness training** — we track completion; competitors *deliver* the
  courses.
- **G8 · Background-check integrations** (e.g. Checkr) for personnel evidence.
- **G9 · Auditor collaboration depth** — we have a read-only auditor role; competitors offer an
  auditor portal + auditor network + human compliance-manager services.

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
