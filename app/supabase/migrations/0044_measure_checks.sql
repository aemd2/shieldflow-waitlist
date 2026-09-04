-- 0044_measure_checks.sql
--
-- Let automated checks satisfy MEASURES, not just controls.
--
-- Today a sync proves root MFA is on, writes a passing `control_checks` row, and
-- the "Require multi-factor authentication" measure still sits unticked waiting
-- for a human to confirm what we already verified. That is the single biggest
-- reason the product feels slow: connecting your stack produces green ticks
-- somewhere the user isn't working.
--
-- Drata automates 75-80% of SOC 2 by hitting controls directly with 1,000+
-- tests. We have 11 checks, but they land on the measure layer — and a measure
-- fans out to ~8 controls. These six measures alone carry 65 control links, so
-- the leverage per check is roughly eight times what it would be control-first.
--
-- Mapping rule, deliberately conservative: a measure auto-completes only when
-- EVERY mapped check that the company actually has a result for is passing. A
-- workspace with only AWS connected can complete `mfa` from aws.root_mfa; one
-- that also has Okta must pass okta.mfa too. Absent checks never count as
-- passing — same principle as the checks engine itself, where missing data is
-- inconclusive and never green.

create table if not exists public.measure_checks (
  measure_id uuid not null references public.measures(id) on delete cascade,
  check_key text not null,
  primary key (measure_id, check_key)
);

create index if not exists measure_checks_check_idx on public.measure_checks (check_key);

alter table public.measure_checks enable row level security;

drop policy if exists measure_checks_select on public.measure_checks;
create policy measure_checks_select on public.measure_checks for select using (true);

insert into public.measure_checks (measure_id, check_key)
select m.id, v.check_key
from (values
  -- MFA is proven by whichever identity surface the company actually uses.
  ('mfa','aws.root_mfa'),
  ('mfa','okta.mfa'),
  ('mfa','google.2fa'),
  -- Password standards, enforced at the IdP or the cloud account.
  ('password-manager','aws.password_policy'),
  ('password-manager','okta.password_policy'),
  -- Peer review / protected branches, on either forge.
  ('branch-protection','github.branch_protection'),
  ('branch-protection','gitlab.branch_protection'),
  -- No unintended public exposure of source.
  ('secure-defaults','github.repo_visibility'),
  ('secure-defaults','gitlab.visibility'),
  -- Over-privilege in the cloud IAM policy.
  ('least-privilege','gcp.over_privilege'),
  -- TLS posture at the edge.
  ('encrypt-in-transit','cloudflare.tls')
) as v(measure_key, check_key)
join public.measures m on m.key = v.measure_key
on conflict do nothing;
