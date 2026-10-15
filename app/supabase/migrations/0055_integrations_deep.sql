-- 0055_integrations_deep.sql
--
-- Every integration as deep as AWS:
--
-- 1. integrations.provider: 'microsoft' was never added to the check constraint
--    (Microsoft 365 connects failed at insert), and the new HRIS and MDM
--    integrations need their names: personio, hibob, bamboohr, kandji, jamf.
-- 2. integrations.last_scan — each provider's last full scan (results with their
--    resources and accepted exceptions, plus what the provider page shows: repos,
--    people, devices, apps…). AWS keeps its per-account aws_accounts.last_scan.
-- 3. code_changes — the change-management population auditors sample for CC8.1:
--    every pull/merge request merged into a default branch, with who approved it.
--    Upserted per sync, so it builds up a year even though the APIs page newest-first.
-- 4. personnel.source / external_id — people synced from an HRIS keep the HR
--    system's id, so a rename or email change updates the same person.
-- 5. measure_checks for the new checks.
--
-- Note on 0052: aws.admin_users stays on least-privilege. 0047 warned against an
-- AWS *admin-count* key there; aws.admin_users is different — it fails only when
-- a long-lived IAM user holds AdministratorAccess directly, which is a genuine
-- least-privilege failure, not a headcount. The admin-count checks added here
-- (GitHub owners, Google super admins, Entra global admins, Okta admins) are
-- deliberately NOT mapped to least-privilege, for exactly 0047's reason.

-- --------------------------------------------------------------- 1. providers
alter table public.integrations drop constraint if exists integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check check (provider = any (array[
  'google_workspace', 'github', 'slack', 'aws', 'okta', 'jira', 'gitlab', 'linear', 'cloudflare', 'gcp',
  'microsoft', 'personio', 'hibob', 'bamboohr', 'kandji', 'jamf'
]));

-- --------------------------------------------------------------- 2. last_scan
alter table public.integrations add column if not exists last_scan jsonb;

-- ------------------------------------------------------------ 3. code_changes
create table if not exists public.code_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider in ('github', 'gitlab')),
  repo text not null,
  number integer not null,
  title text,
  url text,
  author text,
  merged_by text,
  merged_at timestamptz not null,
  approvers text[] not null default '{}',
  independent_approval boolean not null,
  ticket text,
  recorded_at timestamptz not null default now(),
  unique (company_id, provider, repo, number)
);

create index if not exists code_changes_company_time_idx on public.code_changes (company_id, merged_at desc);

alter table public.code_changes enable row level security;

drop policy if exists "members read code_changes" on public.code_changes;
create policy "members read code_changes"
  on public.code_changes for select to authenticated
  using (public.is_company_member(company_id));

-- Written by a manual sync (the user's session) or the cron (service role). Upserts
-- refresh a PR's approvals if a review arrives after the first sync saw it.
drop policy if exists "writers write code_changes" on public.code_changes;
create policy "writers write code_changes"
  on public.code_changes for insert to authenticated
  with check (public.can_write_company(company_id));

drop policy if exists "writers update code_changes" on public.code_changes;
create policy "writers update code_changes"
  on public.code_changes for update to authenticated
  using (public.can_write_company(company_id))
  with check (public.can_write_company(company_id));

-- -------------------------------------------------------------- 4. personnel
alter table public.personnel add column if not exists source text;
alter table public.personnel add column if not exists external_id text;
create index if not exists personnel_source_idx on public.personnel (company_id, source, external_id);

-- --------------------------------------------------------- 5. measure_checks
insert into public.measure_checks (measure_id, check_key)
select m.id, v.check_key
from (values
  -- GitHub
  ('mfa', 'github.org_2fa_required'),
  ('mfa', 'github.members_without_2fa'),
  ('code-review', 'github.unreviewed_merges'),
  ('change-management', 'github.unreviewed_merges'),
  ('vuln-scanning', 'github.dependabot_enabled'),
  ('patching', 'github.dependabot_sla'),
  ('code-scanning', 'github.secret_scanning'),
  ('offboarding-checklist', 'github.offboarding_drift'),
  ('onboarding-checklist', 'github.untracked_accounts'),
  -- GitLab
  ('mfa', 'gitlab.group_2fa'),
  ('code-review', 'gitlab.unreviewed_merges'),
  ('change-management', 'gitlab.unreviewed_merges'),
  ('code-review', 'gitlab.mr_approvals_required'),
  -- Google Workspace
  ('mfa', 'google.2sv_enforced'),
  ('mfa', 'google.admins_2sv'),
  -- Microsoft 365 / Entra
  ('mfa', 'microsoft.mfa_registered'),
  ('mfa', 'microsoft.mfa_enforced'),
  ('mfa', 'microsoft.admins_mfa'),
  ('endpoint-protection', 'microsoft.device_encryption'),
  ('endpoint-protection', 'microsoft.device_checkin'),
  -- Cloudflare
  ('mfa', 'cloudflare.members_2fa'),
  -- Google Cloud
  ('least-privilege', 'gcp.public_iam'),
  ('service-accounts', 'gcp.sa_key_age'),
  ('network-boundary', 'gcp.public_buckets'),
  ('network-boundary', 'gcp.open_admin_ports'),
  ('network-boundary', 'gcp.sql_public'),
  ('backups', 'gcp.sql_backups'),
  -- MDM
  ('endpoint-protection', 'kandji.device_encryption'),
  ('endpoint-protection', 'kandji.device_checkin'),
  ('endpoint-protection', 'kandji.device_coverage'),
  ('endpoint-protection', 'jamf.device_encryption'),
  ('endpoint-protection', 'jamf.device_checkin'),
  ('endpoint-protection', 'jamf.device_coverage')
) as v(measure_key, check_key)
join public.measures m on m.key = v.measure_key
on conflict do nothing;
