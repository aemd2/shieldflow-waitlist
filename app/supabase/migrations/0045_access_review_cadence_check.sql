-- 0045_access_review_cadence_check.sql
--
-- Let the access-review cadence check satisfy the `access-reviews` measure.
--
-- Every check we had until now needed an integration connected first, which
-- means a workspace on day one has nothing automated at all. This one is derived
-- from our own tables: did a review actually complete inside the last 90 days?
-- No provider API, no OAuth, works immediately.
--
-- It is also the single highest-leverage mapping available. `access-reviews` is
-- a mandatory measure on SOC 2 CC6.1, CC6.2 *and* CC6.3 simultaneously, and
-- carries 13 controls across SOC 2, ISO 27001, HIPAA, PCI DSS, NIS2 and GDPR.
-- One verdict moves all of them.
--
-- Competitors send a reminder when a review is due and leave the dashboard green
-- if you ignore it. A reminder you can ignore is not a control. This makes the
-- cadence itself pass or fail.
--
-- DELIBERATELY EXACTLY ONE CHECK KEY ON THIS MEASURE. A measure completes only
-- when every mapped key with a result is passing, so a second, noisier check
-- attached here would block CC6.1, CC6.2 and CC6.3 at the same time. Any future
-- access-review signal belongs on its own measure, not this one.
--
-- Never-completed is INCONCLUSIVE, not pass (see lib/checks.ts) — a brand-new
-- workspace must not go green by having done nothing.

insert into public.measure_checks (measure_id, check_key)
select m.id, v.check_key
from (values
  ('access-reviews','shieldflow.access_review_cadence')
) as v(measure_key, check_key)
join public.measures m on m.key = v.measure_key
on conflict do nothing;
