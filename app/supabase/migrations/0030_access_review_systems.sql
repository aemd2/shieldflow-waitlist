-- Access review systems: a review now spans MULTIPLE in-scope systems at once
-- (e.g. GitHub + AWS + Okta together), matching how Vanta/Drata actually model
-- a review. Each system is its own entity (name + optional provider), not a
-- pure link row, because it owns its own roster of access_review_items and its
-- own provenance (connected/auto-pulled vs. manual/CSV-uploaded vs. pasted).
-- provider is nullable: null = manual/custom system name the user typed in,
-- non-null = matches an integrations.provider this review pulled a roster from.

create table if not exists public.access_review_systems (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.access_reviews(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  provider text,
  created_at timestamptz not null default now()
);

create index if not exists access_review_systems_review_idx on public.access_review_systems (review_id);
create index if not exists access_review_systems_company_idx on public.access_review_systems (company_id);

alter table public.access_review_systems enable row level security;

create policy "members read access_review_systems"
  on public.access_review_systems for select to authenticated using (public.is_company_member(company_id));
create policy "writers insert access_review_systems"
  on public.access_review_systems for insert to authenticated with check (public.can_write_company(company_id));
create policy "writers update access_review_systems"
  on public.access_review_systems for update to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy "writers delete access_review_systems"
  on public.access_review_systems for delete to authenticated using (public.can_write_company(company_id));

-- Each item now belongs to a specific system within the review (not one flat
-- list). Pre-launch app, no production rows to preserve - required immediately
-- so every downstream query can group by system without null-handling.
alter table public.access_review_items
  add column if not exists system_id uuid references public.access_review_systems(id) on delete cascade;
alter table public.access_review_items
  alter column system_id set not null;

create index if not exists access_review_items_system_idx on public.access_review_items (system_id);

-- Drata's third reviewer state: an account that turns out to be irrelevant to
-- this review's scope (e.g. a service account, a departed contractor row that
-- shouldn't count as either kept or revoked).
alter table public.access_review_items drop constraint access_review_items_decision_check;
alter table public.access_review_items add constraint access_review_items_decision_check
  check (decision in ('pending','keep','revoke','out_of_scope'));
