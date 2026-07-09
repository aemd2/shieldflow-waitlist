-- Self-serve "add a framework to an existing company" — every competitor
-- surveyed (Vanta, Drata, Sprinto, Scrut, Thoropass) supports running more
-- than one framework per account; ShieldFlow only had the one-shot
-- onboarding path (create_company_with_framework).
--
-- Backfill note: a function with this exact name, and the TS layer calling
-- it (lib/db/queries.ts addFrameworkToCompany, app/actions/frameworks.ts
-- addFramework — both already fully built), already existed live with no
-- migration file behind the RPC (it would have silently vanished on a DB
-- rebuild). It also had a real permission gap: it checked is_company_member
-- (any role, including auditor) rather than restricting to owner/admin —
-- looser than the TS action's own owner/admin-only policy, so a member or
-- even an auditor could call supabase.rpc('add_framework_to_company', ...)
-- directly from the browser and bypass the action entirely. This is the
-- hardened version: owner/admin only (checked inline — a single call site,
-- not worth a new shared helper), boolean return (true = added, false =
-- already had it) instead of void so the UI can give honest feedback either
-- way. Idempotent: adding an already-added framework is a no-op, not an
-- error, matching create_company_with_framework's own idempotent return.
create or replace function public.add_framework_to_company(p_company_id uuid, p_framework_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
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
  where c.framework_id = p_framework_id;

  return true;
end;
$$;

revoke all on function public.add_framework_to_company(uuid, uuid) from public;
grant execute on function public.add_framework_to_company(uuid, uuid) to authenticated;
