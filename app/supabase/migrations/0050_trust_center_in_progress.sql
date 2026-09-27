-- 0050_trust_center_in_progress.sql
--
-- The public Trust Center showed a lower number for each framework than the
-- customer's own dashboard: SOC 2 at 6% on the page a prospect sees, 20% on the
-- dashboard, for the same work.
--
-- Both are meant to be the same score — finished requirements plus half credit
-- for ones in progress (lib/score.ts). The overall figure on this page already
-- did that; the per-framework bars couldn't, because this function returned only
-- `total` and `complete` for each framework. It now returns `in_progress` too,
-- and the page scores it with computeScoreFromCounts, like everywhere else.
--
-- Purely additive: callers that ignore the new field keep working, so this can
-- be applied before the app that reads it is deployed. `create or replace`
-- keeps the existing grants (anon may call it; the page is public).

create or replace function public.get_trust_center(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company public.companies%rowtype;
  v_total int;
  v_complete int;
  v_in_progress int;
  v_score int;
  v_frameworks jsonb;
  v_policies jsonb;
begin
  select * into v_company
  from public.companies
  where trust_slug = p_slug and trust_enabled = true;

  if not found then
    return null;
  end if;

  select count(*),
         count(*) filter (where status = 'complete'),
         count(*) filter (where status = 'in_progress')
    into v_total, v_complete, v_in_progress
  from public.control_status
  where company_id = v_company.id;

  v_score := case when v_total = 0 then 0
                  else round((v_complete + 0.5 * v_in_progress) / v_total * 100) end;

  select coalesce(jsonb_agg(fw order by fw->>'name'), '[]'::jsonb) into v_frameworks
  from (
    select jsonb_build_object(
      'name', f.name,
      'total', count(cs.*),
      'complete', count(cs.*) filter (where cs.status = 'complete'),
      'in_progress', count(cs.*) filter (where cs.status = 'in_progress')
    ) as fw
    from public.company_frameworks cf
    join public.frameworks f on f.id = cf.framework_id
    join public.controls c on c.framework_id = f.id
    join public.control_status cs on cs.control_id = c.id and cs.company_id = cf.company_id
    where cf.company_id = v_company.id
    group by f.id, f.name
  ) sub;

  select coalesce(jsonb_agg(title order by title), '[]'::jsonb) into v_policies
  from public.policies
  where company_id = v_company.id and status = 'final';

  return jsonb_build_object(
    'name', v_company.name,
    'score', v_score,
    'controls', jsonb_build_object(
      'total', v_total, 'complete', v_complete, 'in_progress', v_in_progress
    ),
    'frameworks', v_frameworks,
    'policies', v_policies
  );
end;
$function$;
