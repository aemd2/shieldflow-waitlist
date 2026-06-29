-- Structured, machine-readable findings behind each automated check. The CSV stays
-- as human evidence; these rows are what the engine reasons over (and the basis for
-- drift detection). Written only by the SECURITY DEFINER RPC (manual sync, gated on
-- write access) or the service-role cron (which bypasses RLS) — never by a raw client.

create table if not exists public.integration_findings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  check_key text not null,
  result text not null check (result in ('pass','fail','inconclusive')),
  detail text,
  raw jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);

create index if not exists integration_findings_company_provider_idx
  on public.integration_findings (company_id, provider);

alter table public.integration_findings enable row level security;

create policy "members read integration findings"
  on public.integration_findings for select to authenticated
  using (public.is_company_member(company_id));

-- Replace a provider's findings in one shot (manual-sync path; gates on write access).
create or replace function public.record_integration_findings(
  p_company_id uuid, p_provider text, p_findings jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_write_company(p_company_id) then
    raise exception 'not authorized';
  end if;
  delete from public.integration_findings where company_id = p_company_id and provider = p_provider;
  if p_findings is null or jsonb_typeof(p_findings) <> 'array' then return; end if;
  insert into public.integration_findings (company_id, provider, check_key, result, detail, raw)
  select p_company_id, p_provider, elem->>'check_key', elem->>'result', elem->>'detail',
         coalesce(elem->'raw', '{}'::jsonb)
  from jsonb_array_elements(p_findings) as elem
  where elem->>'check_key' is not null and (elem->>'result') in ('pass','fail','inconclusive');
end;
$$;

revoke all on function public.record_integration_findings(uuid, text, jsonb) from public, anon;
grant execute on function public.record_integration_findings(uuid, text, jsonb) to authenticated;
