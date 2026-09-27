-- 0051_measure_evidence.sql
--
-- Evidence can belong to a measure, not just to one requirement.
--
-- "Do the work once" held for status and broke for evidence. Completing a
-- measure credits every requirement it satisfies in every framework — but the
-- document proving the work had to be uploaded against each requirement
-- separately, or every one of them raised "Completed without evidence". One
-- encryption standard, nine uploads.
--
-- A row with `measure_id` set is attached to the measure and counts as evidence
-- for every requirement the measure covers (measure_controls), including those of
-- a framework added later. It follows the pattern integration reports already
-- use: filed once with no control_id, counted per control through a link.
--
-- A row is attached to a requirement or to a measure, never both.

alter table public.evidence
  add column if not exists measure_id uuid references public.measures(id) on delete set null;

alter table public.evidence
  drop constraint if exists evidence_one_target;
alter table public.evidence
  add constraint evidence_one_target check (control_id is null or measure_id is null);

create index if not exists evidence_company_measure_idx
  on public.evidence (company_id, measure_id)
  where measure_id is not null;
