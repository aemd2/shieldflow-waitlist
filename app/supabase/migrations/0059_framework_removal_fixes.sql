-- Make removing a framework actually work, and make re-adding it survive.
--
-- Removing a framework shipped with the UI, the server action and the audit
-- event all correct, and it never once worked. Two defects, both silent:
--
--  1. company_frameworks had SELECT and INSERT policies but no DELETE policy.
--     Under RLS a DELETE that matches no permitted row is not an error — it
--     deletes nothing and reports success. So the action returned ok, the chip
--     disappeared optimistically, a success toast fired, and the row was still
--     there on the next load. The dashboard showed "Frameworks in scope: SOC 2"
--     above progress bars for three frameworks, which is how it was spotted.
--
--  2. add_framework_to_company inserts a control_status row per control with no
--     ON CONFLICT, and control_status is keyed (company_id, control_id).
--     Removing a framework deliberately KEEPS those rows so progress survives,
--     so re-adding it hit a primary key violation every time. That also broke
--     the Undo button in the removal toast, which calls exactly this path.
--
-- Together they made the feature fail whichever way you went: removal did
-- nothing, and if removal had worked, putting it back would have errored.

-- 1. Let an owner or admin delete, mirroring cf_insert exactly — same roles,
--    same expiry check. Members and auditors still cannot.
create policy cf_delete on public.company_frameworks
  for delete
  using (
    exists (
      select 1
      from public.company_members
      where company_members.company_id = company_frameworks.company_id
        and company_members.user_id = auth.uid()
        and company_members.role in ('owner', 'admin')
        and (company_members.expires_at is null or company_members.expires_at > now())
    )
  );

-- 2. Re-adding a framework must not collide with the progress we kept on
--    purpose. DO NOTHING is the correct resolution rather than an upsert: a
--    control the user already worked on keeps its status, owner, due date and
--    notes. Re-adding restores scope, it does not reset work.
create or replace function public.add_framework_to_company(p_company_id uuid, p_framework_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.company_members
    where company_id = p_company_id and user_id = v_uid
      and role in ('owner', 'admin')
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.frameworks where id = p_framework_id) then
    raise exception 'unknown framework';
  end if;

  if exists (
    select 1 from public.company_frameworks
    where company_id = p_company_id and framework_id = p_framework_id
  ) then
    return false; -- already added, nothing to do
  end if;

  insert into public.company_frameworks (company_id, framework_id)
  values (p_company_id, p_framework_id);

  insert into public.control_status (company_id, control_id, status, updated_by)
  select p_company_id, c.id, 'not_started', v_uid
  from public.controls c
  where c.framework_id = p_framework_id
  on conflict (company_id, control_id) do nothing;

  return true;
end;
$function$;
