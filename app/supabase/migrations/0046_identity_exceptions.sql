-- 0046_identity_exceptions.sql
--
-- "That account isn't a person."
--
-- The untracked-accounts check compares live identity-provider accounts against
-- the Personnel register. Some legitimately have nobody behind them: a shared
-- alias, a build robot, a vendor's support login. Without a way to say so, the
-- check would nag forever and the customer would learn to ignore it — which is
-- how a failing control becomes wallpaper.
--
-- We do NOT guess these from the address. An `svc-` or `noreply` prefix rule
-- looks tidy and quietly passes real orphans that happen to be named that way.
-- A human says which accounts are exempt, once, and we keep the record — that
-- decision is itself the evidence an auditor wants to see.
--
-- Mirrors the `out_of_scope` decision access_review_items already has: the
-- reviewer's judgement is recorded, not inferred.

create table if not exists public.identity_exceptions (
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (company_id, email)
);

alter table public.identity_exceptions enable row level security;

drop policy if exists "members read identity_exceptions" on public.identity_exceptions;
create policy "members read identity_exceptions"
  on public.identity_exceptions for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "writers insert identity_exceptions" on public.identity_exceptions;
create policy "writers insert identity_exceptions"
  on public.identity_exceptions for insert to authenticated
  with check (public.can_write_company(company_id));

drop policy if exists "writers delete identity_exceptions" on public.identity_exceptions;
create policy "writers delete identity_exceptions"
  on public.identity_exceptions for delete to authenticated
  using (public.can_write_company(company_id));
