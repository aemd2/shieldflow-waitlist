-- Trust Center depth: a public subprocessor list + lead-capture access requests.
-- Subprocessors are read publicly (via an anon RPC gated on trust_enabled); access
-- requests are written only by the service-role API route (IP rate-limited), and read
-- by the company's members.

create table if not exists public.subprocessors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  purpose text,
  location text,
  url text,
  created_at timestamptz not null default now()
);
create index if not exists subprocessors_company_idx on public.subprocessors (company_id);
alter table public.subprocessors enable row level security;
create policy "members read subprocessors"
  on public.subprocessors for select to authenticated using (public.is_company_member(company_id));
create policy "writers insert subprocessors"
  on public.subprocessors for insert to authenticated with check (public.can_write_company(company_id));
create policy "writers update subprocessors"
  on public.subprocessors for update to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy "writers delete subprocessors"
  on public.subprocessors for delete to authenticated using (public.can_write_company(company_id));

create table if not exists public.trust_access_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  name text,
  requester_company text,
  message text,
  status text not null default 'new' check (status in ('new','approved','declined')),
  created_at timestamptz not null default now()
);
create index if not exists trust_access_requests_company_idx on public.trust_access_requests (company_id, created_at desc);
alter table public.trust_access_requests enable row level security;
-- No insert policy: inserts happen only via the service-role route. Members read; writers update/delete.
create policy "members read trust_access_requests"
  on public.trust_access_requests for select to authenticated using (public.is_company_member(company_id));
create policy "writers update trust_access_requests"
  on public.trust_access_requests for update to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy "writers delete trust_access_requests"
  on public.trust_access_requests for delete to authenticated using (public.can_write_company(company_id));

-- Public, anon-callable: a company's subprocessors, but only if its Trust Center is enabled.
create or replace function public.get_trust_subprocessors(p_slug text)
returns table(name text, purpose text, location text, url text)
language sql security definer set search_path = public
as $$
  select s.name, s.purpose, s.location, s.url
  from public.companies c
  join public.subprocessors s on s.company_id = c.id
  where c.trust_slug = lower(p_slug) and c.trust_enabled = true
  order by s.name;
$$;
revoke all on function public.get_trust_subprocessors(text) from public;
grant execute on function public.get_trust_subprocessors(text) to anon, authenticated;
