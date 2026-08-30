-- 0036_measures.sql
--
-- The reusable implementation layer — the missing piece that lets one piece of
-- work satisfy requirements in several frameworks at once.
--
-- Why this shape: six of the seven platforms surveyed converged on exactly this
-- architecture independently, which is about as strong a signal as this field
-- offers.
--
--   Drata           "DCF control"     — a centralised, framework-agnostic master
--                                       library of activities that satisfy the
--                                       requirements of many frameworks at once
--   Vanta           "common control"  — one unified set behind all frameworks
--   Probo           "measure"         — controls_measures join, evidence on the measure
--   CISO Assistant  "AppliedControl"  — M2M to RequirementNode
--   OpenGRC         "Implementation"  — control_implementation pivot
--   (RiskReady is the lone exception: it denormalises the mapping into a
--    comma-separated string, and is also the one shipping no usable content.)
--
-- ShieldFlow's existing `controls` table is already the framework-REQUIREMENT
-- layer (one row per framework per code). What never existed is the layer above
-- it. This migration adds it:
--
--   measures            what you actually do, once, owned by you
--   measure_controls    many-to-many → the requirements it satisfies, across frameworks
--   measure_status      per-company progress on each measure
--
-- Vanta puts the overlap between SOC 2 and ISO 27001 at roughly 80%, so a
-- customer running both currently does most of the work twice. This is the fix.
--
-- Deliberately additive: `control_status` stays the source of truth for scoring,
-- the dashboard, the sprint (lib/setup.ts) and the checks engine. Completing a
-- measure writes through to every control it satisfies, so nothing downstream
-- changes behaviour and this can be reverted by dropping three tables.

-- ---------------------------------------------------------------- measures
-- Global reference data, same access model as `controls` / `frameworks`:
-- readable by anyone, written only by migrations.
create table if not exists public.measures (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  category text not null,
  importance text not null default 'mandatory'
    check (importance in ('mandatory', 'preferred', 'advanced')),
  summary text,
  guidance text,
  suggested_evidence text
);

alter table public.measures enable row level security;

drop policy if exists measures_select on public.measures;
create policy measures_select on public.measures for select using (true);

-- -------------------------------------------------------- measure_controls
-- The crosswalk. Many-to-many in both directions on purpose: one measure can
-- satisfy requirements in several frameworks, and one complex requirement can
-- need several measures (Drata documents the same need — a multi-part
-- requirement is covered by several DCF controls rather than one overloaded one).
create table if not exists public.measure_controls (
  measure_id uuid not null references public.measures(id) on delete cascade,
  control_id uuid not null references public.controls(id) on delete cascade,
  primary key (measure_id, control_id)
);

create index if not exists measure_controls_control_idx
  on public.measure_controls (control_id);

alter table public.measure_controls enable row level security;

drop policy if exists measure_controls_select on public.measure_controls;
create policy measure_controls_select on public.measure_controls for select using (true);

-- ---------------------------------------------------------- measure_status
-- Per-company progress. Mirrors control_status exactly (same status vocabulary,
-- same owner/notes fields) so the UI and server actions can reuse the existing
-- patterns rather than inventing a second vocabulary.
create table if not exists public.measure_status (
  company_id uuid not null references public.companies(id) on delete cascade,
  measure_id uuid not null references public.measures(id) on delete cascade,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'complete')),
  owner_email text,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (company_id, measure_id)
);

create index if not exists measure_status_company_idx
  on public.measure_status (company_id, status);

alter table public.measure_status enable row level security;

drop policy if exists "members read measure status" on public.measure_status;
create policy "members read measure status"
  on public.measure_status for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "writers insert measure status" on public.measure_status;
create policy "writers insert measure status"
  on public.measure_status for insert to authenticated
  with check (public.can_write_company(company_id));

drop policy if exists "writers update measure status" on public.measure_status;
create policy "writers update measure status"
  on public.measure_status for update to authenticated
  using (public.can_write_company(company_id))
  with check (public.can_write_company(company_id));

drop policy if exists "writers delete measure status" on public.measure_status;
create policy "writers delete measure status"
  on public.measure_status for delete to authenticated
  using (public.can_write_company(company_id));
