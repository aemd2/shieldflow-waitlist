-- 0056_identity_links.sql
--
-- "This GitHub login is Jane." Most systems don't give us a person's work email
-- (GitHub shows a login and, maybe, a public name), so the leaver and
-- unknown-login checks can't tell whose account it is. A link recorded once by
-- someone in the workspace settles it — for GitHub, GitLab, Cloudflare, device
-- owners in an MDM, anything with an account that isn't an email.

create table if not exists public.identity_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  account text not null,
  email text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (company_id, provider, account)
);

alter table public.identity_links enable row level security;

drop policy if exists "members read identity_links" on public.identity_links;
create policy "members read identity_links"
  on public.identity_links for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "writers write identity_links" on public.identity_links;
create policy "writers write identity_links"
  on public.identity_links for insert to authenticated
  with check (public.can_write_company(company_id));

drop policy if exists "writers delete identity_links" on public.identity_links;
create policy "writers delete identity_links"
  on public.identity_links for delete to authenticated
  using (public.can_write_company(company_id));
