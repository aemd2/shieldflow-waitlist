-- Vendor depth: turn the manual register into a reviewable assessment. Adds a
-- review cadence (so reviewed_at finally drives a "re-review due" alert), a SOC 2
-- report status + expiry, a security contact, and a data-sensitivity classification.

alter table public.vendors
  add column if not exists review_cadence_months integer,
  add column if not exists contact_email text,
  add column if not exists soc2_status text not null default 'none'
    check (soc2_status in ('none','requested','on_file')),
  add column if not exists soc2_expires_at date,
  add column if not exists data_sensitivity text not null default 'none'
    check (data_sensitivity in ('none','internal','pii','phi'));
