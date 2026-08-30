-- 0039_dora_cra.sql
--
-- DORA (Regulation (EU) 2022/2554) and the Cyber Resilience Act
-- (Regulation (EU) 2024/2847).
--
-- DORA applies to financial entities and — through Chapter V — to the ICT
-- third-party providers serving them, which is how a SaaS vendor with no
-- regulatory status of its own ends up answering DORA questions.
--
-- The CRA applies to every manufacturer of a product with digital elements sold
-- into the EU, software included. Its vulnerability and incident reporting
-- obligations start 11 September 2026; the main obligations follow on
-- 11 December 2027. It is the least covered of the three in the SMB
-- compliance-automation segment — no equivalent in Vanta, Drata, Secureframe,
-- Sprinto, Comp AI, Probo or CISO Assistant.
--
-- Guidance here is intentionally short. With the measure layer in place the
-- "how do I actually do this" content lives on the measure, which several
-- frameworks share; a framework control only has to name the requirement and
-- point at the measures that satisfy it. That is what keeps adding a framework
-- cheap.

-- ==================================================================== DORA
insert into public.frameworks (slug, name, description) values
('dora','DORA','EU Regulation 2022/2554 on digital operational resilience for the financial sector.')
on conflict (slug) do nothing;

insert into public.controls (framework_id, code, title, description, category, criticality, guidance, suggested_evidence)
select f.id, v.code, v.title, v.description, v.category, v.criticality, v.guidance, v.evidence
from public.frameworks f
cross join (values
  ('Art.5','Governance and Control Framework','The management body defines, approves and oversees the ICT risk management framework.','ICT risk management','core',
   'Management owns ICT risk under DORA and cannot delegate accountability. Record their approval and their periodic review.',
   E'Management approval of the ICT risk framework\nDefined ICT governance roles\nMinutes of periodic review'),
  ('Art.6','ICT Risk Management Framework','A documented ICT risk management framework, reviewed at least annually.','ICT risk management','core',
   'One documented framework covering strategy, policies, procedures and tools for ICT risk, reviewed annually and after major incidents.',
   E'ICT risk management framework document\nAnnual review record\nRisk assessment results'),
  ('Art.8','Identification','Identify and classify ICT-supported business functions, assets and dependencies.','ICT risk management','core',
   'Know which business functions depend on which systems and providers, and which of those are critical or important.',
   E'Inventory of ICT assets and dependencies\nMapping of business functions to systems\nCriticality classification'),
  ('Art.9.1','Protection and Prevention','Policies and tools to protect ICT systems from damage and unauthorised access.','Protection','core',
   'Baseline protective controls — network security, hardening, malware defence, secure configuration.',
   E'Security architecture documentation\nHardening standards\nNetwork protection configuration'),
  ('Art.9.2','Access and Cryptography','Strong authentication, access management and encryption of data at rest and in transit.','Protection','core',
   'MFA, least privilege, and encryption everywhere, with key management documented.',
   E'MFA and access control evidence\nEncryption configuration\nKey management procedure'),
  ('Art.10','Detection','Mechanisms to promptly detect anomalous activity and ICT incidents.','Detection','core',
   'Logging, monitoring and alerting sufficient to notice an incident promptly, with defined alert thresholds.',
   E'Monitoring and alerting configuration\nLog retention evidence\nAlert thresholds and escalation'),
  ('Art.11','Response and Recovery','An ICT business continuity policy with response and recovery plans.','Response and recovery','core',
   'Continuity and recovery plans covering ICT disruption, with stated targets and tested at least annually.',
   E'ICT business continuity policy\nRecovery plans with RTO/RPO\nAnnual test results'),
  ('Art.12','Backup and Restoration','Backup policies and restoration procedures, tested periodically.','Response and recovery','core',
   'Backups separated from source systems, encrypted, and restored in a test at least annually.',
   E'Backup policy and configuration\nDocumented restore test\nEvidence backups are isolated'),
  ('Art.13','Learning and Evolving','Post-incident reviews feeding back into the risk framework.','Response and recovery','important',
   'Gather lessons from incidents and tests, and show the framework changed as a result.',
   E'Post-incident reviews\nLessons-learned register\nEvidence of resulting framework changes'),
  ('Art.14','Communication','Crisis communication plans for staff, clients and authorities.','Response and recovery','important',
   'Named spokespeople and pre-agreed routes for informing clients and regulators during a disruption.',
   E'Crisis communication plan\nContact lists\nEvidence of communication during an exercise'),
  ('Art.17','ICT Incident Management','A process to detect, manage and notify ICT-related incidents.','Incident management','core',
   'A single documented process covering detection through closure, with roles and severity levels.',
   E'Incident management procedure\nIncident register\nRole assignments'),
  ('Art.18','Incident Classification','Classify incidents by criteria including clients affected, duration and data losses.','Incident management','core',
   'Apply DORA''s classification criteria consistently so the major-incident threshold is judged the same way each time.',
   E'Classification criteria and thresholds\nClassified incident records\nEvidence criteria are applied consistently'),
  ('Art.19','Major Incident Reporting','Initial, intermediate and final reports to the competent authority for major incidents.','Incident management','core',
   'Know your competent authority and the three-stage reporting clock, and hold templates ready.',
   E'Reporting procedure with deadlines\nAuthority contact details\nSubmitted reports where applicable'),
  ('Art.24','Resilience Testing Programme','A digital operational resilience testing programme, reviewed annually.','Resilience testing','core',
   'A documented programme covering test types, frequency and scope — not ad-hoc testing.',
   E'Testing programme document\nAnnual test schedule\nGovernance sign-off'),
  ('Art.25','Testing of ICT Tools and Systems','Vulnerability assessments, scenario-based tests and penetration testing.','Resilience testing','core',
   'Run the test types proportionate to your size and risk, and remediate what they find.',
   E'Vulnerability assessment results\nPenetration test report\nRemediation tracking'),
  ('Art.28','ICT Third-Party Risk Principles','Manage ICT third-party risk as an integral part of the risk framework.','Third-party risk','core',
   'Third-party risk is not a separate exercise under DORA — it sits inside the ICT risk framework.',
   E'Third-party risk policy\nRisk assessments per provider\nIntegration with the ICT risk framework'),
  ('Art.29','Register of Information','Maintain a register of all contractual arrangements for ICT services.','Third-party risk','core',
   'The register is a formal DORA deliverable: every ICT contract, which support critical functions, and where services are provided from.',
   E'Register of Information\nIdentification of critical-function providers\nConcentration risk assessment'),
  ('Art.30','Contractual Provisions','Key contractual provisions with ICT third-party service providers.','Third-party risk','core',
   'Contracts must cover service levels, data location, access and audit rights, subcontracting, and exit.',
   E'ICT contracts with required clauses\nExit and termination plans\nAudit and access rights evidence')
) as v(code, title, description, category, criticality, guidance, evidence)
where f.slug = 'dora'
  and not exists (select 1 from public.controls c where c.framework_id = f.id and c.code = v.code);

insert into public.measure_controls (measure_id, control_id)
select m.id, c.id
from (values
  ('security-leadership','Art.5'),('management-training','Art.5'),
  ('risk-assessment','Art.6'),('security-policies','Art.6'),('effectiveness-review','Art.6'),
  ('asset-inventory','Art.8'),('data-inventory','Art.8'),
  ('network-boundary','Art.9.1'),('endpoint-protection','Art.9.1'),('unauthorised-software','Art.9.1'),('separate-environments','Art.9.1'),
  ('mfa','Art.9.2'),('least-privilege','Art.9.2'),('encrypt-in-transit','Art.9.2'),('encrypt-at-rest','Art.9.2'),
  ('centralised-logging','Art.10'),('alerting','Art.10'),('availability-monitoring','Art.10'),
  ('dr-plan','Art.11'),('crisis-management','Art.11'),
  ('backups','Art.12'),
  ('post-incident-review','Art.13'),('effectiveness-review','Art.13'),
  ('crisis-management','Art.14'),('breach-notification','Art.14'),
  ('incident-response-plan','Art.17'),('incident-log','Art.17'),
  ('incident-log','Art.18'),
  ('regulatory-reporting','Art.19'),
  ('resilience-testing','Art.24'),
  ('pen-test','Art.25'),('vuln-scanning','Art.25'),('resilience-testing','Art.25'),
  ('vendor-reviews','Art.28'),('vendor-inventory','Art.28'),
  ('ict-register','Art.29'),
  ('vendor-contracts','Art.30')
) as x(mkey, code)
join public.measures m on m.key = x.mkey
join public.frameworks f on f.slug = 'dora'
join public.controls c on c.framework_id = f.id and c.code = x.code
on conflict do nothing;

-- ===================================================================== CRA
insert into public.frameworks (slug, name, description) values
('cra','Cyber Resilience Act','EU Regulation 2024/2847 on horizontal cybersecurity requirements for products with digital elements.')
on conflict (slug) do nothing;

insert into public.controls (framework_id, code, title, description, category, criticality, guidance, suggested_evidence)
select f.id, v.code, v.title, v.description, v.category, v.criticality, v.guidance, v.evidence
from public.frameworks f
cross join (values
  ('I.1.1','Secure by Design','Products are designed, developed and produced to ensure an appropriate level of cybersecurity.','Product requirements','core',
   'Security considered from design onward, with the reasoning recorded — this is what a conformity assessment looks for.',
   E'Secure design documentation\nThreat model\nSecurity requirements in the development process'),
  ('I.1.2','No Known Exploitable Vulnerabilities','Products are made available without known exploitable vulnerabilities.','Product requirements','core',
   'Scan and review before release; do not ship a version with a known exploitable flaw.',
   E'Pre-release vulnerability scan results\nRelease checklist including security sign-off\nRecord of known issues and their disposition'),
  ('I.1.3','Secure Default Configuration','Products are delivered with a secure by default configuration, resettable to that state.','Product requirements','core',
   'No default passwords, minimum necessary features enabled, and a documented reset to a secure state.',
   E'Default configuration documentation\nEvidence of no default credentials\nFactory reset procedure'),
  ('I.1.4','Protection from Unauthorised Access','Protect against unauthorised access through appropriate control mechanisms.','Product requirements','core',
   'Authentication, authorisation and identity management in the product itself, not just around it.',
   E'Authentication and authorisation design\nAccess control testing\nAudit of privileged product functions'),
  ('I.1.5','Confidentiality and Integrity','Protect the confidentiality and integrity of stored, transmitted and processed data.','Product requirements','core',
   'Encrypt data in transit and at rest, and protect against unauthorised modification.',
   E'Encryption configuration\nIntegrity protection mechanisms\nData protection design documentation'),
  ('I.1.6','Minimise Attack Surface','Limit attack surfaces, including external interfaces.','Product requirements','important',
   'Ship only what is needed: close unused ports, disable unused features, document the exposed interfaces.',
   E'Interface and port inventory\nEvidence unused features are disabled\nAttack surface review'),
  ('I.1.7','Limit Incident Impact','Reduce the impact of an incident using exploitation mitigation mechanisms.','Product requirements','important',
   'Segmentation, sandboxing, least privilege inside the product, and modern exploit mitigations.',
   E'Architecture showing segmentation or isolation\nExploit mitigation settings in the build\nBlast radius analysis'),
  ('I.1.8','Security Logging and Monitoring','Record and monitor relevant internal activity, including access to and modification of data.','Product requirements','important',
   'The product should log security-relevant events and let the operator access them.',
   E'Product security logging design\nSample logs\nCustomer-facing audit log capability'),
  ('I.1.9','Secure Updates','Ensure vulnerabilities can be addressed through security updates, including automatic updates where appropriate.','Product requirements','core',
   'A working, secure update mechanism — signed, authenticated, and with a way to notify customers.',
   E'Update mechanism design with signing\nUpdate distribution evidence\nCustomer notification process'),
  ('II.1','Software Bill of Materials','Identify and document components in the product, including an SBOM in a commonly used format.','Vulnerability handling','core',
   'Generate a machine-readable SBOM (CycloneDX or SPDX) covering at least top-level dependencies, and keep it current.',
   E'SBOM per release\nAutomated SBOM generation in the pipeline\nComponent inventory'),
  ('II.2','Address Vulnerabilities Without Delay','Address and remediate vulnerabilities without delay, including by providing security updates.','Vulnerability handling','core',
   'A triage and remediation process with timelines you can evidence.',
   E'Vulnerability handling procedure with SLAs\nRemediation records\nSecurity update history'),
  ('II.3','Regular Security Testing','Apply effective and regular tests and reviews of the security of the product.','Vulnerability handling','core',
   'Recurring testing appropriate to the product — SAST, DAST, dependency scanning, penetration testing.',
   E'Testing schedule and scope\nTest results\nRemediation of findings'),
  ('II.4','Coordinated Vulnerability Disclosure','Put in place and enforce a policy on coordinated vulnerability disclosure.','Vulnerability handling','core',
   'A published policy, a monitored contact point, and evidence you act on what comes in.',
   E'Published disclosure policy\nSecurity contact (e.g. security.txt)\nLog of reports and responses'),
  ('II.5','Publish Information About Fixed Vulnerabilities','Share and publicly disclose information about fixed vulnerabilities.','Vulnerability handling','important',
   'Publish advisories describing the vulnerability, the impact and the fix once an update is available.',
   E'Published security advisories\nRelease notes identifying security fixes\nCVE records where applicable'),
  ('Art.14.1','24-Hour Early Warning','Notify ENISA and the CSIRT within 24 hours of becoming aware of an actively exploited vulnerability or severe incident.','Incident reporting','core',
   'The clock starts at awareness. You need the contact route, the template, and an SBOM current enough to say what is affected.',
   E'Reporting procedure naming the 24-hour trigger\nENISA and CSIRT contact details\nEvidence of any early warnings submitted'),
  ('Art.14.2','72-Hour Notification','Submit a vulnerability or incident notification within 72 hours.','Incident reporting','core',
   'Update the early warning with an assessment of severity, impact and any corrective measures taken.',
   E'Notification template\nSubmitted notifications with timestamps\nImpact assessment method'),
  ('Art.14.3','Final Report','Submit a final report once the vulnerability or incident is resolved.','Incident reporting','important',
   'A final report covering the vulnerability, its impact, and the fix or mitigation applied.',
   E'Final report template\nSubmitted final reports\nRoot cause and remediation records')
) as v(code, title, description, category, criticality, guidance, evidence)
where f.slug = 'cra'
  and not exists (select 1 from public.controls c where c.framework_id = f.id and c.code = v.code);

insert into public.measure_controls (measure_id, control_id)
select m.id, c.id
from (values
  ('secure-defaults','I.1.1'),('sdlc','I.1.1'),
  ('vuln-scanning','I.1.2'),('secure-defaults','I.1.2'),('code-scanning','I.1.2'),
  ('secure-defaults','I.1.3'),
  ('least-privilege','I.1.4'),('mfa','I.1.4'),
  ('encrypt-in-transit','I.1.5'),('encrypt-at-rest','I.1.5'),
  ('network-boundary','I.1.6'),('secure-defaults','I.1.6'),
  ('separate-environments','I.1.7'),('least-privilege','I.1.7'),
  ('centralised-logging','I.1.8'),('alerting','I.1.8'),
  ('security-updates','I.1.9'),('change-management','I.1.9'),
  ('sbom','II.1'),('asset-inventory','II.1'),
  ('patching','II.2'),('vuln-scanning','II.2'),('security-updates','II.2'),
  ('pen-test','II.3'),('code-scanning','II.3'),('vuln-scanning','II.3'),
  ('vuln-disclosure','II.4'),
  ('vuln-disclosure','II.5'),('security-updates','II.5'),
  ('regulatory-reporting','Art.14.1'),('incident-response-plan','Art.14.1'),('sbom','Art.14.1'),
  ('regulatory-reporting','Art.14.2'),('incident-log','Art.14.2'),
  ('regulatory-reporting','Art.14.3'),('post-incident-review','Art.14.3')
) as x(mkey, code)
join public.measures m on m.key = x.mkey
join public.frameworks f on f.slug = 'cra'
join public.controls c on c.framework_id = f.id and c.code = x.code
on conflict do nothing;
