-- 0052_aws_deep.sql
--
-- The foundations for a deep AWS integration (docs/CUSTOMER_NEEDS_RESEARCH.md,
-- plan "Deep AWS integration — built around what Sam actually needs").
--
-- 1. aws_accounts — several AWS accounts per workspace (prod, staging, dev),
--    each in audit scope or not, connected by a read-only role (preferred) or a
--    legacy access key. The `integrations` row with provider 'aws' stays as the
--    umbrella: plan slot, card status, cron selection.
-- 2. aws_connect_requests — the External ID issued *before* the customer creates
--    the role, so the CloudFormation link / Terraform snippet can carry it.
-- 3. check_exceptions — "this resource is out of scope, because…", per check and
--    resource, with an optional expiry. The recorded decision is itself evidence;
--    generalises identity_exceptions (0046), which stays for identity checks.
-- 4. check_history — append-only verdicts per sync. control_checks is replaced on
--    every sync (delete-then-insert), so without this nothing proves a control
--    held on any past day — which is what a Type II period is.
-- 5. aws_change_events — append-only manual changes to production, kept beyond
--    the 90 days CloudTrail's free event history covers.
-- 6. measure_checks rows for the new AWS checks (0044 idiom).

-- ---------------------------------------------------------------- aws_accounts
create table if not exists public.aws_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  account_id text not null check (account_id ~ '^[0-9]{12}$'),
  alias text,
  auth_kind text not null check (auth_kind in ('role', 'key')),
  role_arn text,
  external_id text,
  encrypted_key text,
  in_scope boolean not null default true,
  regions text[],
  status text not null default 'connected' check (status in ('connected', 'error')),
  last_error text,
  last_synced_at timestamptz,
  last_scan jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (company_id, account_id),
  check (
    (auth_kind = 'role' and role_arn is not null and external_id is not null)
    or (auth_kind = 'key' and encrypted_key is not null)
  )
);

create index if not exists aws_accounts_company_idx on public.aws_accounts (company_id);

alter table public.aws_accounts enable row level security;

drop policy if exists "members read aws_accounts" on public.aws_accounts;
create policy "members read aws_accounts"
  on public.aws_accounts for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "writers insert aws_accounts" on public.aws_accounts;
create policy "writers insert aws_accounts"
  on public.aws_accounts for insert to authenticated
  with check (public.can_write_company(company_id));

drop policy if exists "writers update aws_accounts" on public.aws_accounts;
create policy "writers update aws_accounts"
  on public.aws_accounts for update to authenticated
  using (public.can_write_company(company_id))
  with check (public.can_write_company(company_id));

drop policy if exists "writers delete aws_accounts" on public.aws_accounts;
create policy "writers delete aws_accounts"
  on public.aws_accounts for delete to authenticated
  using (public.can_write_company(company_id));

-- -------------------------------------------------------- aws_connect_requests
create table if not exists public.aws_connect_requests (
  company_id uuid primary key references public.companies(id) on delete cascade,
  external_id text not null unique,
  created_at timestamptz not null default now()
);

alter table public.aws_connect_requests enable row level security;

drop policy if exists "members read aws_connect_requests" on public.aws_connect_requests;
create policy "members read aws_connect_requests"
  on public.aws_connect_requests for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "writers insert aws_connect_requests" on public.aws_connect_requests;
create policy "writers insert aws_connect_requests"
  on public.aws_connect_requests for insert to authenticated
  with check (public.can_write_company(company_id));

-- ------------------------------------------------------------ check_exceptions
create table if not exists public.check_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  check_key text not null,
  resource_id text not null,
  label text,
  reason text not null check (length(trim(reason)) > 0),
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (company_id, check_key, resource_id)
);

alter table public.check_exceptions enable row level security;

drop policy if exists "members read check_exceptions" on public.check_exceptions;
create policy "members read check_exceptions"
  on public.check_exceptions for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "writers insert check_exceptions" on public.check_exceptions;
create policy "writers insert check_exceptions"
  on public.check_exceptions for insert to authenticated
  with check (public.can_write_company(company_id));

drop policy if exists "writers delete check_exceptions" on public.check_exceptions;
create policy "writers delete check_exceptions"
  on public.check_exceptions for delete to authenticated
  using (public.can_write_company(company_id));

-- --------------------------------------------------------------- check_history
create table if not exists public.check_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  check_key text not null,
  result text not null check (result in ('pass', 'fail', 'inconclusive')),
  failing_count integer,
  detail text,
  observed_at timestamptz not null default now()
);

create index if not exists check_history_company_key_idx
  on public.check_history (company_id, check_key, observed_at desc);

alter table public.check_history enable row level security;

drop policy if exists "members read check_history" on public.check_history;
create policy "members read check_history"
  on public.check_history for select to authenticated
  using (public.is_company_member(company_id));

-- Append-only: no update or delete policy, and inserts go through this function
-- so observed_at is the server's clock, never the client's.
create or replace function public.record_check_history(
  p_company_id uuid, p_provider text, p_rows jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_write_company(p_company_id) then
    raise exception 'not authorized';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return; end if;
  insert into public.check_history (company_id, provider, check_key, result, failing_count, detail)
  select p_company_id, p_provider, elem->>'check_key', elem->>'result',
         nullif(elem->>'failing_count', '')::integer, left(elem->>'detail', 2000)
  from jsonb_array_elements(p_rows) as elem
  where elem->>'check_key' is not null and (elem->>'result') in ('pass', 'fail', 'inconclusive');
end;
$$;

revoke all on function public.record_check_history(uuid, text, jsonb) from public, anon;
grant execute on function public.record_check_history(uuid, text, jsonb) to authenticated;

-- ----------------------------------------------------------- aws_change_events
create table if not exists public.aws_change_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  account_id text not null,
  region text not null,
  event_id text not null,
  event_time timestamptz not null,
  event_name text not null,
  event_source text not null,
  principal text,
  via text not null check (via in ('console', 'root', 'other')),
  resources text,
  recorded_at timestamptz not null default now(),
  unique (company_id, event_id)
);

create index if not exists aws_change_events_company_time_idx
  on public.aws_change_events (company_id, event_time desc);

alter table public.aws_change_events enable row level security;

drop policy if exists "members read aws_change_events" on public.aws_change_events;
create policy "members read aws_change_events"
  on public.aws_change_events for select to authenticated
  using (public.is_company_member(company_id));

-- Append-only from a manual sync; the cron writes with the service role.
drop policy if exists "writers insert aws_change_events" on public.aws_change_events;
create policy "writers insert aws_change_events"
  on public.aws_change_events for insert to authenticated
  with check (public.can_write_company(company_id));

-- -------------------------------------------------------------- measure_checks
-- A measure completes only when every mapped check that has a result passes;
-- informational AWS checks (Flow Logs, Config, Security Hub, deletion
-- protection, manual changes) are deliberately not mapped.
insert into public.measure_checks (measure_id, check_key)
select m.id, v.check_key
from (values
  ('mfa', 'aws.iam_user_mfa'),
  ('service-accounts', 'aws.root_access_keys'),
  ('service-accounts', 'aws.access_key_age'),
  ('service-accounts', 'aws.unused_credentials'),
  ('least-privilege', 'aws.admin_users'),
  ('centralised-logging', 'aws.cloudtrail_enabled'),
  ('centralised-logging', 'aws.cloudtrail_log_validation'),
  ('centralised-logging', 'aws.log_retention'),
  ('alerting', 'aws.guardduty_enabled'),
  ('alerting', 'aws.guardduty_findings'),
  ('network-boundary', 'aws.s3_account_public_access_block'),
  ('network-boundary', 'aws.s3_public_buckets'),
  ('network-boundary', 'aws.public_snapshots'),
  ('network-boundary', 'aws.rds_public'),
  ('network-boundary', 'aws.open_admin_ports'),
  ('network-boundary', 'aws.open_database_ports'),
  ('network-boundary', 'aws.lambda_public_urls'),
  ('encrypt-at-rest', 'aws.rds_encrypted'),
  ('encrypt-at-rest', 'aws.ebs_default_encryption'),
  ('encrypt-at-rest', 'aws.ebs_unencrypted_volumes'),
  ('encrypt-at-rest', 'aws.kms_rotation'),
  ('patching', 'aws.lambda_runtimes'),
  ('patching', 'aws.rds_engine_support'),
  ('patching', 'aws.eks_version_support'),
  ('vuln-scanning', 'aws.image_vulnerabilities'),
  ('backups', 'aws.rds_backups'),
  ('backups', 'aws.dynamodb_pitr'),
  ('offboarding-checklist', 'aws.offboarding_drift'),
  ('onboarding-checklist', 'aws.untracked_accounts')
) as v(measure_key, check_key)
join public.measures m on m.key = v.measure_key
on conflict do nothing;
