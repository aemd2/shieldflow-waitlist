-- 0035_soc2_complete_common_criteria.sql
--
-- Completes the SOC 2 Common Criteria. The framework shipped with 15 of the 33
-- CC criteria (CC1.1-CC9.2) — only the CC8 series was complete. That is a real
-- integrity problem, not a content nicety: a workspace could mark all 15 controls
-- complete, reach the 14-Day Sprint's "audit-ready" state, and walk into an audit
-- missing 18 mandatory criteria. Three of the free open-source GRC tools surveyed
-- (CISO Assistant, Probo, OpenGRC) ship all 33; we shipped 45%.
--
-- Adds the 18 missing criteria with the same shape as the existing rows
-- (description = a short paraphrase of the criterion, plus the guidance /
-- suggested_evidence teaching content added in 0029). All prose here is written
-- for ShieldFlow — the AICPA's own Trust Services Criteria text is copyright and
-- is deliberately NOT reproduced; controls are identified by code + short title.
--
-- Criticality re-tiering: the previous core set (8 controls) was chosen when the
-- framework had 15 controls total. At 33, four of the new criteria are core by any
-- auditor's reading — encryption in transit (CC6.7), malicious-software prevention
-- (CC6.8), incident response (CC7.4), and vendor risk (CC9.2) — bringing core to 12
-- of 33. This drives the sprint's "close the core gaps" phase (lib/setup.ts).
--
-- CC6.4 (physical access) is tiered 'operational' deliberately: for a cloud-hosted
-- SaaS this control is almost entirely inherited from the hosting provider and is
-- satisfied by their SOC 2 report rather than by the customer's own evidence.

insert into public.controls (framework_id, code, title, description, category, criticality, guidance, suggested_evidence)
select f.id, v.code, v.title, v.description, v.category, v.criticality, v.guidance, v.evidence
from public.frameworks f
cross join (values
  -- ===== CC1 Control Environment =====
  ('CC1.3','Organizational Structure','Management establishes reporting lines and assigns authority and responsibility.','Control Environment','important',
    'Document who owns security: publish an org chart with reporting lines, and name the person accountable for the security programme. An auditor needs to see that responsibility sits somewhere specific, not "everyone".',
    E'Org chart showing reporting lines\nJob descriptions naming security responsibilities\nNamed security owner (CISO, CTO, or equivalent)'),
  ('CC1.4','Competence','The entity attracts, develops, and retains competent people.','Control Environment','important',
    'Show that the people running your controls are qualified to: keep job descriptions with required skills, run background checks where lawful, and record completed security training for every employee.',
    E'Job descriptions listing required competencies\nBackground-check records (where legally permitted)\nSecurity awareness training completion records\nPerformance review process'),
  ('CC1.5','Accountability','Individuals are held accountable for their internal control responsibilities.','Control Environment','operational',
    'Tie control ownership to the individual: assign an owner to each control, include security responsibilities in performance expectations, and document what happens when they are not met.',
    E'Control owner assignments\nPerformance expectations referencing security duties\nDisciplinary or escalation policy'),

  -- ===== CC2 Communication and Information =====
  ('CC2.2','Internal Communication','The entity internally communicates information needed to support internal control.','Communication','operational',
    'Make sure employees know their security obligations and how to raise a concern. A documented channel (and evidence people have used it) is what an auditor looks for.',
    E'Security policies distributed to staff with acknowledgements\nInternal security announcements\nDocumented channel for reporting security concerns'),
  ('CC2.3','External Communication','The entity communicates with external parties on matters affecting internal control.','Communication','operational',
    'Define how you communicate security matters outward — to customers, vendors, and regulators — including who is authorised to speak and the timelines for notifying customers of an incident.',
    E'Customer-facing security page or Trust Center\nBreach-notification clauses in customer contracts\nVendor security requirements\nDefined external communication owner'),

  -- ===== CC3 Risk Assessment =====
  ('CC3.2','Risk Identification','The entity identifies and analyzes risks to the achievement of its objectives.','Risk Assessment','important',
    'Maintain a risk register that names each risk, scores likelihood and impact, and records the treatment decision and owner. Review it on a set cadence, not just once before the audit.',
    E'Risk register with likelihood and impact scoring\nDocumented risk methodology\nEvidence of periodic risk review'),
  ('CC3.3','Fraud Risk','The entity considers the potential for fraud in assessing risks.','Risk Assessment','operational',
    'Explicitly consider fraud as a risk category — insider misuse, payment fraud, credential theft — and record the mitigations. Auditors look for fraud to be named, not folded silently into "security".',
    E'Risk register entries covering fraud scenarios\nSegregation-of-duties documentation\nFraud or insider-threat policy'),
  ('CC3.4','Change Risk Assessment','The entity identifies and assesses changes that could significantly impact internal control.','Risk Assessment','important',
    'Assess the control impact of significant changes — new products, new infrastructure, acquisitions, key personnel departures — before they land, and record the assessment.',
    E'Change-impact assessments for major changes\nRisk review triggered by significant events\nArchitecture or infrastructure review records'),

  -- ===== CC4 Monitoring =====
  ('CC4.2','Deficiency Communication','The entity evaluates and communicates internal control deficiencies to those responsible for corrective action.','Monitoring','important',
    'When a control fails, route it to a named owner with a deadline and track it to closure. Evidence that findings were escalated to management is as important as the fix itself.',
    E'Findings or deficiency log with owners and due dates\nRemediation tickets showing closure\nManagement reporting on open findings'),

  -- ===== CC5 Control Activities =====
  ('CC5.2','Technology General Controls','The entity selects and develops general control activities over technology.','Control Activities','important',
    'Cover the general IT controls your application controls depend on: infrastructure access, change management, backup and restore, and segregation between environments.',
    E'Infrastructure access-control configuration\nChange management process\nBackup configuration and a documented restore test\nSeparation of production and non-production environments'),
  ('CC5.3','Policy Deployment','The entity deploys control activities through policies and procedures.','Control Activities','important',
    'Policies only count once they are approved, published, and acknowledged by staff, and reviewed at least annually. ShieldFlow''s policy module tracks all four states.',
    E'Approved and published policies with version history\nEmployee acknowledgement records\nEvidence of annual policy review'),

  -- ===== CC6 Logical and Physical Access =====
  ('CC6.4','Physical Access','The entity restricts physical access to facilities and protected information assets.','Access Controls','operational',
    'For cloud-hosted systems this is largely inherited — obtain and file your hosting provider''s SOC 2 report as evidence. Cover your own offices separately if staff handle customer data there.',
    E'Cloud provider SOC 2 or ISO 27001 report (inherited control)\nOffice access-control records or badge logs\nVisitor policy'),
  ('CC6.5','Asset Disposal','The entity disposes of protected information to meet its objectives.','Access Controls','important',
    'Define how data and hardware are securely destroyed at end of life: disk wiping or crypto-erase, certificates of destruction from vendors, and documented data-retention periods.',
    E'Data retention and disposal policy\nCertificates of destruction or device wipe records\nCloud storage deletion and retention configuration'),
  ('CC6.7','Transmission Security','The entity restricts the transmission and movement of information to authorized parties.','Access Controls','core',
    'Encrypt data in transit everywhere: TLS 1.2 or higher on all public endpoints, encrypted internal service traffic, and a policy governing removable media and file sharing.',
    E'TLS configuration and certificate inventory\nEncryption-in-transit settings for databases and internal services\nRemovable media and file-sharing policy'),
  ('CC6.8','Malicious Software','The entity implements controls to prevent or detect and act upon unauthorized or malicious software.','Access Controls','core',
    'Prevent and detect unauthorised software: endpoint protection on company devices, dependency and container scanning in CI, and a policy on what employees may install.',
    E'Endpoint protection deployment and coverage report\nDependency or container vulnerability scanning output\nAcceptable-use or software-installation policy'),

  -- ===== CC7 System Operations =====
  ('CC7.4','Incident Response Program','The entity responds to identified security incidents according to a defined program.','System Operations','core',
    'Maintain a written incident response plan with severity levels, named responders, escalation paths, and customer/regulator notification timelines — and test it at least annually.',
    E'Incident response plan with defined roles and severity tiers\nIncident log with timelines and resolution\nTabletop exercise or IR test records\nPost-incident review notes'),
  ('CC7.5','Incident Recovery','The entity identifies, develops, and implements activities to recover from security incidents.','System Operations','important',
    'Show you can recover, not just detect: documented recovery procedures, tested backup restores, and a business continuity or disaster recovery plan with a stated RTO and RPO.',
    E'Business continuity and disaster recovery plan with RTO/RPO\nBackup restore test results\nPost-incident recovery documentation'),

  -- ===== CC9 Risk Mitigation =====
  ('CC9.2','Vendor Risk Management','The entity assesses and manages risks associated with vendors and business partners.','Risk Mitigation','core',
    'Keep a vendor inventory with a risk tier for each, collect their SOC 2 or equivalent assurance, re-review on a set cadence, and require security terms in contracts. ShieldFlow''s vendor module tracks cadence and SOC 2 expiry.',
    E'Vendor inventory with risk classification\nVendor SOC 2 or ISO 27001 reports on file\nCompleted vendor security reviews with dates\nSecurity and DPA clauses in vendor contracts')
) as v(code, title, description, category, criticality, guidance, evidence)
where f.slug = 'soc2'
  and not exists (
    select 1 from public.controls c
    where c.framework_id = f.id and c.code = v.code
  );

-- Every workspace reads its controls FROM control_status (see
-- getControlsWithStatus in lib/db/queries.ts), so a control with no status row is
-- invisible. Seed 'not_started' for any (company, control) pair that is missing
-- one — scoped to frameworks the company has actually selected, so this can never
-- add controls a workspace did not opt into. Idempotent.
insert into public.control_status (company_id, control_id, status)
select cf.company_id, c.id, 'not_started'
from public.company_frameworks cf
join public.controls c on c.framework_id = cf.framework_id
where not exists (
  select 1 from public.control_status cs
  where cs.company_id = cf.company_id and cs.control_id = c.id
);
