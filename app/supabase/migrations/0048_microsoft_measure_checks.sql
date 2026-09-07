-- 0048_microsoft_measure_checks.sql
--
-- Microsoft 365 / Entra ID joins Okta and Google as an identity source for the
-- two roster checks.
--
-- Why this mattered enough to build: the identity checks read Okta or Google
-- Workspace, and a large share of the EU mid-market — the buyers MARKET_ANGLES
-- §4 tells us to target — runs Microsoft. Those companies got the access-review
-- cadence check and nothing else from the access-control set, while the pitch
-- implied otherwise. Closing a gap that makes a claim untrue is debt, not a
-- feature.
--
-- No new evaluation logic. evaluateOffboardingDrift and evaluateUntrackedAccounts
-- are provider-agnostic; Microsoft supplies a roster and an `enabled` flag like
-- the others. All this migration does is let its verdicts count.
--
-- Note on the AND semantics, which are what we want here: a measure completes
-- only when EVERY mapped key that has a result is passing. So a company running
-- both Okta and Microsoft must be clean in both — a leaver with a live Okta
-- account is still a finding even when Entra is tidy. And a person who only ever
-- had a Microsoft account reads as "absent from the Okta directory = access
-- removed", which is correct rather than a false pass.

insert into public.measure_checks (measure_id, check_key)
select m.id, v.check_key
from (values
  ('offboarding-checklist','microsoft.offboarding_drift'),
  ('onboarding-checklist','microsoft.untracked_accounts')
) as v(measure_key, check_key)
join public.measures m on m.key = v.measure_key
on conflict do nothing;
