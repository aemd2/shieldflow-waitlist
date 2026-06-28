-- Personnel roster: the "who works here" record auditors expect (joined/left,
-- role, and — via email match to training_records — security-training status).
-- Same RLS shape as the other registers.

create table if not exists public.personnel (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  email text,
  role_title text,
  status text not null default 'active' check (status in ('active','offboarded')),
  started_at date,
  ended_at date,
  created_at timestamptz not null default now()
);

create index if not exists personnel_company_idx on public.personnel (company_id, status);

alter table public.personnel enable row level security;

create policy "members read personnel"
  on public.personnel for select to authenticated using (public.is_company_member(company_id));
create policy "writers insert personnel"
  on public.personnel for insert to authenticated with check (public.can_write_company(company_id));
create policy "writers update personnel"
  on public.personnel for update to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy "writers delete personnel"
  on public.personnel for delete to authenticated using (public.can_write_company(company_id));
