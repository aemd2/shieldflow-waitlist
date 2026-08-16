-- Tester plan: numbered invite links that grant a company full ("growth-level")
-- access for a fixed window (14 days by default), after which the workspace
-- falls back to the Free plan. Nothing is ever deleted on expiry — the company
-- keeps its data, it just loses the premium features until it subscribes.
--
-- Link shape is "<random>-<seq>", e.g. /trial/k3m9x2-014. The trailing number is
-- the recipient number so the sender always knows which link went to whom; the
-- random prefix stops strangers walking 001, 002, 003... and burning the codes.

-- ---------- Trial state on the workspace ----------
alter table public.companies
  add column if not exists trial_code       text,
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at    timestamptz;

comment on column public.companies.trial_ends_at is
  'When the Tester trial lapses to Free. Null = never had a trial.';

-- ---------- The numbered links ----------
create table if not exists public.trial_invites (
  code            text primary key,
  seq             int not null unique,      -- the number the link ends with
  label           text,                     -- "Acme Corp - John Smith"
  recipient_email text,
  note            text,
  trial_days      int  not null default 14 check (trial_days between 1 and 90),
  max_uses        int  not null default 1  check (max_uses >= 1),
  used_count      int  not null default 0  check (used_count >= 0),
  active          boolean not null default true,
  expires_at      timestamptz,              -- the LINK expires (not the trial)
  created_at      timestamptz not null default now()
);

comment on table public.trial_invites is
  'One row per numbered Tester-plan link. Ops table: service-role access only.';

-- ---------- Who actually redeemed ----------
create table if not exists public.trial_redemptions (
  id            uuid primary key default gen_random_uuid(),
  code          text not null references public.trial_invites(code) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  user_email    text,
  trial_ends_at timestamptz not null,
  redeemed_at   timestamptz not null default now(),
  -- A workspace gets one trial, ever. Also makes re-redemption idempotent.
  unique (company_id)
);

create index if not exists trial_redemptions_code_idx on public.trial_redemptions (code);

-- ---------- RLS ----------
alter table public.trial_invites     enable row level security;
alter table public.trial_redemptions enable row level security;

-- trial_invites: no anon/authenticated policies at all (same posture as
-- test_accounts). Only the service-role key reads/writes it, which is where the
-- landing page validation and the admin console run.

-- trial_redemptions: members may read their own workspace's row so the app can
-- show "your trial started on X". No write policies — only the RPC below writes.
drop policy if exists "members read own trial redemption" on public.trial_redemptions;
create policy "members read own trial redemption"
  on public.trial_redemptions for select to authenticated
  using (public.is_company_member(company_id));

-- ---------- Redemption ----------
-- SECURITY DEFINER so one call can touch invites + redemptions + companies
-- atomically. Everything is keyed off auth.uid(); the code is the only input,
-- and the caller can never name a company they don't own.
create or replace function public.redeem_trial_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_inv     public.trial_invites%rowtype;
  v_ends    timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- The trial is a workspace-level grant, so only the OWNER can consume one.
  select c.id into v_company
    from public.companies c
   where c.owner_user_id = v_uid
   order by c.created_at
   limit 1;

  if v_company is null then
    return jsonb_build_object('ok', false, 'error', 'no_company');
  end if;

  -- Idempotent by design: a refresh, a double-click, or following the link a
  -- second time all land here and succeed without granting a second trial.
  select trial_ends_at into v_ends
    from public.trial_redemptions where company_id = v_company;
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'trial_ends_at', v_ends);
  end if;

  -- Lock the invite so two concurrent redemptions can't both pass the use check.
  select * into v_inv from public.trial_invites where code = p_code for update;
  if not found or not v_inv.active then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'link_expired');
  end if;
  if v_inv.used_count >= v_inv.max_uses then
    return jsonb_build_object('ok', false, 'error', 'already_used');
  end if;

  v_ends := now() + make_interval(days => v_inv.trial_days);

  insert into public.trial_redemptions (code, company_id, user_id, user_email, trial_ends_at)
  values (p_code, v_company, v_uid,
          (select email from auth.users where id = v_uid), v_ends);

  update public.trial_invites
     set used_count = used_count + 1
   where code = p_code;

  update public.companies
     set trial_code = p_code, trial_started_at = now(), trial_ends_at = v_ends
   where id = v_company;

  return jsonb_build_object('ok', true, 'trial_ends_at', v_ends, 'trial_days', v_inv.trial_days);
end;
$$;

revoke all on function public.redeem_trial_invite(text) from public;
grant execute on function public.redeem_trial_invite(text) to authenticated;

-- ---------- Seed the first 50 links ----------
-- 6 hex chars from gen_random_uuid() (crypto-random) + the recipient number.
insert into public.trial_invites (code, seq)
select substr(replace(gen_random_uuid()::text, '-', ''), 1, 6) || '-' || lpad(s::text, 3, '0'), s
  from generate_series(1, 50) s
on conflict (seq) do nothing;
