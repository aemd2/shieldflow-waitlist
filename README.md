# ShieldFlow

AI-first GRC (Governance, Risk & Compliance) platform. **One Next.js app** serves both
the public marketing site and the product:

```
shieldflow/
  app/        → the whole thing
    /           public marketing landing (waitlist) — signed-in users are sent into the app
    /login      auth → dashboard, controls, evidence, integrations, billing…
    /thanks     waitlist confirmation
    /privacy /terms /trust/[slug]   public pages
```

The root route (`app/app/page.tsx`) is the hinge: signed-out visitors see the marketing
landing; signed-in users are redirected straight to `/dashboard` (or `/onboarding`). The
public marketing paths are allow-listed in `app/lib/supabase/middleware.ts`; everything
else stays behind auth.

## Local development

```bash
cd app
npm install
npm run dev          # → http://localhost:3001
```

Secrets come from `app/.env.local` (gitignored). Copy the template and fill it in:

```bash
cp app/.env.local.example app/.env.local
```

`app/.env.local` must include `SHIELDFLOW_ENCRYPTION_KEY` — the existing value must be
reused, or integration secrets stored as `v1:` ciphertext can no longer be decrypted.
`SUPABASE_SERVICE_ROLE_KEY` is required for the Stripe webhook and the public waitlist
insert. See `app/docs/SETUP.md`.

## Deploy (Vercel — one project)

Create **one** Vercel project from this repo with **Root Directory = `app`**, on a single
domain (e.g. `shieldflow.com`). Marketing and product live on the same origin, so there is
no cross-domain wiring.

Env: the full set from `app/.env.local.example` — Supabase URL/anon/service-role,
`SHIELDFLOW_ENCRYPTION_KEY` (reuse the existing value), Stripe, Groq, Google OAuth, and
optional Sentry/PostHog.

After the first deploy (see `app/docs/SETUP.md`):

- Supabase → Auth → URL config: add `https://yourdomain.com/**` to redirect URLs + Site URL.
- Google OAuth: add `https://yourdomain.com/api/integrations/google/callback`.
- Stripe webhook: `WEBHOOK_URL=https://yourdomain.com/api/stripe/webhook npm run setup:stripe-webhook`, then set `STRIPE_WEBHOOK_SECRET` in Vercel.
