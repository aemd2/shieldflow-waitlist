-- 0041_privacy_measures_and_remaining_crosswalks.sql
--
-- Six privacy-specific measures (GDPR needs obligations the security library does
-- not cover — lawful basis, data subject rights, DPIAs, a DPO), then crosswalks
-- HIPAA, GDPR and PCI DSS onto the measure library.
--
-- After this every framework in the product is fully covered by measures. HIPAA
-- and PCI DSS need almost nothing new: HIPAA's Security Rule and PCI's twelve
-- requirements are largely the same practices SOC 2 and ISO 27001 already ask
-- for, which is precisely the overlap the measure layer exists to exploit.

insert into public.measures (key, name, category, importance, summary, guidance, suggested_evidence) values
('ropa','Maintain records of processing activities','Privacy','mandatory',
 'A register of what personal data you process, why, and on what basis.',
 'GDPR Article 30 requires a written record per processing activity: purpose, categories of data and data subjects, recipients, transfers, retention and security measures. It is the first thing a supervisory authority asks for.',
 E'Records of processing activities (Article 30 register)\nProcessing purposes and lawful bases\nRetention periods per activity'),

('lawful-basis','Establish a lawful basis for processing','Privacy','mandatory',
 'A documented legal basis for every processing activity, and valid consent where relied on.',
 'Identify and record the lawful basis for each activity. Where you rely on consent it must be freely given, specific, informed and as easy to withdraw as to give — and you must be able to demonstrate it.',
 E'Lawful basis recorded per processing activity\nConsent capture and withdrawal records\nLegitimate interest assessments where relied on'),

('privacy-notice','Publish a privacy notice','Privacy','mandatory',
 'Clear information to data subjects about what you do with their data.',
 'Publish a notice covering identity and contact details, purposes and lawful basis, recipients, transfers, retention, and the rights available — at the point data is collected.',
 E'Published privacy notice\nJust-in-time notices at collection points\nEvidence the notice is kept current'),

('dsr-process','Handle data subject requests','Privacy','mandatory',
 'A working process to answer access, rectification, erasure, restriction and portability requests within a month.',
 'Have a route for requests to arrive, a way to verify identity, and a repeatable method to find that person''s data across your systems. One month is the default deadline. This depends entirely on your data inventory being accurate.',
 E'Documented data subject request procedure\nRequest log with dates and outcomes\nIdentity verification method'),

('dpia','Run data protection impact assessments','Privacy','mandatory',
 'An assessment before processing that is likely to be high risk.',
 'Where processing is likely to result in a high risk — large-scale special category data, systematic monitoring, new technologies — carry out and document a DPIA before you start.',
 E'Completed DPIAs\nDPIA screening or threshold assessment\nMitigations identified and applied'),

('dpo','Appoint a privacy lead or DPO','Privacy','mandatory',
 'A named person accountable for data protection, contactable by data subjects and the regulator.',
 'Appoint a DPO where Article 37 requires one; otherwise name a privacy lead anyway. Publish the contact route and make sure they are involved early in processing decisions.',
 E'DPO or privacy lead appointment record\nPublished contact details\nEvidence of involvement in privacy decisions')
on conflict (key) do nothing;

-- --------------------------------------------------------------------- GDPR
insert into public.measure_controls (measure_id, control_id)
select m.id, c.id
from (values
  ('ropa','Art. 5'),('data-inventory','Art. 5'),('security-policies','Art. 5'),
  ('lawful-basis','Art. 6'),('lawful-basis','Art. 7'),
  ('privacy-notice','Art. 13-14'),
  ('dsr-process','Art. 15'),('dsr-process','Art. 16'),
  ('dsr-process','Art. 17'),('secure-disposal','Art. 17'),
  ('dsr-process','Art. 18'),('dsr-process','Art. 20'),
  ('secure-defaults','Art. 25'),('sdlc','Art. 25'),('data-inventory','Art. 25'),
  ('vendor-contracts','Art. 28'),('vendor-reviews','Art. 28'),
  ('ropa','Art. 30'),('data-inventory','Art. 30'),
  ('encrypt-in-transit','Art. 32'),('encrypt-at-rest','Art. 32'),('access-reviews','Art. 32'),
  ('backups','Art. 32'),('mfa','Art. 32'),
  ('breach-notification','Art. 33-34'),('regulatory-reporting','Art. 33-34'),('incident-log','Art. 33-34'),
  ('dpia','Art. 35'),
  ('dpo','Art. 37')
) as x(mkey, code)
join public.measures m on m.key = x.mkey
join public.frameworks f on f.slug = 'gdpr'
join public.controls c on c.framework_id = f.id and c.code = x.code
on conflict do nothing;

-- -------------------------------------------------------------------- HIPAA
insert into public.measure_controls (measure_id, control_id)
select m.id, c.id
from (values
  ('risk-assessment','164.308(a)(1)'),('risk-treatment','164.308(a)(1)'),('control-review','164.308(a)(1)'),
  ('security-leadership','164.308(a)(2)'),
  ('onboarding-checklist','164.308(a)(3)'),('offboarding-checklist','164.308(a)(3)'),('background-checks','164.308(a)(3)'),
  ('least-privilege','164.308(a)(4)'),('access-request','164.308(a)(4)'),('access-reviews','164.308(a)(4)'),
  ('security-training','164.308(a)(5)'),('unauthorised-software','164.308(a)(5)'),('password-manager','164.308(a)(5)'),
  ('incident-response-plan','164.308(a)(6)'),('incident-log','164.308(a)(6)'),('post-incident-review','164.308(a)(6)'),
  ('backups','164.308(a)(7)'),('dr-plan','164.308(a)(7)'),('crisis-management','164.308(a)(7)'),
  ('control-review','164.308(a)(8)'),('effectiveness-review','164.308(a)(8)'),('pen-test','164.308(a)(8)'),
  ('physical-access','164.310(a)(1)'),
  ('endpoint-protection','164.310(b)'),('physical-access','164.310(b)'),
  ('secure-disposal','164.310(d)(1)'),('asset-inventory','164.310(d)(1)'),('endpoint-protection','164.310(d)(1)'),
  ('least-privilege','164.312(a)(1)'),('sso','164.312(a)(1)'),('encrypt-at-rest','164.312(a)(1)'),
  ('centralised-logging','164.312(b)'),('alerting','164.312(b)'),
  ('encrypt-at-rest','164.312(c)(1)'),('backups','164.312(c)(1)'),('change-management','164.312(c)(1)'),
  ('mfa','164.312(d)'),('sso','164.312(d)'),
  ('encrypt-in-transit','164.312(e)(1)')
) as x(mkey, code)
join public.measures m on m.key = x.mkey
join public.frameworks f on f.slug = 'hipaa'
join public.controls c on c.framework_id = f.id and c.code = x.code
on conflict do nothing;

-- ------------------------------------------------------------------ PCI DSS
insert into public.measure_controls (measure_id, control_id)
select m.id, c.id
from (values
  ('network-boundary','Req 1'),
  ('secure-defaults','Req 2'),('separate-environments','Req 2'),
  ('encrypt-at-rest','Req 3'),('secure-disposal','Req 3'),('data-inventory','Req 3'),
  ('encrypt-in-transit','Req 4'),
  ('endpoint-protection','Req 5'),('unauthorised-software','Req 5'),
  ('patching','Req 6'),('vuln-scanning','Req 6'),('code-review','Req 6'),('sdlc','Req 6'),('code-scanning','Req 6'),
  ('least-privilege','Req 7'),('access-reviews','Req 7'),
  ('mfa','Req 8'),('sso','Req 8'),('password-manager','Req 8'),('access-request','Req 8'),
  ('physical-access','Req 9'),('secure-disposal','Req 9'),
  ('centralised-logging','Req 10'),('alerting','Req 10'),('clock-sync','Req 10'),
  ('pen-test','Req 11'),('vuln-scanning','Req 11'),('resilience-testing','Req 11'),
  ('security-policies','Req 12'),('policy-acknowledgement','Req 12'),('security-training','Req 12'),('risk-assessment','Req 12')
) as x(mkey, code)
join public.measures m on m.key = x.mkey
join public.frameworks f on f.slug = 'pci-dss'
join public.controls c on c.framework_id = f.id and c.code = x.code
on conflict do nothing;
