# ShieldFlow — Setup Guide

The app runs fully with just the two Supabase keys. Every other integration is
optional and activates the moment its env var is added to `.env.local` (restart
the dev server after editing) — the one exception is the encryption key in §0,
which is required before connecting any evidence integration.

## 0. Integration secret encryption (required before connecting integrations)

Integration tokens, API keys, and webhook URLs are encrypted at rest with
AES-256-GCM. The key lives in one env var:

1. Generate a 32-byte key: `openssl rand -base64 32`
2. Add it to `.env.local`: `SHIELDFLOW_ENCRYPTION_KEY=<that value>` and restart the dev server.

Without it, connecting any integration is **refused** (fail closed — a secret is
never written in plaintext). Rows connected before the key was set are read as
legacy plaintext until you reconnect, which re-encrypts them. Keep this key out of
source control and back it up separately from the database — a DB backup without
the key cannot reveal the secrets.

## 1. AI features (Policy Generator + Co-Pilot) — free

1. Go to https://console.groq.com/keys (free, no credit card).
2. Create an API key → add `GROQ_API_KEY=gsk_...` to `.env.local`.

## 2. Google sign-in (OAuth)

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID
   (type: Web application).
2. Authorized redirect URI: `https://fxhnzwzzizksxahlydzf.supabase.co/auth/v1/callback`.
3. Supabase dashboard → Authentication → Providers → Google → enable, paste the
   client ID + secret.
4. Done — the "Continue with Google" button works immediately (no app env vars needed).

## 3. Magic links + password reset emails

Already wired. Two Supabase dashboard checks:
- Authentication → URL Configuration → add your app URL(s) to **Redirect URLs**
  (e.g. `http://localhost:3001/api/auth/confirm`).
- The built-in mailer has a low daily limit — set up custom SMTP
  (Authentication → Emails) before a public launch.

## 4. Stripe billing (test mode)

1. https://dashboard.stripe.com → toggle **Test mode** → Developers → API keys →
   copy the secret key → `STRIPE_SECRET_KEY=sk_test_...`.
2. Add `NEXT_PUBLIC_APP_URL=http://localhost:3001` (already in `.env.local.example`).
3. Supabase dashboard → Project Settings → API → copy the `service_role` key →
   `SUPABASE_SERVICE_ROLE_KEY=...` (the webhook needs it; never expose it client-side).
4. Webhook signing secret — **no Stripe CLI**. After `STRIPE_SECRET_KEY` is set, run:
   ```
   npm run setup:stripe-webhook
   ```
   This creates the endpoint via the Stripe API and writes `STRIPE_WEBHOOK_SECRET=whsec_...`
   to `.env.local`. (You can also use the Stripe MCP in Cursor to manage the same account.)
   **Localhost caveat:** Stripe cannot POST to `localhost` from the internet. Checkout still
   activates your plan via `/billing?session_id=…` (billing-sync). For subscription
   renewals/cancellations locally, use a tunnel URL: `WEBHOOK_URL=https://your-tunnel/api/stripe/webhook npm run setup:stripe-webhook`.
5. Test a checkout with card `4242 4242 4242 4242`, any future expiry, any CVC.
6. Going live later = swap to live keys + point the webhook at
   `https://app.yourdomain.com/api/stripe/webhook`.

**Billing intervals:** the plan cards have a Monthly/Annual toggle. Annual is 12× the
monthly rate (per the PRD); no Stripe product setup is needed — checkout builds the
price inline for the chosen interval.

**Founder discount (40% off):** checkout has `allow_promotion_codes` enabled, so you
just create the coupon once in Stripe:
1. Stripe Dashboard → **Product catalog → Coupons → New** → 40% off, duration
   "Repeats for 12 months" (or "Once" for annual) → save.
2. On the coupon → **Add promotion code** → set the code customers type, e.g. `FOUNDER40`.
3. Share `FOUNDER40` with your first 40 founders. They enter it in the "Add promotion
   code" field at checkout. No app change needed.

## 5. Google Workspace integration (automated evidence)

1. Google Cloud Console → new project (or reuse) → enable the **Admin SDK API**.
2. OAuth consent screen → External → fill the basics → add scope
   `admin.directory.user.readonly` → add yourself as a **test user**
   (testing mode is enough — no Google verification needed for your own domain).
3. Credentials → Create OAuth client ID (Web application) → authorized redirect URI:
   `http://localhost:3001/api/integrations/google/callback` (plus your prod URL later).
4. Add `GOOGLE_CLIENT_ID=...` and `GOOGLE_CLIENT_SECRET=...` to `.env.local`.
5. In the app: Integrations → Connect Google Workspace → consent with a
   **Workspace admin** account → Sync now. A CSV user-security report lands in
   the evidence vault.

## 5b. GitHub integration (repo security evidence) — no env vars

Connected entirely from the UI with a personal access token (nothing to configure here):

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token.
2. Repository access: the repos you want audited (or All repositories).
3. Permissions → Repository permissions → **Metadata: Read-only** and
   **Administration: Read-only** (needed to read branch-protection rules).
4. Copy the `github_pat_...` token → in the app: Integrations → GitHub → paste → Connect.
5. **Sync now** pulls a repo-security CSV (visibility, branch protection, archived)
   into the evidence vault. The token is stored RLS-protected and never shown again.

## 5c. Slack integration (compliance digests) — no env vars

1. https://api.slack.com/apps → Create New App → From scratch → pick your workspace.
2. Features → **Incoming Webhooks** → toggle ON → Add New Webhook to Workspace →
   choose the channel.
3. Copy the `https://hooks.slack.com/services/...` URL → in the app:
   Integrations → Slack → paste → Connect. A test message confirms it instantly.
4. **Send digest now** posts the live score, framework progress, and open alerts.

## 5d. AWS integration (cloud security evidence) — no env vars

Connected from the UI with a **read-only** IAM access key. ShieldFlow only reads
account-level security posture (root MFA, IAM password policy, user/MFA counts) —
it never makes changes.

1. AWS Console → **IAM** → Users → Create user (e.g. `shieldflow-readonly`).
2. Permissions → Attach policies directly → search and attach the AWS-managed
   **`IAMReadOnlyAccess`** policy. (That's all that's needed; `sts:GetCallerIdentity`
   requires no permissions.)
3. Open the user → **Security credentials** → Create access key → choose
   "Third-party service" → copy the **Access key ID** (`AKIA…`) and **Secret access key**.
4. In the app: Integrations → AWS → paste both → Connect. ShieldFlow validates the
   key live (STS GetCallerIdentity) and shows the connected account ID.
5. **Sync now** files an account-security CSV (root MFA, password-policy strength,
   MFA-device usage) into the evidence vault.

> Security: the secret key is stored RLS-protected and never returned to the
> browser. Use a dedicated read-only IAM user so the key can be rotated/revoked
> independently. Rotate it from the IAM console at any time → reconnect in the app.

## 5e. Okta integration (identity evidence) — no env vars

1. Okta Admin Console → **Security → API → Tokens** → **Create Token** (a token inherits
   the creating admin's permissions — use a read-only admin).
2. Copy the token. In the app: Integrations → Okta → enter your org URL
   (`your-org.okta.com`) + token → Connect.
3. **Sync now** files a CSV: user status breakdown, MFA enrollment (sampled), password policy.

## 5f. GitLab integration (repo security) — no env vars

1. GitLab → **Preferences → Access Tokens** → create a token with the **`read_api`** scope.
2. App: Integrations → GitLab → paste `glpat-…` → Connect.
3. **Sync now** files a repo-security CSV (visibility, branch protection). gitlab.com only for now.

## 5g. Jira integration (change-management evidence) — no env vars

1. https://id.atlassian.com/manage-profile/security/api-tokens → **Create API token** → copy it.
2. App: Integrations → Jira → enter your site (`your-company.atlassian.net`), the email for
   that token, and the token → Connect.
3. **Sync now** files a projects CSV (your project inventory).

## 5h. Linear integration (issue tracking) — no env vars

1. Linear → **Settings → API → Personal API keys** → create a key.
2. App: Integrations → Linear → paste the key → Connect.
3. **Sync now** files a CSV: team count + recent issue activity.

## 5i. Cloudflare integration (edge security) — no env vars

1. Cloudflare → **My Profile → API Tokens → Create Token** → use a read template
   (e.g. "Read all resources") or scope Zone → Read.
2. App: Integrations → Cloudflare → paste the token → Connect.
3. **Sync now** files a per-zone CSV (SSL/TLS mode, min TLS version, always-use-HTTPS).

## 5j. Google Cloud integration (IAM exposure) — no env vars

1. GCP Console → **IAM & Admin → Service Accounts** → create one (or reuse) → **Keys →
   Add key → JSON**. Download the key file.
2. Grant the service account the **Viewer** (or **Security Reviewer**) role on the project
   so it can read the IAM policy.
3. App: Integrations → Google Cloud → paste the **entire JSON key file** → Connect.
4. **Sync now** files a CSV: how many accounts hold owner/editor (over-privilege check).

> Security: every token/key above is stored RLS-protected and never returned to the
> browser. Each uses read-only scope and can be rotated/revoked at the provider at
> any time → reconnect in the app.

## 6. Sentry (error monitoring)

1. https://sentry.io → create a Next.js project → copy the DSN.
2. `NEXT_PUBLIC_SENTRY_DSN=https://...ingest.sentry.io/...`.
   Without it, Sentry code is a complete no-op.

## 7. PostHog (product analytics)

1. https://posthog.com (EU cloud recommended) → Project settings → copy the API key.
2. `NEXT_PUBLIC_POSTHOG_KEY=phc_...` (host defaults to `https://eu.i.posthog.com`).
   Without it, no analytics code runs.

## Auth hardening (Supabase dashboard — important on the FREE tier)

The code handles malformed input, typos, rate-limit errors, lockouts, etc. But
several protections live in the Supabase dashboard and **must be set there** —
the free tier is easy to knock over otherwise. All of these are free.

1. **Custom SMTP (do this before any real users).** Authentication → Emails →
   SMTP Settings. The built-in mailer sends only a **handful of emails per hour,
   shared across the whole project** — signup confirmations, magic links, and
   password resets all draw from it. One busy hour and *every* user's auth email
   silently fails. Plug in a free SMTP (Resend, Brevo, Mailgun sandbox) and the
   limit is yours to control.
2. **Enable CAPTCHA.** Authentication → Settings → Bot and Abuse Protection →
   turn on hCaptcha or Cloudflare Turnstile. Without it a bot can hammer
   `/signup` and burn your entire email quota in seconds. (Free at both
   providers.) After enabling, pass the token in `signUp`/`signInWithOtp` — ask
   me to wire the widget when you turn it on.
3. **Leaked-password protection.** Authentication → Policies → enable
   "Check passwords against HaveIBeenPwned." Rejects known-breached passwords at
   signup and password change — the code already maps the `weak_password`
   response to a friendly message.
4. **Minimum password strength.** Same screen → set minimum length (≥ 8) and
   required character classes. The form mirrors the 8-char floor client-side.
   ✅ **Done — changed from the Supabase default of 6 to 8** (Authentication →
   Sign In / Providers → Email → "Minimum password length").
5. **Confirm email ON for production.** Authentication → Providers → Email →
   "Confirm email." Prevents signups with addresses the user doesn't own. (You
   can leave it OFF during local testing for speed.)
6. **Redirect allow-list.** Authentication → URL Configuration → Redirect URLs:
   add every environment's `…/api/auth/confirm` (e.g.
   `http://localhost:3001/api/auth/confirm` and your prod URL). Supabase rejects
   redirects not on this list — which also blocks open-redirect abuse.
7. **Tighten the auth rate limits** (optional). Authentication → Rate Limits:
   the defaults are sane, but you can lower the per-IP token/verify limits to
   slow brute-force further. The client already backs off after 5 failed logins.

## Ops notes

- Supabase free projects pause after ~7 idle days — restore from the dashboard.
- Integration tokens/keys/webhooks are encrypted at rest (AES-256-GCM) with
  `SHIELDFLOW_ENCRYPTION_KEY` (§0) and RLS-protected. Rotate by issuing a new key
  and reconnecting integrations; keep the key backed up separately from the DB.
- Stripe is wired for test mode; no real money moves until you swap in live keys.
