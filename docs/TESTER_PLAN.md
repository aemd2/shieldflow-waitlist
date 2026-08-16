# Tester plan (14-day full-access invite links)

A fourth plan alongside Starter / Growth / Custom. Someone you send a numbered
link to gets **every Growth feature free for 14 days**, no card. When the clock
runs out the workspace drops to **Free** and keeps all its data.

The founding-cohort ladder (100% → 80% → …) is unrelated: it discounts the
*price* of a paid plan. Tester changes *access*, and never charges anything.

## The links

Private URLs. There is no admin page and nothing on the marketing site — you
hand each link to one person directly.

```
https://shieldflow.cloud/trial/5ed356-001
                               ^^^^^^ ^^^
                               random  recipient number
```

The trailing number is who you sent it to. The random prefix is why nobody can
walk `/trial/001`, `/trial/002`, … and burn codes meant for real prospects.

Manage them from the terminal (`app/scripts/trial-links.mjs`, service-role key
out of `.env.local`):

```bash
node scripts/trial-links.mjs list                       # every link + who redeemed
node scripts/trial-links.mjs free                       # only unused
node scripts/trial-links.mjs assign 7 "Acme — Jane" jane@acme.com
node scripts/trial-links.mjs new 25                     # mint more
node scripts/trial-links.mjs revoke 7                   # kill one
```

`assign` is just a label for your own tracking — it does **not** restrict who
can redeem. Anyone holding the link can use it, once.

## What happens when someone opens one

1. `/trial/<code>` validates the code server-side (service-role; the page never
   reveals the label or recipient email, so a guessed code leaks nothing).
2. Not signed in → pitch page → `/signup?next=/trial/<code>`. `next` survives
   both email confirmation and Google OAuth, so they land back here signed in.
3. No workspace yet → `/onboarding?trial=<code>`; the code rides a hidden field
   and is redeemed the moment the company row exists.
4. Already has a workspace → one "Start my 14 days" button.

Every path ends at `redeem_trial_invite(p_code)` — a `SECURITY DEFINER` RPC that
does all the checking atomically under a row lock:

- caller must **own** a workspace (trials are workspace-level)
- one trial per workspace, ever — re-running is an idempotent no-op, so refreshes
  and double-clicks are harmless
- link must be active, unexpired, and under its use count

A tampered hidden field gets nothing: the RPC re-validates the code and derives
the company from `auth.uid()`.

## How the plan is decided

`resolvePlan()` in `app/lib/plan.ts` — **derived on every render, never stored**,
so a trial lapses on time with no cron to fall behind:

1. live paid subscription (`active`/`trialing`/`past_due`/`unpaid`) → that plan
2. else `companies.trial_ends_at` in the future → `tester`
3. else → `free`

Subscribing mid-trial makes them a paying customer immediately.

## What Free actually loses

`app/lib/plan.ts` is the single source of truth for both the server gates and the
UI. Free keeps the core tracker — dashboard, controls, policies, tasks, risks,
training, personnel, reports. It loses:

| Locked on Free | Enforced in |
| --- | --- |
| AI Co-Pilot, AI Policy Generator, questionnaire AI | `app/api/{copilot,policy,questionnaire}/route.ts` → 403 |
| Integrations (connect + sync; **disconnect stays open**) | all 10 provider actions |
| Vendor risk, access reviews, questionnaires, subprocessors | each module's `companyOrError()` |
| Trust Center — public page 404s | `updateTrustSettings` (enabling only) + `/trust/[slug]` |

Caps: 1 framework, 25 evidence files, 3 team members (`assertWithinLimit`).

Two deliberate exceptions, both so a lapsed workspace is never *stuck*:
disconnecting an integration and switching the Trust Center **off** work on every
plan.

## Where a user sees it

- `PlanBanner` in the app shell: "N days left…", turning amber at ≤3 days, then
  "Your trial has ended — this workspace is on the Free plan."
- Settings → Billing: a Tester card with the countdown, or a Free card spelling
  out the caps.

## Schema (migration 0034)

- `companies.trial_code / trial_started_at / trial_ends_at`
- `trial_invites` — the links. **No authenticated RLS policies**: service-role
  only, because it holds who each link was sent to.
- `trial_redemptions` — who redeemed what, `unique (company_id)`.

## Not built

Trial-expiry email reminders (day 7 / day 1). `RESEND_API_KEY` is unset, so
app-level email is a no-op anyway — the in-app banner is the only warning today.
