-- Policy lifecycle: approval of record + per-version employee acknowledgement.
-- A policy only counts as evidence once a named approver has approved it and the
-- team has acknowledged the current version (mirrors how Vanta/Drata gate policies).

alter table public.policies
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists version integer not null default 1,
  add column if not exists published_at timestamptz,
  add column if not exists review_cadence_months integer;

-- One immutable row per (policy version, person). Acknowledging is a personal
-- attestation, so members insert their OWN row; nobody can edit/delete them.
create table if not exists public.policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  version integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (policy_id, version, user_id)
);

create index if not exists policy_ack_policy_idx
  on public.policy_acknowledgements (policy_id, version);

alter table public.policy_acknowledgements enable row level security;

create policy "members read acks"
  on public.policy_acknowledgements for select to authenticated
  using (public.is_company_member(company_id));

create policy "member acknowledges own"
  on public.policy_acknowledgements for insert to authenticated
  with check (user_id = auth.uid() and public.is_company_member(company_id));
