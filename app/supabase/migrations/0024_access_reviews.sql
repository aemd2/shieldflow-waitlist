-- Access reviews: a named control in every framework. A review snapshots a set of
-- access subjects (frozen rows, not re-fetched), a reviewer attests keep/revoke per
-- row, and completing it generates an evidence record. We record the attestation —
-- we never revoke access ourselves (that's a liability we don't own).

create table if not exists public.access_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  source text,
  reviewer_email text,
  status text not null default 'open' check (status in ('open','completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  evidence_id uuid references public.evidence(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.access_review_items (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.access_reviews(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  subject text not null,
  access text,
  decision text not null default 'pending' check (decision in ('pending','keep','revoke')),
  note text,
  decided_at timestamptz
);

create index if not exists access_reviews_company_idx on public.access_reviews (company_id, created_at desc);
create index if not exists access_review_items_review_idx on public.access_review_items (review_id);

alter table public.access_reviews enable row level security;
alter table public.access_review_items enable row level security;

create policy "members read access_reviews"
  on public.access_reviews for select to authenticated using (public.is_company_member(company_id));
create policy "writers insert access_reviews"
  on public.access_reviews for insert to authenticated with check (public.can_write_company(company_id));
create policy "writers update access_reviews"
  on public.access_reviews for update to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy "writers delete access_reviews"
  on public.access_reviews for delete to authenticated using (public.can_write_company(company_id));

create policy "members read access_review_items"
  on public.access_review_items for select to authenticated using (public.is_company_member(company_id));
create policy "writers insert access_review_items"
  on public.access_review_items for insert to authenticated with check (public.can_write_company(company_id));
create policy "writers update access_review_items"
  on public.access_review_items for update to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy "writers delete access_review_items"
  on public.access_review_items for delete to authenticated using (public.can_write_company(company_id));
