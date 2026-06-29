-- Tasks / remediation / compliance calendar. A company-scoped work item with an
-- optional assignee, due date, recurrence (for annual access reviews, quarterly pen
-- tests, etc.), and an optional link to the control/risk/vendor/policy it remediates.
-- Same RLS shape as vendors/risks: members read, writers (owner/admin/member, not
-- expired auditors) mutate.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  description text,
  assignee_email text,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  due_date date,
  recurrence text not null default 'none' check (recurrence in ('none','weekly','monthly','quarterly','annually')),
  linked_type text check (linked_type in ('control','risk','vendor','policy')),
  linked_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_company_idx on public.tasks (company_id, status, due_date);

alter table public.tasks enable row level security;

create policy "members read tasks"
  on public.tasks for select to authenticated
  using (public.is_company_member(company_id));
create policy "writers insert tasks"
  on public.tasks for insert to authenticated
  with check (public.can_write_company(company_id));
create policy "writers update tasks"
  on public.tasks for update to authenticated
  using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
create policy "writers delete tasks"
  on public.tasks for delete to authenticated
  using (public.can_write_company(company_id));

-- Allow the 'task' notification category (assignment + overdue alerts).
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('control','integration','policy','vendor','risk','team','system','task'));
alter table public.notification_prefs drop constraint notification_prefs_type_check;
alter table public.notification_prefs add constraint notification_prefs_type_check
  check (type in ('control','integration','policy','vendor','risk','team','system','task'));
