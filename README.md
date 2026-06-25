# ShieldFlow

AI-first GRC (Governance, Risk & Compliance) platform. This is a monorepo holding two independent Next.js apps that share one Supabase project.

```
shieldflow/
  app/        → the product (dashboard, controls, evidence, integrations, billing…)
  website/    → the public marketing site + waitlist
```

## Local development

Each app is a standalone Next.js project with its own dependencies.

```bash
# The product app  →  http://localhost:3001
cd app
npm install
npm run dev

# The marketing site  →  http://localhost:3000
cd website
npm install
npm run dev
```

Both read secrets from their own `.env.local` (gitignored). Copy the template and fill it in:

```bash
cp app/.env.local.example app/.env.local
cp website/.env.local.example website/.env.local
```

`app/.env.local` must include `SHIELDFLOW_ENCRYPTION_KEY` — the existing value must be reused, or integration secrets stored as `v1:` ciphertext can no longer be decrypted. See `app/docs/SETUP.md`.

## Deploy (Vercel — two projects, one repo)

Create **two** Vercel projects from this same repository, each with a different **Root Directory**:

| Project | Root Directory | Domain | Required env |
|---|---|---|---|
| Marketing | `website` | `yourdomain.com` (apex / www) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| App | `app` | `app.yourdomain.com` | full set from `app/.env.local.example` (Supabase, `SHIELDFLOW_ENCRYPTION_KEY`, Stripe, Groq, `NEXT_PUBLIC_APP_URL=https://app.yourdomain.com`, Google OAuth, optional Sentry/PostHog) |

After the app is live, finish wiring (see `app/docs/SETUP.md`):

- Supabase → Auth → URL config: add `https://app.yourdomain.com/**` to redirect URLs + Site URL.
- Google OAuth: add `https://app.yourdomain.com/api/integrations/google/callback`.
- Stripe webhook: `WEBHOOK_URL=https://app.yourdomain.com/api/stripe/webhook npm run setup:stripe-webhook`, then set `STRIPE_WEBHOOK_SECRET` in Vercel.
- Marketing CTAs point to `https://app.yourdomain.com`.
