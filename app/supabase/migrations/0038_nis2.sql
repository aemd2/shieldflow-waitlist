-- 0038_nis2.sql
--
-- NIS2 (Directive (EU) 2022/2555), plus the ten new measures the EU frameworks
-- need that the SOC 2 library did not already cover.
--
-- Why NIS2 first: neither Vanta nor Drata has native NIS2 support, the October
-- 2026 deadline is live, and — the part that matters commercially — companies
-- under 50 employees are mostly out of direct scope but land in it anyway
-- through the supply chain. Their regulated customers (banks, hospitals, energy,
-- public sector) are legally required to assess their suppliers, so an
-- out-of-scope SaaS vendor still gets the questionnaire. Direct scope is a legal
-- obligation; indirect scope is a commercial one.
--
-- Structure follows the Directive's own articles: Article 20 (governance),
-- Article 21(2)(a)-(j) (the ten risk-management measures), Article 23 (the
-- reporting clock). Control text is written for ShieldFlow; the Directive itself
-- is public law but the phrasing here is ours.
--
-- Note how few NEW measures this needs: most NIS2 requirements attach to
-- measures that already exist for SOC 2. That is the whole point of the measure
-- layer — the crosswalk grows, the work does not.

-- ------------------------------------------------------- new shared measures
insert into public.measures (key, name, category, importance, summary, guidance, suggested_evidence) values
('management-training','Train the management body on cyber risk','Governance & policy','mandatory',
 'Directors themselves trained on cyber risk, not just the security team.',
 'NIS2 Article 20 makes the management body personally accountable for approving risk measures and requires them to follow training. Record who attended and when — this is a named obligation, not general awareness training.',
 E'Attendance records for management-level cyber training\nManagement approval of the risk-management measures\nBoard or leadership minutes referencing cyber risk'),

('crisis-management','Maintain a crisis management plan','Business continuity','mandatory',
 'Who runs a crisis, how they communicate, and to whom.',
 'Beyond technical recovery: name the crisis lead, the decision thresholds, and the internal and external communication routes. NIS2 lists crisis management separately from business continuity for this reason.',
 E'Crisis management plan with named roles\nCommunication tree and contact list\nEvidence of a crisis exercise'),

('regulatory-reporting','Meet regulatory incident reporting deadlines','Incident response','mandatory',
 'A tested process for hitting statutory notification clocks.',
 'Know which regulator you report to, on what clock, and who is authorised to file. NIS2 requires a 24-hour early warning, a 72-hour notification and a final report within a month; DORA and the CRA run their own clocks. Have the contacts and templates ready before you need them.',
 E'Reporting procedure naming regulator and deadlines\nPre-drafted notification templates\nContact details for the relevant CSIRT or authority\nEvidence of any filings made'),

('effectiveness-review','Assess whether your security measures work','Governance & policy','mandatory',
 'A periodic judgement on effectiveness, not just existence.',
 'NIS2 Article 21(2)(f) asks specifically for policies to assess the effectiveness of your risk-management measures. Testing, metrics and review findings all count — the point is a documented conclusion about whether the measures are working.',
 E'Effectiveness review or internal audit report\nSecurity metrics tracked over time\nManagement conclusions and resulting actions'),

('resilience-testing','Run a resilience testing programme','Infrastructure','mandatory',
 'A planned schedule of tests, not one-off exercises.',
 'DORA requires a documented testing programme covering vulnerability assessment, scenario testing and — for significant entities — threat-led penetration testing. Plan it annually and record results and remediation.',
 E'Testing programme and annual schedule\nTest results by type\nRemediation tracking for findings'),

('ict-register','Maintain a register of ICT third-party arrangements','Vendors','mandatory',
 'A structured register of who provides your ICT services and on what terms.',
 'DORA requires a Register of Information covering every contractual arrangement for ICT services, including which support critical functions and where they are provided from. Concentration risk is assessed from it.',
 E'Register of ICT third-party arrangements\nIdentification of providers supporting critical functions\nConcentration risk assessment'),

('sbom','Produce a software bill of materials','Secure development','mandatory',
 'A machine-readable inventory of the components in your product.',
 'Generate an SBOM (CycloneDX or SPDX) per release and keep it current. Under the CRA you cannot report on an exploited vulnerability within 24 hours if you do not know what is in your product.',
 E'SBOM per release in CycloneDX or SPDX format\nSBOM generation automated in the build pipeline\nProcess for keeping it current'),

('vuln-disclosure','Publish a vulnerability disclosure policy','Secure development','mandatory',
 'A public route for researchers to report a flaw to you.',
 'Publish a coordinated vulnerability disclosure policy with a contact address and expected response times, and honour it. The CRA requires this of every product with digital elements sold into the EU.',
 E'Published vulnerability disclosure policy\nMonitored security contact address (e.g. security.txt)\nRecord of reports received and how they were handled'),

('secure-defaults','Ship secure by design and by default','Secure development','mandatory',
 'Products delivered in a secure configuration, with no known exploitable flaws.',
 'Ship with secure defaults, no default passwords, minimum necessary surface enabled, and no known exploitable vulnerabilities at release. This is the core of the CRA''s essential requirements.',
 E'Secure default configuration documented\nRelease checklist including vulnerability review\nHardening guide for customers'),

('security-updates','Provide timely security updates','Secure development','mandatory',
 'Free security updates for the product''s stated support period.',
 'Define and publish a support period, and ship security updates within it — separately from feature releases, delivered over a secure channel, and free of charge. The CRA makes this an obligation rather than a courtesy.',
 E'Published support period per product version\nSecurity update release history\nSecure update distribution mechanism (signed, authenticated)')
on conflict (key) do nothing;

-- ------------------------------------------------------------- the framework
insert into public.frameworks (slug, name, description) values
('nis2','NIS2','EU Directive 2022/2555 on network and information systems security.')
on conflict (slug) do nothing;

insert into public.controls (framework_id, code, title, description, category, criticality, guidance, suggested_evidence)
select f.id, v.code, v.title, v.description, v.category, v.criticality, v.guidance, v.evidence
from public.frameworks f
cross join (values
  ('Art.20.1','Management Accountability','The management body approves the cybersecurity risk-management measures and oversees their implementation.','Governance','core',
   'Your directors must formally approve the risk-management measures and stay accountable for them. Under NIS2 they can be held personally liable, so record the approval — a decision nobody minuted did not happen.',
   E'Management approval of risk-management measures, minuted\nDefined governance and oversight responsibilities\nEvidence of periodic management review'),
  ('Art.20.2','Management Training','Members of the management body follow training on cybersecurity risk.','Governance','important',
   'Directors themselves must be trained, not only staff. Track attendance and content.',
   E'Attendance records for management cyber training\nTraining content or provider\nRefresher schedule'),
  ('Art.21.2(a)','Risk Analysis and Security Policy','Policies on risk analysis and information system security.','Risk management','core',
   'A documented risk analysis and an approved information security policy covering the systems in scope.',
   E'Risk assessment methodology and results\nApproved information security policy\nEvidence of periodic review'),
  ('Art.21.2(b)','Incident Handling','Procedures for handling security incidents.','Risk management','core',
   'A documented incident handling process covering detection, classification, response, and closure.',
   E'Incident response plan\nIncident register with timelines\nPost-incident reviews'),
  ('Art.21.2(c)','Business Continuity','Business continuity, backup management, disaster recovery and crisis management.','Risk management','core',
   'Backups you have restored from, a recovery plan with targets, and a crisis management plan naming who decides and who communicates.',
   E'Backup configuration and tested restore\nDisaster recovery plan with RTO/RPO\nCrisis management plan and exercise records'),
  ('Art.21.2(d)','Supply Chain Security','Security of the supply chain, including relationships with direct suppliers.','Risk management','core',
   'Assess the security of your direct suppliers, record the assessment, and reflect requirements in contracts. This is also the article your own customers will invoke against you.',
   E'Supplier inventory with risk assessment\nSecurity requirements in supplier contracts\nCompleted supplier reviews'),
  ('Art.21.2(e)','Secure Acquisition and Development','Security in acquisition, development and maintenance, including vulnerability handling and disclosure.','Risk management','core',
   'Secure development practices plus a working vulnerability handling and disclosure route.',
   E'Secure development lifecycle documentation\nVulnerability handling procedure\nPublished disclosure policy'),
  ('Art.21.2(f)','Effectiveness Assessment','Policies and procedures to assess the effectiveness of risk-management measures.','Risk management','important',
   'Reach and record a documented conclusion about whether your measures actually work.',
   E'Effectiveness review or internal audit\nSecurity metrics over time\nActions arising from the review'),
  ('Art.21.2(g)','Cyber Hygiene and Training','Basic cyber hygiene practices and cybersecurity training.','Risk management','important',
   'Baseline hygiene — patching, MFA, backups, least privilege — plus security awareness training for all staff.',
   E'Training completion records\nPatching and update evidence\nHygiene baseline documentation'),
  ('Art.21.2(h)','Cryptography','Policies and procedures on the use of cryptography and encryption.','Risk management','core',
   'A cryptography policy stating what is encrypted, with what, and how keys are managed — and evidence it is applied.',
   E'Cryptography policy\nEncryption in transit and at rest evidence\nKey management procedure'),
  ('Art.21.2(i)','HR Security, Access Control and Asset Management','Human resources security, access control policies and asset management.','Risk management','core',
   'Joiner-mover-leaver process, an access control policy applied in practice, and a current asset inventory.',
   E'Onboarding and offboarding records\nAccess control policy and access reviews\nAsset inventory'),
  ('Art.21.2(j)','Multi-Factor Authentication','Use of multi-factor authentication and secured communications.','Risk management','core',
   'MFA or continuous authentication across systems, and secured voice, video and text communication for sensitive matters.',
   E'MFA enforcement evidence covering all users\nSecured communications tooling\nEmergency communication arrangements'),
  ('Art.23.1','Early Warning (24 hours)','Early warning to the CSIRT or competent authority within 24 hours of becoming aware of a significant incident.','Incident reporting','core',
   'Within 24 hours you must submit an early warning indicating whether the incident is suspected to be unlawful or malicious, or could have cross-border impact. Know the recipient and have the template ready.',
   E'Reporting procedure naming the 24-hour trigger\nCSIRT or authority contact details\nEvidence of any early warnings submitted'),
  ('Art.23.2','Incident Notification (72 hours)','Incident notification within 72 hours, updating the early warning.','Incident reporting','core',
   'Within 72 hours, update the early warning with an initial assessment including severity, impact and indicators of compromise.',
   E'Notification template and procedure\nSubmitted notifications with timestamps\nSeverity and impact assessment method'),
  ('Art.23.3','Final Report (one month)','Final report within one month of the incident notification.','Incident reporting','important',
   'Within one month, submit a final report covering a detailed description, the threat type or root cause, the mitigations applied, and any cross-border impact.',
   E'Final report template\nSubmitted final reports\nRoot cause analysis records')
) as v(code, title, description, category, criticality, guidance, evidence)
where f.slug = 'nis2'
  and not exists (select 1 from public.controls c where c.framework_id = f.id and c.code = v.code);

-- --------------------------------------------------------------- crosswalk
-- Almost all of this points at measures that already existed for SOC 2.
insert into public.measure_controls (measure_id, control_id)
select m.id, c.id
from (values
  ('security-leadership','Art.20.1'),('risk-treatment','Art.20.1'),
  ('management-training','Art.20.2'),
  ('risk-assessment','Art.21.2(a)'),('security-policies','Art.21.2(a)'),('data-inventory','Art.21.2(a)'),
  ('incident-response-plan','Art.21.2(b)'),('incident-log','Art.21.2(b)'),('post-incident-review','Art.21.2(b)'),
  ('backups','Art.21.2(c)'),('dr-plan','Art.21.2(c)'),('crisis-management','Art.21.2(c)'),
  ('vendor-inventory','Art.21.2(d)'),('vendor-reviews','Art.21.2(d)'),('vendor-contracts','Art.21.2(d)'),
  ('sdlc','Art.21.2(e)'),('code-review','Art.21.2(e)'),('vuln-scanning','Art.21.2(e)'),('vuln-disclosure','Art.21.2(e)'),('patching','Art.21.2(e)'),
  ('effectiveness-review','Art.21.2(f)'),('control-review','Art.21.2(f)'),('pen-test','Art.21.2(f)'),
  ('security-training','Art.21.2(g)'),('patching','Art.21.2(g)'),('endpoint-protection','Art.21.2(g)'),
  ('encrypt-in-transit','Art.21.2(h)'),('encrypt-at-rest','Art.21.2(h)'),
  ('onboarding-checklist','Art.21.2(i)'),('offboarding-checklist','Art.21.2(i)'),('least-privilege','Art.21.2(i)'),('access-reviews','Art.21.2(i)'),('asset-inventory','Art.21.2(i)'),('background-checks','Art.21.2(i)'),
  ('mfa','Art.21.2(j)'),('sso','Art.21.2(j)'),
  ('regulatory-reporting','Art.23.1'),('incident-response-plan','Art.23.1'),
  ('regulatory-reporting','Art.23.2'),('incident-log','Art.23.2'),
  ('regulatory-reporting','Art.23.3'),('post-incident-review','Art.23.3')
) as x(mkey, code)
join public.measures m on m.key = x.mkey
join public.frameworks f on f.slug = 'nis2'
join public.controls c on c.framework_id = f.id and c.code = x.code
on conflict do nothing;
