-- Risk register depth: inherent vs residual scoring + risk-to-control linking.
-- The existing likelihood/impact are the INHERENT (pre-mitigation) assessment;
-- residual_* capture the post-mitigation level. risk_controls maps a risk to the
-- controls that treat it (the mitigation), so residual exposure is grounded in
-- real control coverage instead of a free-text paragraph.

alter table public.risks
  add column if not exists residual_likelihood text check (residual_likelihood in ('low','medium','high')),
  add column if not exists residual_impact text check (residual_impact in ('low','medium','high'));

create table if not exists public.risk_controls (
  risk_id uuid not null references public.risks(id) on delete cascade,
  control_id uuid not null references public.controls(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (risk_id, control_id)
);

create index if not exists risk_controls_company_idx on public.risk_controls (company_id);
create index if not exists risk_controls_risk_idx on public.risk_controls (risk_id);

alter table public.risk_controls enable row level security;

create policy "members read risk_controls"
  on public.risk_controls for select to authenticated
  using (public.is_company_member(company_id));
create policy "writers insert risk_controls"
  on public.risk_controls for insert to authenticated
  with check (public.can_write_company(company_id));
create policy "writers delete risk_controls"
  on public.risk_controls for delete to authenticated
  using (public.can_write_company(company_id));
