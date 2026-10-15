-- 0057_more_measure_checks.sql
--
-- Link the checks added after 0055 to the measures they prove, so a passing
-- scan completes the measure and a failing one holds it back.
--
-- Deliberately NOT linked (shown, never gating a measure): dormant accounts,
-- weak-only MFA, HSTS, DNSSEC, personal Gmail accounts in Google Cloud, guest
-- lists, app consents, the HR "work email on file" check. Each is worth fixing but
-- none is what the measure itself promises.

insert into public.measure_checks (measure_id, check_key)
select m.id, v.check_key
from (values
  -- Google Workspace: everyone enrolled is part of "require MFA" too
  ('mfa', 'google.2fa'),
  ('offboarding-checklist', 'google.offboarding_drift'),
  ('onboarding-checklist', 'google.untracked_accounts'),
  -- Microsoft 365: Intune coverage, like Kandji and Jamf
  ('endpoint-protection', 'microsoft.device_coverage'),
  ('offboarding-checklist', 'microsoft.offboarding_drift'),
  ('onboarding-checklist', 'microsoft.untracked_accounts'),
  -- Okta: admins without a strong factor
  ('mfa', 'okta.admins_mfa'),
  -- Cloudflare: who can change DNS is access like any other
  ('offboarding-checklist', 'cloudflare.offboarding_drift'),
  ('onboarding-checklist', 'cloudflare.untracked_accounts'),
  -- HR systems: leavers need a leaving date to time access removal; joiners need training
  ('offboarding-checklist', 'personio.leaving_dates'),
  ('offboarding-checklist', 'hibob.leaving_dates'),
  ('offboarding-checklist', 'bamboohr.leaving_dates'),
  ('security-training', 'personio.joiners_training'),
  ('security-training', 'hibob.joiners_training'),
  ('security-training', 'bamboohr.joiners_training')
) as v(measure_key, check_key)
join public.measures m on m.key = v.measure_key
on conflict do nothing;
