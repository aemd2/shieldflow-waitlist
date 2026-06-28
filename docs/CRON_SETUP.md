# Continuous-sync cron (Phase 1.4)

The endpoint `GET|POST /api/cron/sync` re-runs every connected, syncable integration
(`aws, github, okta, gcp, cloudflare, gitlab`), re-evaluates the automated checks
(replacing the prior verdicts, preserving the evidence link), records structured
`integration_findings`, and sends **one drift digest per company** when a check
crosses into/out of `fail`. Each integration is isolated — one revoked token flags
that integration and the rest still run. Google Workspace is manual-only for now
(its OAuth token needs interactive refresh).

It is protected by a shared secret: callers must send `CRON_SECRET` as
`Authorization: Bearer <secret>` (or `x-cron-secret: <secret>`). Without the secret —
or without the env var set — it returns `401`.

## 1. Set the secret

A `CRON_SECRET` is already in `app/.env.local` for local testing. Set the **same**
value in **Vercel → Settings → Environment Variables** (Production), then redeploy.

## 2. Schedule it — Vercel Cron (default)

`app/vercel.json` already declares a daily run:

```json
{ "crons": [ { "path": "/api/cron/sync", "schedule": "0 6 * * *" } ] }
```

When `CRON_SECRET` is set, **Vercel automatically sends** `Authorization: Bearer <CRON_SECRET>`
on the scheduled request, which the route checks. Nothing else is required. Hobby plan
allows one daily cron — which is plenty for daily drift detection.

## 3. Test it manually

```bash
# Production
curl -s -X POST https://shieldflow.cloud/api/cron/sync \
  -H "Authorization: Bearer $CRON_SECRET" | jq

# Local
curl -s -X POST http://localhost:3001/api/cron/sync \
  -H "Authorization: Bearer f94f9d09...<your local secret>" | jq
```

Expected: `{ "ok": true, "companies": N, "integrations": N, "synced": N, "drift": N, "failing": N, "errors": N }`.
Without the header → `401`. Flip an AWS/GitHub setting, run twice, and a connected
member should get an "Automated monitoring update" notification on the second run.

## Alternative — Supabase `pg_cron` (for sub-daily schedules)

Vercel Hobby caps cron at daily. To run more often, schedule from Postgres instead
(extensions `pg_cron` + `pg_net` are available on this project). Run once in the SQL
editor, replacing the secret:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'shieldflow-continuous-sync',
  '0 */6 * * *',  -- every 6 hours
  $$
  select net.http_post(
    url     := 'https://shieldflow.cloud/api/cron/sync',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  );
  $$
);
```

Keep the secret out of source — store it in Supabase Vault and read it in the job if
you prefer. To remove: `select cron.unschedule('shieldflow-continuous-sync');`

## Scale note

The endpoint currently walks all connected integrations in one invocation (fine for
the current footprint, `maxDuration = 60s`). At hundreds of companies, page the work
or move to a queue (`pgmq` is available) and add a run-lock; today overlap is unlikely
at daily cadence.
