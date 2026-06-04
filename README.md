# ShieldFlow — Waitlist Landing Page

Phase 1 of ShieldFlow: a Next.js 15 landing page with Supabase-backed waitlist capture.

## Run locally

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase values
npm run dev
```

Open http://localhost:3000.

## Supabase setup

Apply the migration in `supabase/migrations/0001_waitlist.sql` to your Supabase project (or use the Supabase MCP `apply_migration` tool).

Required env vars:

- `NEXT_PUBLIC_SUPABASE_URL` — project URL
- `SUPABASE_SERVICE_ROLE_KEY` — server-only; used by `/api/waitlist`

## Deploy

Standard Next.js — push to Vercel, set the env vars in the project settings.

## What's next

Phase 2 will scaffold the actual MVP app (auth, frameworks/controls data model, first integration stub). See `docs/Roadmap_ShieldFlow_v2.4.md`.
