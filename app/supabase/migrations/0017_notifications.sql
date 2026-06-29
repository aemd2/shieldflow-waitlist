-- Notifications rail: in-app feed + per-category email/in-app preferences.
-- In-app rows are written ONLY by the SECURITY DEFINER notify_users() function
-- (the sole writer), which validates company membership and honors prefs — so a
-- client can never inject a notification for another user or another tenant.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('control','integration','policy','vendor','risk','team','system')),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy "user reads own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

create policy "user updates own notifications"
  on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Per (user, company, category) delivery preferences. A missing row = opted in.
create table if not exists public.notification_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  type text not null check (type in ('control','integration','policy','vendor','risk','team','system')),
  email_enabled boolean not null default true,
  in_app_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, company_id, type)
);

alter table public.notification_prefs enable row level security;

create policy "user manages own notification prefs"
  on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Sole writer for notifications. Inserts one in-app row per recipient who is a
-- member of the company and hasn't disabled in-app for this category, then
-- returns the recipient emails that should also get email (best-effort channel,
-- sent from the app only when RESEND is configured). Mirrors record_control_checks.
create or replace function public.notify_users(
  p_company_id uuid,
  p_user_ids uuid[],
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null
)
returns table(email text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_company_member(p_company_id) then
    raise exception 'not a company member';
  end if;

  insert into public.notifications (company_id, user_id, type, title, body, link)
  select p_company_id, m.user_id, p_type, p_title, p_body, p_link
  from public.company_members m
  left join public.notification_prefs np
    on np.user_id = m.user_id and np.company_id = p_company_id and np.type = p_type
  where m.company_id = p_company_id
    and m.user_id = any(p_user_ids)
    and coalesce(np.in_app_enabled, true);

  return query
  select u.email::text
  from public.company_members m
  join auth.users u on u.id = m.user_id
  left join public.notification_prefs np
    on np.user_id = m.user_id and np.company_id = p_company_id and np.type = p_type
  where m.company_id = p_company_id
    and m.user_id = any(p_user_ids)
    and coalesce(np.email_enabled, true)
    and u.email is not null;
end;
$$;

revoke all on function public.notify_users(uuid, uuid[], text, text, text, text) from public, anon;
grant execute on function public.notify_users(uuid, uuid[], text, text, text, text) to authenticated;
