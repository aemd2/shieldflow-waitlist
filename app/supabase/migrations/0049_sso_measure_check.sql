-- 0049_sso_measure_check.sql
--
-- Let the SSO coverage check satisfy the `sso` measure.
--
-- This one nearly didn't get built. The obvious version — count the apps in
-- Okta — proves nothing: "you have 40 apps" is not a control, and by the rule
-- applied in 0047 it would have been rejected the same way service-accounts and
-- access-request were.
--
-- What changed the answer is Okta's `signOnMode`. It distinguishes two things
-- that look identical in the app list:
--
--   SAML_2_0 / OPENID_CONNECT / WS_FEDERATION
--       genuinely federated — Okta is the only way in.
--   BASIC_AUTH / BROWSER_PLUGIN / SECURE_PASSWORD_STORE / AUTO_LOGIN
--       Secure Web Authentication — Okta VAULTS a password and types it into
--       the app's own login form. That password still exists and still works if
--       someone goes to the app directly.
--
-- The second group is SSO as a convenience, not SSO as a control, and it is
-- precisely the bypass an auditor asks about. Counting THOSE is a real
-- enforcement signal, which is why this is allowed to gate the measure when a
-- plain app count was not.
--
-- BOOKMARK is excluded from the denominator: it is a link with no credential,
-- so it can neither be federated nor bypassed.
--
-- The limit, stated in the check's own passing message rather than hidden: an
-- app nobody ever added to Okta is invisible here. No automated check can prove
-- a negative about shadow IT, and every competitor shares that blind spot.
--
-- Okta only. The Google equivalent needs a new OAuth scope, which would force
-- every existing Google customer to reconnect for one check.

insert into public.measure_checks (measure_id, check_key)
select m.id, v.check_key
from (values
  ('sso','okta.sso_coverage')
) as v(measure_key, check_key)
join public.measures m on m.key = v.measure_key
on conflict do nothing;
