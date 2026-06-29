-- Security questionnaire / RFP automation. Upload (paste) a list of questions, let
-- the AI draft answers grounded ONLY in this company's compliance data, review, and
-- export. Same RLS shape as the other registers: members read, writers mutate.

create table if not exists public.questionnaires (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.questionnaire_items (
  id uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null references public.questionnaires(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  position integer not null default 0,
  question text not null,
  answer text,
  status text not null default 'draft' check (status in ('draft','needs_review','approved')),
  created_at timestamptz not null default now()
);

create index if not exists questionnaires_company_idx on public.questionnaires (company_id, created_at desc);
create index if not exists questionnaire_items_q_idx on public.questionnaire_items (questionnaire_id, position);

alter table public.questionnaires enable row level security;
alter table public.questionnaire_items enable row level security;

create policy "members read questionnaires"
  on public.questionnaires for select to authenticated using (public.is_company_member(company_id));
create policy "writers insert questionnaires"
  on public.questionnaires for insert to authenticated with check (public.can_write_company(company_id));
create policy "writers update questionnaires"
  on public.questionnaires for update to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy "writers delete questionnaires"
  on public.questionnaires for delete to authenticated using (public.can_write_company(company_id));

create policy "members read questionnaire items"
  on public.questionnaire_items for select to authenticated using (public.is_company_member(company_id));
create policy "writers insert questionnaire items"
  on public.questionnaire_items for insert to authenticated with check (public.can_write_company(company_id));
create policy "writers update questionnaire items"
  on public.questionnaire_items for update to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy "writers delete questionnaire items"
  on public.questionnaire_items for delete to authenticated using (public.can_write_company(company_id));
