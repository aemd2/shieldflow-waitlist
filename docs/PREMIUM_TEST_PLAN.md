# ShieldFlow — Premium features test plan

Click through this top-to-bottom to confirm everything built in the premium build-out
(branches `phase-0-notifications` … `phase-auditor-hardening`) works. Legend: **✅ =
the result you should see.** Anything else = a bug; note it and tell me.

> All of it lives on the **`phase-auditor-hardening`** branch (it contains every phase).
> Test on its Vercel preview, or merge to `main` and test on shieldflow.cloud.

---

## Pre-flight

- [ ] **Env:** in Vercel, set `CRON_SECRET` (value is in `app/.env.local`). Optional:
      `RESEND_API_KEY` to turn on notification/ack **email** (in-app works without it).
- [ ] **Accounts:** sign in as **A** (owner). Have a **second teammate B** (invite from
      Settings → Team, accept in another browser). For auditor tests, invite a **C** as
      role **auditor** (Settings → Team → role Auditor).
- [ ] **One integration connected** (for control-testing + cron tests): Integrations →
      GitHub (paste a fine-grained PAT) or AWS (read-only key) → **Sync now**.

---

## 1 · Notifications

- [ ] A **bell** shows in the top bar.
- [ ] Open `/notifications` → empty state "No notifications yet."
- [ ] Settings → **Notifications**: toggle a category's in-app/email → reload → the
      toggle persisted. ✅
- [ ] As **A**, open a control and set its **Owner** to **B's** email → as **B**, the
      bell shows a count and `/notifications` lists "You were assigned control …". ✅
- [ ] Click the notification → it marks read (red dot clears) and deep-links to the
      control. "Mark all read" clears the badge. ✅
- [ ] (If `RESEND_API_KEY` set) B also gets an email. Without it: in-app only, no error.

## 2 · Continuous control testing

- [ ] **Checks visible (1.2):** open a control your integration maps to (e.g. an MFA /
      branch-protection control) → an **"Automated checks"** card shows pass/fail/
      inconclusive with detail. ✅
- [ ] **Conflict flag:** set that control to **Complete** while a check is **failing** →
      an amber "marked complete but a check is failing" note appears. ✅
- [ ] **Evidence on control (1.3):** the synced CSV appears under that control's
      **Evidence** with an **"Auto"** badge and downloads; the control's evidence count
      includes it. ✅
- [ ] **Dashboard:** the "Automated monitoring" card shows passing/failing/inconclusive
      counts; failing checks appear in Monitoring & alerts. ✅
- [ ] **Continuous cron (1.4):** with `CRON_SECRET` set, run
      `curl -X POST https://<host>/api/cron/sync -H "Authorization: Bearer <CRON_SECRET>"`
      → JSON `{ ok, companies, integrations, synced, drift, … }`. Without the header →
      **401**. ✅
- [ ] Flip a setting on the provider (e.g. make a repo public / disable a policy), run
      the cron **twice** → a member gets an **"Automated monitoring update"** drift
      notification. ✅

## 3 · Tasks

- [ ] `/tasks` → add a task (title, assignee = B, due date, priority) → B gets a **task**
      notification. ✅
- [ ] Set a **past** due date → dashboard shows a **"Tasks overdue"** alert. ✅
- [ ] Set **Repeats = Monthly**, then **Complete** it (✓) → it moves to Completed **and a
      new instance appears** with the due date advanced one month. ✅
- [ ] Edit / delete work; auditor (C) sees the list read-only (no add/edit). ✅

## 4 · Policy approval + acknowledgement

- [ ] `/policies` → generate or open a policy. As **owner/admin**, the **Approval &
      acknowledgement** panel shows **Approve**. Click it → badge → **Approved**. ✅
- [ ] Click **Publish for acknowledgement** → every teammate gets a **policy**
      notification; the panel shows **"0 of N acknowledged"**. ✅
- [ ] As **B**, open the policy → **"I acknowledge"** → the count becomes **1 of N**, and
      B sees "You acknowledged this version." ✅
- [ ] **Edit** the published policy body + Save → version bumps to **v2**, status resets
      to **Draft**, acknowledgements reset (must re-approve + re-acknowledge). ✅
- [ ] Dashboard shows **"Policy awaiting acknowledgement"** while < 100% acknowledged. ✅
- [ ] A **member** (not owner/admin) does **not** see Approve/Publish. ✅

## 5 · Risk register (engine)

- [ ] `/risks` → **Add risk** → "Start from the risk library" → pick one → the form
      pre-fills (title, category, likelihood, impact, treatment). ✅
- [ ] Set **Inherent** High/High and **Residual** Low/Medium; tick 1–2 **mitigating
      controls** → Save. The row shows **inherent → residual** badges and a linked-control
      count. ✅
- [ ] The **heat-map** above the list shows the risk in the residual cell (not inherent). ✅
- [ ] A risk with **residual** set drives the dashboard alert off residual (a High→Low
      mitigated risk no longer screams "critical"). ✅

## 6 · Vendors (assessment)

- [ ] `/vendors` → add/edit a vendor: set **Re-review every = 1 month**, **SOC 2 = On
      file** with an **expiry in the past**, **Data = PII**. ✅
- [ ] The row shows **SOC 2 expired** (red), **PII**, and (because reviewed_at is older
      than the cadence after you wait/he backdate) **Review overdue** badges; dashboard
      shows "Vendor review overdue" + "Vendor SOC 2 expired". ✅
- [ ] Click **Mark reviewed** (calendar icon) → `reviewed_at` updates to today and the
      overdue badge clears; **editing other fields does NOT reset** reviewed_at. ✅

## 7 · Security questionnaire AI

- [ ] `/questionnaires` → **New questionnaire** → name it, paste a few questions (one per
      line) → Create. ✅
- [ ] **Draft with AI** → answers fill in; ones it can't ground are marked **Needs
      review** (never fabricated). Progress shows "N answered / M need review". ✅
- [ ] Edit an answer, set **Approved**, Save → persists. ✅
- [ ] **Export CSV** → downloads question/answer/status. ✅
- [ ] Without `GROQ_API_KEY` → amber "add a key" banner; manual answering still works. ✅

## 8 · Access reviews

- [ ] `/access-reviews` → **New review** → name, source, paste people one per line
      ("alice@co.com — Admin"). ✅
- [ ] Mark **Keep / Revoke** on each row; **Complete & file evidence** is disabled until
      all are decided. ✅
- [ ] Complete it → a **CSV evidence record** appears in the **Evidence vault** and the
      review is read-only/Completed. We **never** revoke real access. ✅

## 9 · Trust Center depth

- [ ] Settings (owner) → enable Trust Center + add a couple of **Subprocessors**. ✅
- [ ] Open `/trust/<your-slug>` in **incognito** → the **Subprocessors** section shows;
      a **"Request our security package"** form is present. ✅
- [ ] Submit the form (email + message) → success message; back in Settings → **Trust
      Center access requests** lists it → **Approve/Decline** works. ✅
- [ ] Spam the form > 5×/hour from one IP → **429** rate-limited. ✅

## 10 · Personnel roster

- [ ] `/personnel` → add a person (name, email, role, start date). ✅
- [ ] If that email matches a **training record**, the row shows a **"Training x/y"**
      badge. ✅
- [ ] **Offboard** (user-minus icon) → moves to the Offboarded group with an end date;
      **Reactivate** restores. ✅

## 11 · Auditor is read-only (RBAC)

Sign in as **C (auditor)**:

- [ ] A persistent **"read-only auditor access"** banner shows. ✅
- [ ] On every page (controls, risks, vendors, tasks, policies, personnel, access
      reviews, questionnaires) there are **no add/edit/delete** controls. ✅
- [ ] Try to act anyway (e.g. via a control's owner field, or hitting an integration
      Sync) → a friendly **"read-only"** message, never a raw error, and **nothing
      changes**. ✅
- [ ] **Integrations:** Connect / Sync / Disconnect all refuse for the auditor. ✅
- [ ] (If you set an auditor **expiry**) after it passes, the auditor is bounced out —
      all access cut. ✅

---

## 12 · SSO (Phase A) — app side

The SAML connection itself must be registered in Supabase Auth (Pro) + an IdP first
(see `docs/SSO_SCIM_PLAN.md`). The app side:

- [ ] Settings (owner) → **Single sign-on**: add your own email domain (e.g. the
      owner's `@acme.com`) → it saves as **Verified** (auto-verifies because it matches
      the owner's email). Add an unrelated domain → saves **Unverified**. ✅
- [ ] A domain already claimed by another workspace → "already claimed" error. ✅
- [ ] Login page → enter a work email → **Sign in with SSO**. Before an IdP is
      registered: a friendly "SSO isn't set up for this domain yet" message (no crash). ✅
- [ ] **After** registering a SAML IdP in Supabase for that domain: "Sign in with SSO"
      redirects to the IdP; on return, a brand-new SSO user whose domain is **verified**
      lands straight on the **dashboard** (auto-joined as a member), not onboarding. ✅
- [ ] Break-glass: the owner can still sign in with **email + password**. ✅

## 13 · 14-Day Sprint onboarding guide

The guided `/getting-started` flow. Progress is **derived live** (no stored "phase"), so just
changing the underlying data should move the phases — nothing to "save".

- [ ] **New signup lands on the guide:** create a brand-new workspace (fresh email → onboarding
      → pick a framework) → you land on **/getting-started**, not the dashboard. Header reads
      **"0 of 4 phases done"**, Phase 1 "Connect your stack" is the highlighted current phase,
      the rest are dimmed. ✅
- [ ] **Sidebar + banner:** "Getting started" is the **first** sidebar item; the dashboard shows
      a **"Your 14-Day Sprint — 0 of 4 phases done"** banner. Dismiss it (×) → stays gone on
      reload. ✅
- [ ] **Phase 1 — Connect:** connect one integration (Integrations → GitHub/AWS → Sync) → back on
      the guide Phase 1 shows ✓ "1 connected"; Phase 2 "Review your controls" becomes current. ✅
- [ ] **Phase 2 — Review:** move controls off **Not started** until ≥ 80% are touched → Phase 2
      flips to ✓; label counts "X of Y reviewed". ✅
- [ ] **Phase 3 — Core gaps (scale check):** Phase 3 shows the **bounded core count** (e.g.
      "0 of 8 core controls" for SOC 2 — **not** the full 15), and lists the open core controls
      inline, each linking to its control page. Set every **core** control to Complete → Phase 3
      flips to ✓. ✅
- [ ] **Phase 4 — Documents:** approve a policy (Policies → Approve) → Phase 4 flips to ✓. ✅
- [ ] **Audit-ready:** with all four phases done, the header swaps to the **"You're audit-ready
      🎉"** state and the **dashboard banner disappears**. ✅
- [ ] **Criticality tiers (data):** every framework has a focused **core** subset — SOC 2 = 8,
      ISO 27001 = 9, HIPAA = 5, PCI-DSS = 5, GDPR = 7 — so the "core gaps" phase never dumps the
      full list. ✅
- [ ] **Auditor (C) read-only:** sign in as the auditor → /getting-started **renders** their
      workspace's progress with **no add/edit/connect actions** and **no errors** (the page makes
      zero writes). ✅

## 14 · Role visibility — Billing & notification prefs (RBAC)

Billing is an **owner/admin-only** surface; auditors are **fully read-only**, including their own
notification preferences. Both rules are enforced **server-side**, not just hidden in the UI.

- [ ] **Member can't see Billing:** sign in as a **member (B)** → **Billing** is absent from the
      sidebar and the mobile menu. Visit `/billing` directly → redirected to the dashboard (no plan
      data exposed). ✅
- [ ] **Auditor can't see Billing:** same for the **auditor (C)** — no Billing in the nav, `/billing`
      bounces to the dashboard. ✅
- [ ] **Auditor notification prefs are read-only:** as **C**, Settings → **Notifications** → the
      in-app/email toggles are **disabled** and the panel reads "read-only for auditor access — you
      can't change notification settings." ✅
- [ ] **Owner/admin unaffected:** as **A** (owner) or an **admin**, Billing is in the sidebar and
      opens; notification toggles still flip and **persist across reload**. ✅
- [ ] **Server-side enforcement (not just UI):** the member/auditor billing redirect and the auditor
      pref rejection both live on the server, so hand-crafting the request can't bypass them. ✅

## Tenant isolation (do once, critical)

- [ ] As an unrelated **second company**, confirm you see **none** of company A's
      tasks, risks, vendors, policies, questionnaires, access reviews, personnel,
      notifications, or trust requests. ✅ (RLS enforces this on every new table.)

✅ Green across this list = the premium build-out is verified and ready for your
founding cohort.
