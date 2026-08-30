-- 0042_hipaa_implementation_specs.sql
--
-- Expands HIPAA from the 16 Security Rule STANDARDS to full implementation-
-- specification depth: 45 more rows covering 45 CFR 164.308 (administrative),
-- 164.310 (physical), 164.312 (technical), 164.314 (organizational) and 164.316
-- (policies, procedures and documentation).
--
-- HIPAA distinguishes Required from Addressable specifications, and that
-- distinction is load-bearing — "addressable" does not mean optional, it means
-- you must implement it or document why it is not reasonable and appropriate and
-- what you did instead. Each description states which it is, and criticality is
-- tiered accordingly: Required specifications supporting core safeguards are
-- 'core', Addressable ones are 'important' or 'operational'.
--
-- Codes follow the CFR's own numbering so an auditor can trace them directly.

insert into public.controls (framework_id, code, title, description, category, criticality)
select f.id, v.code, v.title, v.description, v.category, v.criticality
from public.frameworks f
cross join (values
  -- ===================== 164.308 Administrative Safeguards
  ('164.308(a)(1)(ii)(A)','Risk Analysis','Required. Accurate and thorough assessment of risks to ePHI confidentiality, integrity and availability.','Administrative','core'),
  ('164.308(a)(1)(ii)(B)','Risk Management','Required. Security measures sufficient to reduce risks to a reasonable and appropriate level.','Administrative','core'),
  ('164.308(a)(1)(ii)(C)','Sanction Policy','Required. Sanctions applied to workforce members who fail to comply with security policies.','Administrative','important'),
  ('164.308(a)(1)(ii)(D)','Information System Activity Review','Required. Regular review of audit logs, access reports and incident tracking.','Administrative','core'),
  ('164.308(a)(3)(ii)(A)','Authorization and Supervision','Addressable. Authorisation and supervision of workforce members who work with ePHI.','Administrative','important'),
  ('164.308(a)(3)(ii)(B)','Workforce Clearance Procedure','Addressable. Procedures to determine that workforce access to ePHI is appropriate.','Administrative','important'),
  ('164.308(a)(3)(ii)(C)','Termination Procedures','Addressable. Terminating access to ePHI when employment ends.','Administrative','core'),
  ('164.308(a)(4)(ii)(A)','Isolating Clearinghouse Functions','Required where applicable. Separating clearinghouse functions from the larger organisation.','Administrative','operational'),
  ('164.308(a)(4)(ii)(B)','Access Authorization','Addressable. Granting access to ePHI through a documented authorisation process.','Administrative','core'),
  ('164.308(a)(4)(ii)(C)','Access Establishment and Modification','Addressable. Establishing, documenting, reviewing and modifying access rights.','Administrative','core'),
  ('164.308(a)(5)(ii)(A)','Security Reminders','Addressable. Periodic security updates to the workforce.','Administrative','operational'),
  ('164.308(a)(5)(ii)(B)','Protection from Malicious Software','Addressable. Guarding against, detecting and reporting malicious software.','Administrative','core'),
  ('164.308(a)(5)(ii)(C)','Log-in Monitoring','Addressable. Monitoring log-in attempts and reporting discrepancies.','Administrative','important'),
  ('164.308(a)(5)(ii)(D)','Password Management','Addressable. Creating, changing and safeguarding passwords.','Administrative','important'),
  ('164.308(a)(6)(ii)','Response and Reporting','Required. Identify and respond to suspected or known incidents, mitigate harm, and document outcomes.','Administrative','core'),
  ('164.308(a)(7)(ii)(A)','Data Backup Plan','Required. Retrievable exact copies of ePHI.','Administrative','core'),
  ('164.308(a)(7)(ii)(B)','Disaster Recovery Plan','Required. Procedures to restore any loss of data.','Administrative','core'),
  ('164.308(a)(7)(ii)(C)','Emergency Mode Operation Plan','Required. Continuing critical business processes while operating in emergency mode.','Administrative','important'),
  ('164.308(a)(7)(ii)(D)','Testing and Revision Procedures','Addressable. Periodic testing and revision of contingency plans.','Administrative','important'),
  ('164.308(a)(7)(ii)(E)','Applications and Data Criticality Analysis','Addressable. Assessing the criticality of specific applications and data.','Administrative','important'),
  ('164.308(b)(1)','Business Associate Contracts','Standard. Obtain satisfactory assurances that business associates safeguard ePHI.','Administrative','core'),
  ('164.308(b)(3)','Written Contract or Other Arrangement','Required. Document the assurances through a written contract meeting 164.314(a).','Administrative','core'),

  -- ===================== 164.310 Physical Safeguards
  ('164.310(a)(2)(i)','Contingency Operations','Addressable. Facility access procedures supporting data restoration under emergency.','Physical','operational'),
  ('164.310(a)(2)(ii)','Facility Security Plan','Addressable. Safeguarding the facility and equipment from unauthorised access.','Physical','operational'),
  ('164.310(a)(2)(iii)','Access Control and Validation Procedures','Addressable. Validating a person''s access to facilities based on role.','Physical','operational'),
  ('164.310(a)(2)(iv)','Maintenance Records','Addressable. Documenting repairs and modifications to physical security components.','Physical','operational'),
  ('164.310(c)','Workstation Security','Required. Physical safeguards for workstations that access ePHI.','Physical','important'),
  ('164.310(d)(2)(i)','Media Disposal','Required. Disposal of ePHI and the hardware or media it is stored on.','Physical','core'),
  ('164.310(d)(2)(ii)','Media Re-Use','Required. Removing ePHI from media before it is made available for re-use.','Physical','core'),
  ('164.310(d)(2)(iii)','Media Accountability','Addressable. Recording movements of hardware and media and the person responsible.','Physical','important'),
  ('164.310(d)(2)(iv)','Data Backup and Storage','Addressable. Retrievable exact copy of ePHI before equipment is moved.','Physical','important'),

  -- ===================== 164.312 Technical Safeguards
  ('164.312(a)(2)(i)','Unique User Identification','Required. A unique name or number for identifying and tracking user identity.','Technical','core'),
  ('164.312(a)(2)(ii)','Emergency Access Procedure','Required. Obtaining necessary ePHI during an emergency.','Technical','important'),
  ('164.312(a)(2)(iii)','Automatic Logoff','Addressable. Terminating an electronic session after a period of inactivity.','Technical','important'),
  ('164.312(a)(2)(iv)','Encryption and Decryption','Addressable. Encrypting and decrypting ePHI at rest.','Technical','core'),
  ('164.312(c)(2)','Mechanism to Authenticate ePHI','Addressable. Confirming ePHI has not been improperly altered or destroyed.','Technical','important'),
  ('164.312(e)(2)(i)','Transmission Integrity Controls','Addressable. Ensuring transmitted ePHI is not improperly modified.','Technical','important'),
  ('164.312(e)(2)(ii)','Transmission Encryption','Addressable. Encrypting ePHI whenever deemed appropriate in transit.','Technical','core'),

  -- ===================== 164.314 Organizational Requirements
  ('164.314(a)(1)','Business Associate Contract Requirements','Standard. Required contract provisions between covered entities and business associates.','Organizational','core'),
  ('164.314(b)(1)','Group Health Plan Requirements','Standard. Plan documents requiring sponsors to safeguard ePHI.','Organizational','operational'),

  -- ===================== 164.316 Policies, Procedures and Documentation
  ('164.316(a)','Policies and Procedures','Standard. Implement reasonable and appropriate policies and procedures to comply with the Rule.','Documentation','core'),
  ('164.316(b)(1)','Documentation','Standard. Maintain policies, procedures, actions, activities and assessments in writing.','Documentation','core'),
  ('164.316(b)(2)(i)','Documentation Time Limit','Required. Retain documentation for six years from creation or last effective date.','Documentation','important'),
  ('164.316(b)(2)(ii)','Documentation Availability','Required. Make documentation available to those responsible for implementing it.','Documentation','important'),
  ('164.316(b)(2)(iii)','Documentation Updates','Required. Review and update documentation in response to environmental or operational change.','Documentation','important')
) as v(code, title, description, category, criticality)
where f.slug = 'hipaa'
  and not exists (select 1 from public.controls c where c.framework_id = f.id and c.code = v.code);

insert into public.measure_controls (measure_id, control_id)
select m.id, c.id
from (values
  ('risk-assessment','164.308(a)(1)(ii)(A)'),('data-inventory','164.308(a)(1)(ii)(A)'),
  ('risk-treatment','164.308(a)(1)(ii)(B)'),
  ('accountability','164.308(a)(1)(ii)(C)'),
  ('centralised-logging','164.308(a)(1)(ii)(D)'),('alerting','164.308(a)(1)(ii)(D)'),('access-reviews','164.308(a)(1)(ii)(D)'),
  ('access-request','164.308(a)(3)(ii)(A)'),('least-privilege','164.308(a)(3)(ii)(A)'),
  ('background-checks','164.308(a)(3)(ii)(B)'),('onboarding-checklist','164.308(a)(3)(ii)(B)'),
  ('offboarding-checklist','164.308(a)(3)(ii)(C)'),
  ('separate-environments','164.308(a)(4)(ii)(A)'),
  ('access-request','164.308(a)(4)(ii)(B)'),
  ('access-reviews','164.308(a)(4)(ii)(C)'),('least-privilege','164.308(a)(4)(ii)(C)'),
  ('internal-security-comms','164.308(a)(5)(ii)(A)'),('security-training','164.308(a)(5)(ii)(A)'),
  ('endpoint-protection','164.308(a)(5)(ii)(B)'),('unauthorised-software','164.308(a)(5)(ii)(B)'),
  ('alerting','164.308(a)(5)(ii)(C)'),('centralised-logging','164.308(a)(5)(ii)(C)'),
  ('password-manager','164.308(a)(5)(ii)(D)'),('mfa','164.308(a)(5)(ii)(D)'),
  ('incident-response-plan','164.308(a)(6)(ii)'),('incident-log','164.308(a)(6)(ii)'),('regulatory-reporting','164.308(a)(6)(ii)'),
  ('backups','164.308(a)(7)(ii)(A)'),
  ('dr-plan','164.308(a)(7)(ii)(B)'),
  ('crisis-management','164.308(a)(7)(ii)(C)'),
  ('resilience-testing','164.308(a)(7)(ii)(D)'),('dr-plan','164.308(a)(7)(ii)(D)'),
  ('asset-inventory','164.308(a)(7)(ii)(E)'),('data-inventory','164.308(a)(7)(ii)(E)'),
  ('vendor-reviews','164.308(b)(1)'),('vendor-inventory','164.308(b)(1)'),
  ('vendor-contracts','164.308(b)(3)'),
  ('dr-plan','164.310(a)(2)(i)'),
  ('physical-access','164.310(a)(2)(ii)'),('physical-access','164.310(a)(2)(iii)'),
  ('asset-inventory','164.310(a)(2)(iv)'),
  ('endpoint-protection','164.310(c)'),('physical-access','164.310(c)'),
  ('secure-disposal','164.310(d)(2)(i)'),('secure-disposal','164.310(d)(2)(ii)'),
  ('asset-inventory','164.310(d)(2)(iii)'),
  ('backups','164.310(d)(2)(iv)'),
  ('sso','164.312(a)(2)(i)'),('access-request','164.312(a)(2)(i)'),
  ('incident-response-plan','164.312(a)(2)(ii)'),
  ('endpoint-protection','164.312(a)(2)(iii)'),
  ('encrypt-at-rest','164.312(a)(2)(iv)'),
  ('backups','164.312(c)(2)'),('centralised-logging','164.312(c)(2)'),
  ('encrypt-in-transit','164.312(e)(2)(i)'),('encrypt-in-transit','164.312(e)(2)(ii)'),
  ('vendor-contracts','164.314(a)(1)'),
  ('vendor-contracts','164.314(b)(1)'),
  ('security-policies','164.316(a)'),
  ('security-policies','164.316(b)(1)'),('policy-acknowledgement','164.316(b)(1)'),
  ('secure-disposal','164.316(b)(2)(i)'),
  ('internal-security-comms','164.316(b)(2)(ii)'),('policy-acknowledgement','164.316(b)(2)(ii)'),
  ('control-review','164.316(b)(2)(iii)'),('change-risk-review','164.316(b)(2)(iii)')
) as x(mkey, code)
join public.measures m on m.key = x.mkey
join public.frameworks f on f.slug = 'hipaa'
join public.controls c on c.framework_id = f.id and c.code = x.code
on conflict do nothing;

insert into public.control_status (company_id, control_id, status)
select cf.company_id, c.id, 'not_started'
from public.company_frameworks cf
join public.controls c on c.framework_id = cf.framework_id
where not exists (
  select 1 from public.control_status cs
  where cs.company_id = cf.company_id and cs.control_id = c.id
);
