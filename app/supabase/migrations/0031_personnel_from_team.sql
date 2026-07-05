-- Personnel is the source of truth for "who works here" (audit roster); Team
-- access is layered on top of it, matching how Vanta/Drata model this (Drata:
-- every employee record is granted a base role automatically). Scoped
-- narrowly to the literal ask: accepting a Team invite now also creates a
-- matching Personnel record. Deliberately does NOT touch SSO auto-join,
-- owner/company provisioning, or existing members — those are separate
-- decisions left for later.

-- One personnel row per email per company — lets the insert below use
-- ON CONFLICT DO NOTHING instead of a manual existence check, and prevents
-- accidental duplicates if someone is pre-added to Personnel by hand before
-- their invite is accepted. personnelSchema already lowercases email on
-- manual entry, so a plain (non-lower()-wrapped) partial index is safe.
create unique index if not exists personnel_company_email_idx
  on public.personnel (company_id, email) where email is not null;

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_invite public.company_invites;
  v_email text;
begin
  select * into v_invite from public.company_invites where token = p_token;
  if v_invite.id is null then
    raise exception 'invite_not_found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_used';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_email = '' or v_email <> lower(v_invite.email) then
    raise exception 'invite_email_mismatch';
  end if;

  if exists (select 1 from public.company_members where user_id = auth.uid()) then
    raise exception 'already_in_company';
  end if;

  insert into public.company_members (company_id, user_id, role, expires_at)
  values (v_invite.company_id, auth.uid(), v_invite.role, v_invite.expires_at)
  on conflict do nothing;

  -- No name is available from auth at this point (email/password signup
  -- stores none by default) — derive a readable placeholder from the email's
  -- local part; the owner can rename it like any other Personnel row.
  insert into public.personnel (company_id, name, email, status)
  values (
    v_invite.company_id,
    initcap(replace(replace(replace(split_part(v_email, '@', 1), '.', ' '), '_', ' '), '+', ' ')),
    v_email,
    'active'
  )
  on conflict (company_id, email) where email is not null do nothing;

  update public.company_invites
    set status = 'accepted', accepted_at = now()
    where id = v_invite.id;

  return v_invite.company_id;
end;
$$;
