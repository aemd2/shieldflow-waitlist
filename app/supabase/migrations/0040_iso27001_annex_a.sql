-- 0040_iso27001_annex_a.sql
--
-- Completes ISO/IEC 27001:2022 Annex A — the remaining 78 controls, bringing the
-- framework from 15 to the full 93 across its four themes (A.5 Organizational 37,
-- A.6 People 8, A.7 Physical 14, A.8 Technological 34).
--
-- These rows carry a short description but no long-form guidance, unlike the
-- SOC 2 set. That is deliberate and is the payoff of the measure layer: the "how
-- do I actually satisfy this" content lives once on the measure, shared by every
-- framework that points at it, instead of being rewritten 93 times. The control
-- page surfaces the linked measures and their guidance.
--
-- Annex A control TITLES are short factual identifiers; ISO's own control text is
-- copyright and is not reproduced. Descriptions here are written for ShieldFlow.

insert into public.controls (framework_id, code, title, description, category, criticality)
select f.id, v.code, v.title, v.description, v.category, v.criticality
from public.frameworks f
cross join (values
  -- ============================== A.5 Organizational (33 remaining of 37)
  ('A.5.2','Information Security Roles and Responsibilities','Security roles defined and allocated.','Organizational','important'),
  ('A.5.3','Segregation of Duties','Conflicting duties and responsibilities separated.','Organizational','important'),
  ('A.5.4','Management Responsibilities','Management requires all personnel to apply security per policy.','Organizational','important'),
  ('A.5.5','Contact with Authorities','Maintained contact with relevant authorities.','Organizational','operational'),
  ('A.5.6','Contact with Special Interest Groups','Maintained contact with security interest groups.','Organizational','operational'),
  ('A.5.8','Information Security in Project Management','Security integrated into project management.','Organizational','important'),
  ('A.5.9','Inventory of Information and Other Associated Assets','Assets inventoried with owners.','Organizational','core'),
  ('A.5.10','Acceptable Use of Information and Other Associated Assets','Rules for acceptable use documented and applied.','Organizational','important'),
  ('A.5.11','Return of Assets','Personnel return assets on termination.','Organizational','important'),
  ('A.5.12','Classification of Information','Information classified by sensitivity.','Organizational','core'),
  ('A.5.13','Labelling of Information','Labelling procedures applied per the classification scheme.','Organizational','operational'),
  ('A.5.14','Information Transfer','Rules and agreements for transferring information.','Organizational','important'),
  ('A.5.16','Identity Management','Full lifecycle management of identities.','Organizational','core'),
  ('A.5.17','Authentication Information','Allocation and management of authentication information.','Organizational','core'),
  ('A.5.18','Access Rights','Access rights provisioned, reviewed and removed.','Organizational','core'),
  ('A.5.19','Information Security in Supplier Relationships','Managing security risk in supplier use.','Organizational','core'),
  ('A.5.20','Addressing Information Security within Supplier Agreements','Security requirements agreed with each supplier.','Organizational','core'),
  ('A.5.21','Managing Information Security in the ICT Supply Chain','Managing risk in the ICT supply chain.','Organizational','important'),
  ('A.5.22','Monitoring, Review and Change Management of Supplier Services','Supplier service delivery monitored and reviewed.','Organizational','important'),
  ('A.5.24','Information Security Incident Management Planning and Preparation','Incident management planned and prepared.','Organizational','core'),
  ('A.5.25','Assessment and Decision on Information Security Events','Events assessed and classified.','Organizational','important'),
  ('A.5.26','Response to Information Security Incidents','Incidents responded to per documented procedure.','Organizational','core'),
  ('A.5.27','Learning from Information Security Incidents','Knowledge from incidents used to strengthen controls.','Organizational','important'),
  ('A.5.28','Collection of Evidence','Procedures for identifying and preserving evidence.','Organizational','important'),
  ('A.5.29','Information Security During Disruption','Security maintained during disruption.','Organizational','important'),
  ('A.5.30','ICT Readiness for Business Continuity','ICT readiness planned and tested against continuity objectives.','Organizational','core'),
  ('A.5.31','Legal, Statutory, Regulatory and Contractual Requirements','Applicable requirements identified and met.','Organizational','important'),
  ('A.5.32','Intellectual Property Rights','Procedures to protect intellectual property.','Organizational','operational'),
  ('A.5.33','Protection of Records','Records protected from loss, falsification and unauthorised access.','Organizational','important'),
  ('A.5.34','Privacy and Protection of PII','Privacy requirements identified and met.','Organizational','important'),
  ('A.5.35','Independent Review of Information Security','Security approach independently reviewed at planned intervals.','Organizational','important'),
  ('A.5.36','Compliance with Policies, Rules and Standards','Compliance with internal policy regularly reviewed.','Organizational','important'),
  ('A.5.37','Documented Operating Procedures','Operating procedures documented and available.','Organizational','operational'),

  -- ============================== A.6 People (7 remaining of 8)
  ('A.6.1','Screening','Background verification before employment.','People','important'),
  ('A.6.2','Terms and Conditions of Employment','Security responsibilities stated in employment terms.','People','important'),
  ('A.6.4','Disciplinary Process','A formalised process for security policy violations.','People','operational'),
  ('A.6.5','Responsibilities After Termination or Change of Employment','Obligations that survive employment.','People','important'),
  ('A.6.6','Confidentiality or Non-Disclosure Agreements','NDAs identified, documented and reviewed.','People','important'),
  ('A.6.7','Remote Working','Security measures for working off-site.','People','important'),
  ('A.6.8','Information Security Event Reporting','A route for personnel to report events promptly.','People','core'),

  -- ============================== A.7 Physical (13 remaining of 14)
  ('A.7.2','Physical Entry','Entry controls protecting secure areas.','Physical','operational'),
  ('A.7.3','Securing Offices, Rooms and Facilities','Physical security designed and applied.','Physical','operational'),
  ('A.7.4','Physical Security Monitoring','Premises monitored for unauthorised access.','Physical','operational'),
  ('A.7.5','Protecting Against Physical and Environmental Threats','Protection against environmental threats.','Physical','operational'),
  ('A.7.6','Working in Secure Areas','Measures for working in secure areas.','Physical','operational'),
  ('A.7.7','Clear Desk and Clear Screen','Clear desk and clear screen rules.','Physical','operational'),
  ('A.7.8','Equipment Siting and Protection','Equipment sited and protected securely.','Physical','operational'),
  ('A.7.9','Security of Assets Off-Premises','Off-site assets protected.','Physical','important'),
  ('A.7.10','Storage Media','Media managed through its lifecycle.','Physical','important'),
  ('A.7.11','Supporting Utilities','Protection from power and utility failure.','Physical','operational'),
  ('A.7.12','Cabling Security','Cabling protected from interception and damage.','Physical','operational'),
  ('A.7.13','Equipment Maintenance','Equipment correctly maintained.','Physical','operational'),
  ('A.7.14','Secure Disposal or Re-Use of Equipment','Equipment verified before disposal or reuse.','Physical','important'),

  -- ============================== A.8 Technological (25 remaining of 34)
  ('A.8.2','Privileged Access Rights','Privileged access restricted and managed.','Technological','core'),
  ('A.8.3','Information Access Restriction','Access restricted per the access control policy.','Technological','core'),
  ('A.8.4','Access to Source Code','Read and write access to source code managed.','Technological','core'),
  ('A.8.6','Capacity Management','Resource use monitored and adjusted to capacity needs.','Technological','important'),
  ('A.8.7','Protection Against Malware','Malware protection implemented and supported by awareness.','Technological','core'),
  ('A.8.10','Information Deletion','Information deleted when no longer required.','Technological','important'),
  ('A.8.11','Data Masking','Data masking used per policy and applicable law.','Technological','operational'),
  ('A.8.12','Data Leakage Prevention','Measures applied to systems handling sensitive information.','Technological','important'),
  ('A.8.14','Redundancy of Information Processing Facilities','Facilities implemented with sufficient redundancy.','Technological','important'),
  ('A.8.17','Clock Synchronisation','Clocks synchronised to approved time sources.','Technological','operational'),
  ('A.8.18','Use of Privileged Utility Programs','Utility programs capable of overriding controls restricted.','Technological','important'),
  ('A.8.19','Installation of Software on Operational Systems','Software installation on production systems controlled.','Technological','core'),
  ('A.8.20','Networks Security','Networks secured, managed and controlled.','Technological','core'),
  ('A.8.21','Security of Network Services','Security mechanisms and service levels identified for network services.','Technological','important'),
  ('A.8.22','Segregation of Networks','Networks segregated by trust level.','Technological','important'),
  ('A.8.23','Web Filtering','Access to external websites managed.','Technological','operational'),
  ('A.8.25','Secure Development Life Cycle','Rules for secure development established and applied.','Technological','core'),
  ('A.8.26','Application Security Requirements','Security requirements identified for applications.','Technological','core'),
  ('A.8.27','Secure System Architecture and Engineering Principles','Secure engineering principles established and applied.','Technological','important'),
  ('A.8.29','Security Testing in Development and Acceptance','Security testing defined and implemented in the lifecycle.','Technological','core'),
  ('A.8.30','Outsourced Development','Outsourced development directed and monitored.','Technological','important'),
  ('A.8.31','Separation of Development, Test and Production Environments','Environments separated and secured.','Technological','core'),
  ('A.8.32','Change Management','Changes subject to change management procedures.','Technological','core'),
  ('A.8.33','Test Information','Test information selected, protected and managed.','Technological','important'),
  ('A.8.34','Protection of Information Systems During Audit Testing','Audit tests planned to minimise disruption.','Technological','operational')
) as v(code, title, description, category, criticality)
where f.slug = 'iso27001'
  and not exists (select 1 from public.controls c where c.framework_id = f.id and c.code = v.code);

-- --------------------------------------------------------------- crosswalk
-- Note how much of Annex A lands on measures that already existed for SOC 2 and
-- the EU frameworks. Vanta puts SOC 2 / ISO 27001 overlap at roughly 80%; this
-- is what that looks like in a schema.
insert into public.measure_controls (measure_id, control_id)
select m.id, c.id
from (values
  ('security-policies','A.5.1'),('security-policies','A.5.37'),('security-policies','A.5.10'),
  ('job-descriptions','A.5.2'),('job-descriptions','A.6.2'),
  ('fraud-risk','A.5.3'),
  ('security-leadership','A.5.4'),('management-training','A.5.4'),
  ('regulatory-reporting','A.5.5'),
  ('effectiveness-review','A.5.6'),
  ('sdlc','A.5.8'),('change-risk-review','A.5.8'),
  ('asset-inventory','A.5.9'),('data-inventory','A.5.9'),
  ('offboarding-checklist','A.5.11'),('offboarding-checklist','A.6.5'),
  ('data-inventory','A.5.12'),('data-inventory','A.5.13'),
  ('encrypt-in-transit','A.5.14'),
  ('sso','A.5.16'),('access-request','A.5.16'),
  ('password-manager','A.5.17'),('mfa','A.5.17'),
  ('access-reviews','A.5.18'),('least-privilege','A.5.18'),
  ('vendor-reviews','A.5.19'),('vendor-inventory','A.5.19'),
  ('vendor-contracts','A.5.20'),
  ('ict-register','A.5.21'),('sbom','A.5.21'),
  ('vendor-reviews','A.5.22'),
  ('incident-response-plan','A.5.24'),('incident-log','A.5.25'),
  ('incident-response-plan','A.5.26'),('post-incident-review','A.5.27'),
  ('incident-log','A.5.28'),('centralised-logging','A.5.28'),
  ('crisis-management','A.5.29'),('dr-plan','A.5.30'),('backups','A.5.30'),
  ('regulatory-reporting','A.5.31'),
  ('security-policies','A.5.32'),
  ('secure-disposal','A.5.33'),('centralised-logging','A.5.33'),
  ('data-inventory','A.5.34'),
  ('pen-test','A.5.35'),('effectiveness-review','A.5.35'),
  ('control-review','A.5.36'),
  ('background-checks','A.6.1'),
  ('accountability','A.6.4'),
  ('vendor-contracts','A.6.6'),
  ('endpoint-protection','A.6.7'),
  ('internal-security-comms','A.6.8'),
  ('physical-access','A.7.2'),('physical-access','A.7.3'),('physical-access','A.7.4'),
  ('physical-access','A.7.5'),('physical-access','A.7.6'),('physical-access','A.7.7'),
  ('physical-access','A.7.8'),('endpoint-protection','A.7.9'),
  ('secure-disposal','A.7.10'),('physical-access','A.7.11'),('physical-access','A.7.12'),
  ('asset-inventory','A.7.13'),('secure-disposal','A.7.14'),
  ('least-privilege','A.8.2'),('access-reviews','A.8.2'),
  ('least-privilege','A.8.3'),
  ('branch-protection','A.8.4'),('code-review','A.8.4'),
  ('availability-monitoring','A.8.6'),
  ('endpoint-protection','A.8.7'),('unauthorised-software','A.8.7'),
  ('secure-disposal','A.8.10'),
  ('separate-environments','A.8.11'),('separate-environments','A.8.33'),
  ('encrypt-at-rest','A.8.12'),
  ('dr-plan','A.8.14'),
  ('clock-sync','A.8.17'),
  ('least-privilege','A.8.18'),('unauthorised-software','A.8.19'),
  ('network-boundary','A.8.20'),('encrypt-in-transit','A.8.21'),('network-boundary','A.8.22'),
  ('unauthorised-software','A.8.23'),
  ('sdlc','A.8.25'),('secure-defaults','A.8.26'),('secure-defaults','A.8.27'),
  ('code-scanning','A.8.29'),('pen-test','A.8.29'),
  ('vendor-reviews','A.8.30'),
  ('separate-environments','A.8.31'),
  ('change-management','A.8.32'),('code-review','A.8.32'),
  ('control-review','A.8.34')
) as x(mkey, code)
join public.measures m on m.key = x.mkey
join public.frameworks f on f.slug = 'iso27001'
join public.controls c on c.framework_id = f.id and c.code = x.code
on conflict do nothing;

-- Crosswalk the 15 pre-existing ISO controls too — they were seeded long before
-- the measure layer existed and had no links.
insert into public.measure_controls (measure_id, control_id)
select m.id, c.id
from (values
  ('security-policies','A.5.1'),
  ('vuln-scanning','A.5.7'),
  ('least-privilege','A.5.15'),('access-reviews','A.5.15'),
  ('vendor-reviews','A.5.23'),
  ('security-training','A.6.3'),
  ('physical-access','A.7.1'),
  ('endpoint-protection','A.8.1'),
  ('mfa','A.8.5'),('sso','A.8.5'),
  ('patching','A.8.8'),('vuln-scanning','A.8.8'),
  ('secure-defaults','A.8.9'),('change-management','A.8.9'),
  ('backups','A.8.13'),
  ('centralised-logging','A.8.15'),
  ('alerting','A.8.16'),
  ('encrypt-in-transit','A.8.24'),('encrypt-at-rest','A.8.24'),
  ('code-review','A.8.28'),('code-scanning','A.8.28')
) as x(mkey, code)
join public.measures m on m.key = x.mkey
join public.frameworks f on f.slug = 'iso27001'
join public.controls c on c.framework_id = f.id and c.code = x.code
on conflict do nothing;

-- New controls in an existing framework need status rows for companies that
-- already selected it, or getControlsWithStatus (which reads FROM control_status)
-- will not show them at all. Same backfill as migration 0035.
insert into public.control_status (company_id, control_id, status)
select cf.company_id, c.id, 'not_started'
from public.company_frameworks cf
join public.controls c on c.framework_id = cf.framework_id
where not exists (
  select 1 from public.control_status cs
  where cs.company_id = cf.company_id and cs.control_id = c.id
);
