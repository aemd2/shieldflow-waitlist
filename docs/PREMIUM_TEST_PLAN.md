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

## 1 · Notifications ✅ **tested** (7/3/2026)

- [x] A **bell** shows in the top bar. ✅
- [x] Open `/notifications` → empty state "No notifications yet." ✅
- [x] Settings → **Notifications**: toggle a category's in-app/email → reload → the
      toggle persisted. ✅
- [x] As **A**, open a control and set its **Owner** to **B's** email → as **B**, the
      bell shows a count and `/notifications` lists "You were assigned control …". ✅
- [x] Click the notification → it marks read (red dot clears) and deep-links to the
      control. "Mark all read" clears the badge. ✅
- [x] In-app works with no error when `RESEND_API_KEY` is unset. ✅ `RESEND_API_KEY` has
      since been added to `.env.local` — the email-delivery half is not yet re-verified.

## 2 · Continuous control testing ✅ **tested** (7/3/2026 — GitHub; cron + drift 7/8/2026)

- [x] **Checks visible (1.2):** open a control your integration maps to (e.g. an MFA /
      branch-protection control) → an **"Automated checks"** card shows pass/fail/
      inconclusive with detail. ✅ (Secure Coding + Access Control controls, GitHub)
- [x] **Conflict flag:** set that control to **Complete** while a check is **failing** →
      an amber "marked complete but a check is failing" note appears. ✅
- [x] **Evidence on control (1.3):** the synced CSV appears under that control's
      **Evidence** with an **"Auto"** badge and downloads; the control's evidence count
      includes it. ✅ (found + fixed a real bug along the way — the company-wide
      `/evidence` vault had no download control at all for integration CSVs, since
      those save with `control_id: null`; fixed in `EvidenceDownloadButton.tsx`)
- [x] **Dashboard:** the "Automated monitoring" card shows passing/failing/inconclusive
      counts; failing checks appear in Monitoring & alerts. ✅ (0 passing / 2 failing,
      both surfaced under Monitoring & alerts)
- [x] **Continuous cron (1.4):** with `CRON_SECRET` set, run
      `curl -X POST https://<host>/api/cron/sync -H "Authorization: Bearer <CRON_SECRET>"`
      → JSON `{ ok, companies, integrations, synced, drift, … }`. Without the header →
      **401**. ✅ **tested** (7/7/2026 — no header → `{"error":"unauthorized"}`; with the
      secret → `{"ok":true,"companies":1,"integrations":6,"synced":6,"drift":0,
      "failing":0,"errors":0}`. `integrations: 6` is correct, not a shortfall — it's
      exactly `SYNCABLE_PROVIDERS` (aws, github, okta, gcp, cloudflare, gitlab) in
      `lib/integration-sync.ts`; Slack/Jira/Linear/Google Workspace are intentionally
      excluded (no pass/fail security signal to monitor — see the `EVALUATORS` comment
      in `lib/checks.ts`), not a bug or gap.)
- [x] Flip a setting on the provider (e.g. make a repo public / disable a policy), run
      the cron **twice** → a member gets an **"Automated monitoring update"** drift
      notification. ✅ **tested** (7/8/2026 — hardened the connected Cloudflare zone for
      real: SSL mode Flexible→Full, min TLS 1.0→1.2, Always Use HTTPS off→on. First cron
      run after only the HTTPS toggle showed `drift: 0` — correct, not a bug: `cloudflare.tls`
      in `checks.ts` requires all three conditions together, so one out of three doesn't
      flip the verdict. After all three were set, re-ran cron → `drift: 1, failing: 0`
      (a fail→pass recovery). Confirmed in the DB: 3 `notifications` rows, one per company
      member, each "Automated monitoring update" / "1 automated check(s) recovered." —
      correct fan-out per member, not a duplicate-notification bug.)

## 2b · Integrations — every connector, one by one

`/integrations` lists 10 connectable providers. Full step-by-step per connector (token
format checks, sync, CSV in evidence, revoke/reconnect, secret-never-in-source checks)
already live in `docs/TESTING.md §9.1–9.10` — work through each here and tick it off.
Redirect-URI mismatches (like the Slack + GitHub ones hit 7/3/2026) are an app-config
problem, not code — fix in the provider's own developer console, not here.

- [x] **GitHub** (§9.1) — OAuth connect or PAT paste, Sync, CSV in evidence. ✅ **tested**
      (7/3/2026 — hit a redirect_uri mismatch, fixed in the GitHub OAuth App settings)
- [x] **Slack** (§9.2) — Add to Slack, digest send, revoke/reconnect. ✅ **tested**
      (7/3/2026 — hit a redirect_uri mismatch, fixed in the Slack app's OAuth settings;
      digest confirmed delivered with score/framework %/alerts)
- [x] **Google Workspace** (§9.3) — ⚠️ **partial** (7/7/2026): OAuth connect ✅ (found +
      fixed the app's own OAuth client had been deleted in Google Cloud Console — created a
      replacement, reused for both Supabase Sign-in-with-Google and this integration via a
      second Authorized redirect URI). **Sync blocked by environment, not code**: needs a
      real Google Workspace admin account; a personal Gmail can't call the Admin Directory
      API. Not worth a domain purchase + trial subscription just to verify — code path
      already reviewed and matches Google's documented API shape.
- [x] **AWS** (§9.4) — access key connect, Sync, CSV in evidence. ✅ **tested** (7/7/2026 —
      connected to account 177884820952, synced successfully)
- [x] **Okta** (§9.5) — domain + API token, Sync, SSRF guard on bad domain. ✅ **tested**
      (7/7/2026 — connected to an Okta Integrator Free Plan org, note: signed up for Auth0
      first by mistake, a different Okta product — developer.okta.com/signup is the right
      one. Sync confirmed: CSV shows user counts, MFA enrollment, password policy.)
- [x] **GitLab** (§9.6) — PAT connect, Sync, CSV in evidence. ✅ **tested** (7/7/2026 —
      found + fixed a real bug: the token regex only allowed alphanumeric/underscore/
      hyphen, rejecting GitLab's current "routable" PAT format which embeds dots
      (`glpat-xxxx.01.xxxxxxxxx`) — every real token in that format was rejected before
      it reached the server. Fixed in `lib/validation.ts`. After the fix: connected as
      @aemd2donchev, synced, `gitlab-repo-security-DATE.csv` filed in evidence (0
      projects — this GitLab account has none, confirmed inconclusive not an error).
      Garbage/malformed input still correctly rejected. Revoke/reconnect and
      sync-rate-limit not re-clicked this pass.)
- [x] **Jira** (§9.7) — site + email + token, Sync, SSRF guard on bad site. ✅ **tested**
      (7/7/2026 — not a code bug: the Atlassian account had no Jira site provisioned at
      all (only Trello/Goals/Loom/Projects), so the "site" field had nothing to connect
      to. Created a free Jira Software site, retried with the same API token — connected
      to `emilsworkspace-31627026.atlassian.net`, synced, `jira-projects-DATE.csv` filed
      in evidence with the 1 real project (KAN / "trying"). SSRF guard, wrong-creds
      message, and revoke/reconnect not re-clicked this pass.)
- [x] **Linear** (§9.8) — API key connect, Sync, CSV in evidence. ✅ **tested** (7/7/2026 —
      created a fresh Linear workspace + full-access personal API key, connected as
      aemd2donchev@gmail.com, synced: 1 team, 4 issues (0 closed, 4 open), CSV filed in
      evidence. Wrong-key rejection, rate-limit, and revoke/reconnect not re-clicked this
      pass.)
- [x] **Cloudflare** (§9.9) — API token connect, Sync, CSV in evidence. ✅ **tested**
      (7/7/2026 — found + fixed a real bug: `validateToken()` checked
      `/user/tokens/verify`, but that endpoint is scoped to the "user" resource in
      Cloudflare's permission model — a token scoped only to Zone Read + Zone Settings
      Read (exactly the least-privilege setup our own instructions ask for) has no
      permission to call it and gets a 401, even though the same token works fine
      against `/zones`. Confirmed with curl before touching code. Fixed by validating
      against `/zones` instead — the same endpoint Sync already needs, so a token that
      passes Connect is guaranteed to work for Sync. After the fix: connected, synced 1
      zone (`emildonchev-producrdesigner.com`), `cloudflare-zone-security-DATE.csv`
      filed in evidence. Wrong-token rejection, rate-limit, and revoke/reconnect not
      re-clicked this pass.)
- [x] **Google Cloud** (§9.10) — service-account JSON paste, Sync, CSV in evidence. ✅
      **tested** (7/7/2026 — not a code bug: created the service account without its
      "grant access to project" step actually sticking, so Connect succeeded (key
      exchange only needs a valid key) but Sync 403'd on `getIamPolicy`. Diagnosed by
      reproducing the app's exact token-exchange + `getIamPolicy` call outside the app
      and reading the raw error body — a plain `PERMISSION_DENIED` (not an
      API-disabled error), which pointed at a missing IAM binding rather than a
      disabled API or a code issue. Confirmed via the IAM page: the service account
      was absent from the project's principals list entirely. Granted it **Viewer** via
      IAM & Admin → IAM → Grant access → re-ran Sync → "Synced: 1 owner, 0 editors, 2
      bindings", `gcp-iam-exposure-DATE.csv` filed in evidence. Malformed-JSON
      rejection, missing-field rejection, and rate-limit not re-clicked this pass.

**All 10 connectors in §9.1–9.10 are now tested.** One real code bug found + fixed per
GitLab and Cloudflare; Jira and Google Cloud turned out to be environment/config gaps,
not code; Google Workspace remains partially blocked by needing a real Workspace
admin account (see §9.3).

## 3 · Tasks ✅ **tested** (7/3/2026)

- [x] `/tasks` → add a task (title, assignee = B, due date, priority) → B gets a **task**
      notification. ✅
- [x] Set a **past** due date → dashboard shows a **"Tasks overdue"** alert. ✅
- [x] Set **Repeats = Monthly**, then **Complete** it (✓) → it moves to Completed **and a
      new instance appears** with the due date advanced one month. ✅
- [x] Edit / delete work. ✅ (auditor read-only check deferred — no auditor account set up
      yet; RBAC pattern already verified elsewhere in §11, low risk)
- [x] **Bonus, found + fixed during this pass:** tasks can now link to a control/risk/vendor/
      policy (see `linked_type`/`linked_id`, PREMIUM_GAP_2.md G11) — confirmed the linked chip
      displays, deep-links to the control, and survives recurrence spawning. ✅

## 4 · Policy approval + acknowledgement ✅ **tested** (7/2/2026)

- [x] `/policies` → generate or open a policy. As **owner/admin**, the **Approval &
      acknowledgement** panel shows **Approve**. Click it → badge → **Approved**. ✅
- [x] Click **Publish for acknowledgement** → every teammate gets a **policy**
      notification; the panel shows **"0 of N acknowledged"**. ✅
- [x] As **B**, open the policy → **"I acknowledge"** → the count becomes **1 of N**, and
      B sees "You acknowledged this version." ✅
- [x] **Edit** the published policy body + Save → version bumps to **v2**, status resets
      to **Draft**, acknowledgements reset (must re-approve + re-acknowledge). ✅
- [x] Dashboard shows **"Policy awaiting acknowledgement"** while < 100% acknowledged. ✅
- [x] A **member** (not owner/admin) does **not** see Approve/Publish. ✅

## 5 · Risk register (engine) ✅ **tested** (7/2/2026)

- [x] `/risks` → **Add risk** → "Start from the risk library" → pick one → the form
      pre-fills (title, category, likelihood, impact, treatment). ✅
- [x] Set **Inherent** High/High and **Residual** Low/Medium; tick 1–2 **mitigating
      controls** → Save. The row shows **inherent → residual** badges and a linked-control
      count. ✅
- [x] The **heat-map** above the list shows the risk in the residual cell (not inherent). ✅
- [x] A risk with **residual** set drives the dashboard alert off residual (a High→Low
      mitigated risk no longer screams "critical"). ✅

## 6 · Vendors (assessment) ✅ **tested** (7/2/2026)

- [x] `/vendors` → add/edit a vendor: set **Re-review every = 1 month**, **SOC 2 = On
      file** with an **expiry in the past**, **Data = PII**. ✅
- [x] The row shows **SOC 2 expired** (red), **PII**, and (because reviewed_at is older
      than the cadence after you wait/he backdate) **Review overdue** badges; dashboard
      shows "Vendor review overdue" + "Vendor SOC 2 expired". ✅
- [x] Click **Mark reviewed** (calendar icon) → `reviewed_at` updates to today and the
      overdue badge clears; **editing other fields does NOT reset** reviewed_at. ✅

## 7 · Security questionnaire AI ⏭️ **skipped** — still needs more work

> **Not verified in this pass.** The feature ships but quality/UX isn't where we want it
> yet — defer full §7 click-through until the next build iteration. Continue with §8 below.

- [ ] `/questionnaires` → **New questionnaire** → name it, paste a few questions (one per
      line) → Create. ✅
- [ ] **Draft with AI** → answers fill in; ones it can't ground are marked **Needs
      review** (never fabricated). Progress shows "N answered / M need review". ✅
- [ ] Edit an answer, set **Approved**, Save → persists. ✅
- [ ] **Export CSV** → downloads question/answer/status. ✅
- [ ] Without `GROQ_API_KEY` → amber "add a key" banner; manual answering still works. ✅

## 8 · Access reviews ✅ **tested** (7/5/2026 – 7/6/2026)

Restructured 7/3/2026 after testing surfaced real UX friction — see G14a/G14c in
`PREMIUM_GAP_2.md`. A review now spans **multiple in-scope systems** (checkboxes for
connected Okta/Google Workspace + an "add a custom system" input), each with its own
roster populated via **Pull** (connected systems), **Upload CSV** (downloadable
template), or **paste** — not one shared free-text box. Name auto-derives from the
chosen systems + quarter until edited; Reviewer defaults to the current user.

- [x] `/access-reviews` → **New review** → check a connected system and/or add a custom
      system by name (tested with GitHub + GitLab as custom systems) → **Name** field
      auto-filled from the systems picked, still editable. ✅
- [x] Create the review → detail pane groups accounts **by system** with a per-system
      decided count. ✅
- [x] Mark **Keep / Revoke / Out of scope** on each row; **Complete & file evidence** is
      disabled until every row across every system is decided. ✅
- [x] Complete it → the review goes read-only/Completed; evidence filed. ✅
- [x] **Delete a review** — found + fixed a real bug: the confirm dialog and every button
      on the page shared one `pending` flag that could get stuck true after a hung
      `router.refresh()` (e.g. a tab left open across several deploys), permanently
      disabling the trash icon with zero visible feedback. Confirm dialog now runs
      outside the transition, and delete no longer depends on the shared flag. A
      follow-up pass (background task) went further and replaced the confirm-modal
      pattern entirely with an optimistic-hide + "Deleted — Undo" toast, structurally
      immune to this bug class — see G16 in `PREMIUM_GAP_2.md`. ✅

## 9 · Trust Center depth

- [ ] Settings (owner) → enable Trust Center + add a couple of **Subprocessors**. ✅
- [ ] Open `/trust/<your-slug>` in **incognito** → the **Subprocessors** section shows;
      a **"Request our security package"** form is present. ✅
- [ ] Submit the form (email + message) → success message; back in Settings → **Trust
      Center access requests** lists it → **Approve/Decline** works. ✅
- [ ] Spam the form > 5×/hour from one IP → **429** rate-limited. ✅

## 10 · Personnel roster ✅ **mostly tested** (7/8/2026)

- [x] `/personnel` → add a person (name, email, role, start date) → Role and Email fields
      now suggest as you type (workspace's own roles/domains first, common ones as a
      baseline). ✅
- [x] If that email matches a **training record**, the row shows a **"Training x/y"**
      badge; rows with no matching record correctly show none. ✅
- [x] **Offboard** (user-minus icon) → moves to the Offboarded group with an end date. ✅
      **Reactivate** (green user-plus icon on an offboarded row) — not yet clicked/confirmed.
- [ ] **Bulk add** (see G17, `PREMIUM_GAP_2.md`): **Pull from Okta/Google Workspace** (if
      connected) / **Upload CSV** (try **Download template** first) / paste a multi-line
      list → a row matching an existing email is flagged **"Already in Personnel"** and
      excluded; a row with a bad email is flagged red and excluded until fixed via the
      **Pencil** inline-edit. "Add N people" only counts clean, non-duplicate rows. Built +
      type-checked; the underlying form fields are confirmed working, but a full pull/CSV/
      paste → save round-trip hasn't been explicitly confirmed yet.
- [ ] **Personnel auto-created on Team invite** (see G15a): invite a fresh test
      email from Settings → Team, accept it in another browser → that person should
      appear in Personnel automatically (name guessed from their email). Only applies to
      *new* invites accepted after 7/5/2026 — existing Team members were not backfilled.

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

> **Restructured 7/8/2026:** Billing no longer has its own sidebar item — it's now a
> **tab inside Settings** (`/settings?tab=billing`), matching the pattern every surveyed
> competitor uses (Vanta, Drata, Secureframe, Notion, Linear, Slack, Stripe: billing folds
> into Settings, never a top-level nav slot). Settings itself is now tabbed: Team ·
> Notifications · Trust Center · SSO · Billing, each tab role-gated server-side and only
> fetching its own data. `/billing` still exists as the Stripe checkout/portal return
> handler (reconciles, then forwards to the tab) and still bounces members/auditors to
> the dashboard.

- [ ] **Member can't see Billing:** sign in as a **member (B)** → no **Billing tab** on
      the Settings page (Team + Notifications only). Visit `/billing` or
      `/settings?tab=billing` directly → no plan data (redirected to dashboard / falls
      back to the Team tab). ✅
- [ ] **Auditor can't see Billing:** same for the **auditor (C)** — no Billing tab,
      `/billing` bounces to the dashboard, `?tab=billing` falls back to Team. ✅
- [ ] **Auditor notification prefs are read-only:** as **C**, Settings → **Notifications** tab → the
      in-app/email toggles are **disabled** and the panel reads "read-only for auditor access — you
      can't change notification settings." ✅
- [ ] **Owner/admin unaffected:** as **A** (owner) or an **admin**, Settings shows all five tabs;
      the Billing tab opens with plan cards; notification toggles still flip and **persist across
      reload**. ✅
- [ ] **Server-side enforcement (not just UI):** the member/auditor billing redirect and the auditor
      pref rejection both live on the server, so hand-crafting the request can't bypass them. ✅
- [ ] **Stripe return flow still works:** complete a checkout → Stripe redirects to
      `/billing?status=success&session_id=…` → plan reconciles → you land on
      **Settings → Billing** with the green success note. ✅

## 15 · Control detail & list enrichment

Each control page should teach *that* control (guidance + expected evidence), and the controls list
should carry priority + live health signals — the Vanta/Drata-style depth.

- [ ] **Header badges:** open any control → the eyebrow reads `Framework · Category · Code` and a
      **criticality badge** (Core / Important / Operational) shows next to it. ✅
- [ ] **Guidance card:** a **"How to satisfy this control"** card shows control-specific guidance
      (not generic filler). ✅
- [ ] **Expected evidence:** an **"Evidence auditors typically expect"** list sits above the upload
      box, so it's never blank. ✅
- [ ] **All frameworks seeded:** open one control each from SOC 2, ISO 27001, HIPAA, PCI-DSS, GDPR →
      every one has its own guidance + evidence (none blank, none identical). ✅
- [ ] **List — Core badge:** on the dashboard's Controls list, core controls carry a **"Core"** badge. ✅
- [ ] **List — search + filter:** the **search box** filters by code/title; the **priority filter**
      (All / Core / Important / Operational) narrows the list; "Showing X of Y" updates. ✅
- [ ] **List — health pill:** after syncing an integration, a control its checks map to shows a
      **"Checks passing" / "Check failing"** pill next to its status. ✅
- [ ] **Auditor read-only:** as the auditor (C), all of the above **renders** with no edit/connect
      actions and no errors (the pages make zero writes). ✅

## Tenant isolation (do once, critical)

- [ ] As an unrelated **second company**, confirm you see **none** of company A's
      tasks, risks, vendors, policies, questionnaires, access reviews, personnel,
      notifications, or trust requests. ✅ (RLS enforces this on every new table.)

✅ Green across this list = the premium build-out is verified and ready for your
founding cohort.
