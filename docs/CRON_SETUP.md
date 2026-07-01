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

## Live: hourly via Supabase `pg_cron` + Vault (competitive cadence)

Vercel Hobby caps its *own* cron feature at daily — a more frequent `vercel.json`
schedule fails at deploy time. Vanta runs its automated tests hourly, so daily-only
was a real gap. Fixed by scheduling from Postgres instead (`pg_cron` + `pg_net`,
enabled on this project), with the secret in **Supabase Vault** — the job definition
in `cron.job` only ever contains a vault lookup, never the raw `CRON_SECRET` value:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- One-time: store the secret encrypted (never appears in cron.job or source).
select vault.create_secret('<CRON_SECRET value>', 'shieldflow_cron_secret',
  'Bearer token for POST /api/cron/sync (continuous compliance monitoring)');

select cron.schedule(
  'shieldflow-continuous-sync',
  '0 * * * *',  -- hourly, on the hour — matches Vanta's cadence
  $$
  select net.http_post(
    url     := 'https://shieldflow.cloud/api/cron/sync',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'shieldflow_cron_secret')
    )
  );
  $$
);
```

The Vercel daily cron (`vercel.json`) stays in place as a redundant fallback — both
calling the same idempotent endpoint hourly + daily is harmless, it just means fresher
data. Check recent runs: `select * from cron.job_run_details order by start_time desc limit 20;`.
To pause: `select cron.unschedule('shieldflow-continuous-sync');`. To rotate the secret:
`select vault.update_secret((select id from vault.secrets where name = 'shieldflow_cron_secret'), '<new value>');`
— no redeploy needed, the next run picks it up.

### Free-tier storage guard

We're on the **Supabase free tier** (500 MB DB cap), so `pg_net`'s response-logging
table (`net._http_response`) needs a backstop: its documented 6-hour auto-expiry has a
known reliability issue upstream (one reported case grew to 430 MB unattended). A second
job prunes both `net._http_response` and `cron.job_run_details` (which `pg_cron` never
auto-cleans) daily at 03:30 UTC, keeping 3/7 days of history respectively:

```sql
select cron.schedule(
  'shieldflow-cron-cleanup',
  '30 3 * * *',
  $$
  delete from net._http_response where created < now() - interval '3 days';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  $$
);
```

Sanity-check current footprint any time: `select pg_size_pretty(pg_database_size(current_database()));`
— at hourly cadence with a small JSON response body, this adds a negligible amount per day.

## Scale note

The endpoint currently walks all connected integrations in one invocation (fine for
the current footprint, `maxDuration = 60s`). At hundreds of companies, page the work
or move to a queue (`pgmq` is available) and add a run-lock; today overlap is unlikely
at daily cadence.
