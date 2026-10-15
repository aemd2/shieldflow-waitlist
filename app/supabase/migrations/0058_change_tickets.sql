-- 0058_change_tickets.sql
--
-- Close the change-management loop: each merged change's ticket, as Jira or
-- Linear knows it (title, status, link), and the incident population — tickets
-- labelled as incidents — kept beyond what the tracker pages back to.

alter table public.code_changes add column if not exists ticket_title text;
alter table public.code_changes add column if not exists ticket_status text;
alter table public.code_changes add column if not exists ticket_url text;
alter table public.code_changes add column if not exists ticket_checked_at timestamptz;

create table if not exists public.incident_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider in ('jira', 'linear')),
  key text not null,
  title text not null,
  status text,
  url text,
  created_at_source timestamptz,
  resolved_at timestamptz,
  recorded_at timestamptz not null default now(),
  unique (company_id, provider, key)
);
alter table public.incident_records enable row level security;
drop policy if exists "members read incident_records" on public.incident_records;
create policy "members read incident_records" on public.incident_records for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "writers insert incident_records" on public.incident_records;
create policy "writers insert incident_records" on public.incident_records for insert to authenticated with check (public.can_write_company(company_id));
drop policy if exists "writers update incident_records" on public.incident_records;
create policy "writers update incident_records" on public.incident_records for update to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
