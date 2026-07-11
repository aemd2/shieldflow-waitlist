-- Registry of known internal test accounts, so real metrics (founding-spot
-- count, dashboards, personnel) can exclude them and they're never confused
-- with real customers. Identifiers + a human label ONLY — NEVER passwords.
-- Passwords live hashed in auth.users; a second plaintext copy is exactly what
-- leaked in the public repo (docs/00-user.md, removed 2026-07-11) and must
-- never be reintroduced. Seed emails/user_ids belong to the maintainer's own
-- test accounts.
create table if not exists public.test_accounts (
  email text primary key,
  user_id uuid references auth.users(id) on delete set null,
  label text,
  note text,
  created_at timestamptz not null default now()
);
alter table public.test_accounts enable row level security;
-- Internal ops table: no anon/authenticated policies at all, so it is invisible
-- to normal app users. Only the service-role key (server-side, RLS-bypassing)
-- reads it — which is exactly where any metric-exclusion logic runs.

-- Seed is intentionally kept in the live DB (applied via MCP) rather than
-- hard-coding user_ids here, since user_ids differ per environment. To re-seed
-- a fresh environment, insert by email and backfill user_id from auth.users.
insert into public.test_accounts (email, label, note)
values
  ('aemd2donchev@gmail.com',                'owner / jobseeker',     'primary test workspace owner'),
  ('work@emildonchev-producrdesigner.com',  'member / employer',     'test member'),
  ('mikesmith1231456214546@gmail.com',      'member / employer 2',   'test member 2'),
  ('sarahjohnson789115@gmail.com',          'auditor / jobseeker 2', 'read-only auditor test'),
  ('aemd2donchev1@gmail.com',               'admin',                 'planned admin test account — auth user not created yet')
on conflict (email) do nothing;

update public.test_accounts t
   set user_id = u.id
  from auth.users u
 where lower(u.email) = lower(t.email)
   and t.user_id is null;

-- Convenience helper. Locked down: NOT granted to anon/authenticated, so it
-- adds no SECURITY DEFINER attack surface (per the §2c hardening review) —
-- only service_role / postgres can call it. Server code using the admin client
-- can also just query the table directly.
create or replace function public.is_test_account(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.test_accounts where lower(email) = lower(p_email));
$$;
revoke all on function public.is_test_account(text) from public;
