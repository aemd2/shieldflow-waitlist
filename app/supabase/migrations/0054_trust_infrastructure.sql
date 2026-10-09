-- 0054_trust_infrastructure.sql
--
-- Verified AWS facts on the public Trust Center ("Hosted in the EU — verified
-- today"). Each scan stores the facts that are currently TRUE on the AWS
-- umbrella row (metadata.published_facts); this anon-callable function returns
-- them only when the company has its Trust Center on AND has opted in to
-- showing infrastructure facts (metadata.settings.showOnTrustCenter).
--
-- Same shape as get_trust_subprocessors: SECURITY DEFINER, fixed search_path,
-- returns nothing at all for a company that hasn't opted in.

create or replace function public.get_trust_infrastructure(p_slug text)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select i.metadata -> 'published_facts'
  from public.companies c
  join public.integrations i on i.company_id = c.id and i.provider = 'aws'
  where c.trust_slug = lower(p_slug)
    and c.trust_enabled = true
    and coalesce((i.metadata -> 'settings' ->> 'showOnTrustCenter')::boolean, false)
  limit 1;
$$;

revoke all on function public.get_trust_infrastructure(text) from public;
grant execute on function public.get_trust_infrastructure(text) to anon, authenticated;
