-- SSO (Phase A): map verified email domains to a company so SSO sign-ins join the
-- right workspace just-in-time. SAML itself is configured in Supabase Auth (Pro);
-- this is the app-side domain mapping + JIT membership.

create table if not exists public.company_sso_domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  domain text not null unique,           -- one company per domain (first verified wins)
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists company_sso_domains_company_idx on public.company_sso_domains (company_id);

alter table public.company_sso_domains enable row level security;
create policy "members read sso domains"
  on public.company_sso_domains for select to authenticated using (public.is_company_member(company_id));
create policy "writers insert sso domains"
  on public.company_sso_domains for insert to authenticated with check (public.can_write_company(company_id));
create policy "writers delete sso domains"
  on public.company_sso_domains for delete to authenticated using (public.can_write_company(company_id));

-- Just-in-time membership: add the caller to the company that owns their VERIFIED
-- email domain (as a member), unless they already belong to a workspace. Returns the
-- company id joined (or already in), else null. Derives everything from auth.uid()
-- server-side so nothing can be spoofed by the client.
create or replace function public.join_company_via_sso()
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_email  text;
  v_domain text;
  v_company uuid;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then return null; end if;
  v_domain := lower(split_part(v_email, '@', 2));
  if v_domain = '' then return null; end if;

  select company_id into v_company
  from public.company_sso_domains
  where lower(domain) = v_domain and verified = true
  limit 1;
  if v_company is null then return null; end if;

  -- Already in a workspace? Only return this company if it's the same one.
  if exists (select 1 from public.company_members where user_id = auth.uid()) then
    if exists (select 1 from public.company_members where user_id = auth.uid() and company_id = v_company) then
      return v_company;
    end if;
    return null;
  end if;

  insert into public.company_members (company_id, user_id, role)
  values (v_company, auth.uid(), 'member')
  on conflict do nothing;

  return v_company;
end;
$$;
revoke all on function public.join_company_via_sso() from public, anon;
grant execute on function public.join_company_via_sso() to authenticated;
