-- 0047_identity_measure_checks.sql
--
-- Let the two roster checks satisfy their measures.
--
-- Both measures have zero check keys today, so this is pure gain: nothing that
-- currently passes can start failing because of it. That constraint is the whole
-- reason this migration is short. A measure auto-completes only when EVERY
-- mapped key with a result is passing, so attaching a key to a measure that
-- already has one raises the bar on every control that measure carries.
--
-- Deliberately NOT attached, and why — each of these looked attractive and each
-- would have made the product worse:
--
--   least-privilege     holds gcp.over_privilege and is the ONLY measure
--                       automating CC6.3 today. Adding an AWS admin-count key
--                       means a company with clean GCP but five AWS admins goes
--                       from passing to failing, and CC6.3 loses its one
--                       automated win.
--
--   mfa                 an AWS check derived from mfaDevicesInUse >= users is a
--                       heuristic: only the FAIL direction is sound, because the
--                       count includes root and one user can hold two devices.
--                       Never raise the bar on CC6.1 with a heuristic.
--
--   service-accounts    the measure is "inventoried, OWNED and ROTATED".
--                       Counting GCP service accounts proves an inventory exists
--                       in GCP, not that we hold one with owners and a rotation
--                       schedule.
--
--   access-request      nothing we can build proves "traceable to a request and
--                       an approval". A Jira/Linear ticket count proves you have
--                       a queue, not that this account came from it. Leaving the
--                       measure empty is more honest than over-claiming.
--
-- untracked_accounts lands on onboarding-checklist rather than access-request on
-- purpose: it proves completeness ("every credential belongs to someone we
-- onboarded"), not that an approval happened.

insert into public.measure_checks (measure_id, check_key)
select m.id, v.check_key
from (values
  -- Someone left; is their account still open? Either identity provider answers.
  ('offboarding-checklist','okta.offboarding_drift'),
  ('offboarding-checklist','google.offboarding_drift'),
  -- An account works; who does it belong to?
  ('onboarding-checklist','okta.untracked_accounts'),
  ('onboarding-checklist','google.untracked_accounts')
) as v(measure_key, check_key)
join public.measures m on m.key = v.measure_key
on conflict do nothing;
