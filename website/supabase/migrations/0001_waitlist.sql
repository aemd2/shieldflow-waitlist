create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  company_name text,
  company_size text,
  pain_point text,
  source text,
  created_at timestamptz not null default now()
);

alter table public.waitlist_signups enable row level security;

create index if not exists waitlist_signups_created_at_idx
  on public.waitlist_signups (created_at desc);

create policy "anon can insert waitlist signups"
  on public.waitlist_signups
  for insert
  to anon
  with check (true);
