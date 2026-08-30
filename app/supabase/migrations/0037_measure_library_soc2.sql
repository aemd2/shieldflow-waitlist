-- 0037_measure_library_soc2.sql
--
-- Seeds the measure library and its crosswalk to the SOC 2 Common Criteria.
--
-- 54 measures covering all 33 CC criteria. Every criterion is satisfied by at
-- least one measure, and most measures satisfy several criteria — which is the
-- entire point: the user does the work once and it counts everywhere.
--
-- Provenance: the *idea* of which practices satisfy which criteria is a factual
-- relationship about the frameworks, not anyone's creative expression, and was
-- sanity-checked against Probo's published crosswalk (MIT). All measure names,
-- summaries, guidance and evidence lists here are written for ShieldFlow. Several
-- of Probo's mappings were corrected rather than copied — e.g. they map "build an
-- incident response process" to CC2.2 (communication) where it belongs on
-- CC7.3/CC7.4, and "have all policies approved and signed" to CC1.1 where it
-- belongs on CC5.3.
--
-- Once NIS2, DORA, CRA, ISO 27001 and the rest are seeded, they attach to these
-- same measures by adding rows to measure_controls — no new measures needed for
-- the ~80% of requirements that overlap.

insert into public.measures (key, name, category, importance, summary, guidance, suggested_evidence) values

-- ============================================ Governance & policy
('code-of-conduct','Publish a code of conduct','Governance & policy','mandatory',
 'A written code of conduct, acknowledged by everyone, with a way to report violations.',
 'Write a short code of conduct covering ethics, acceptable use, and conflicts of interest. Have every employee acknowledge it at hire and once a year after that, and name the channel for reporting a violation.',
 E'Code of conduct document\nAcknowledgement records for all staff\nWhistleblower or ethics reporting channel'),

('security-leadership','Assign security ownership','Governance & policy','mandatory',
 'One named person accountable for security, with leadership reviewing it on a schedule.',
 'Name the person accountable for the security programme and put them on the org chart. Hold a documented leadership or board review of security at a set cadence and keep the minutes — auditors want to see oversight, not just activity.',
 E'Org chart showing security reporting lines\nLeadership or board minutes covering security\nNamed security owner in a job description'),

('security-policies','Write and approve your security policies','Governance & policy','mandatory',
 'The policy set an auditor expects, each approved by a named person.',
 'Cover at minimum: information security, access control, acceptable use, incident response, vendor management, and business continuity. Each needs a named approver and a review date. ShieldFlow can draft these and track approval.',
 E'Approved policy documents with version history\nNamed approver and approval date on each\nAnnual review evidence'),

('policy-acknowledgement','Collect policy acknowledgements','Governance & policy','mandatory',
 'Proof that staff have read and accepted the current version of each policy.',
 'Publish approved policies to staff and record who accepted which version. Re-prompt everyone when a policy changes materially — an acknowledgement of v1 does not cover v2.',
 E'Per-person acknowledgement records tied to a policy version\nEvidence of re-acknowledgement after a version bump'),

('risk-assessment','Run an annual risk assessment','Governance & policy','mandatory',
 'A documented, repeatable assessment of the risks to your systems and data.',
 'Identify your risks, score likelihood and impact, and record the treatment decision and owner for each. Do it at least annually and whenever something significant changes. Keep the methodology written down so the result is reproducible.',
 E'Risk register with likelihood and impact scoring\nDocumented risk methodology\nEvidence of management review'),

('fraud-risk','Assess fraud and insider risk','Governance & policy','mandatory',
 'Fraud named explicitly as a risk category, with mitigations recorded.',
 'Consider insider misuse, payment fraud, and credential theft as their own risk entries rather than folding them into "security". Record what reduces each — segregation of duties, approval thresholds, logging.',
 E'Risk register entries covering fraud scenarios\nSegregation-of-duties documentation\nApproval thresholds for payments or privileged actions'),

('change-risk-review','Assess the risk of significant changes','Governance & policy','mandatory',
 'A check on control impact before major changes land.',
 'Before a new product, a migration, an acquisition, or the departure of a key person, assess what it does to your controls and record the assessment. This is the criterion most teams forget until the auditor asks.',
 E'Change-impact assessments for significant changes\nArchitecture or infrastructure review records\nRisk review triggered by a major event'),

('control-review','Review that controls actually operate','Governance & policy','mandatory',
 'Periodic verification that controls work, with deficiencies tracked to closure.',
 'Check on a schedule that your controls are operating, not just documented. When one fails, log it, assign an owner and a due date, and track it closed. Evidence of escalation matters as much as the fix.',
 E'Internal control review or audit records\nDeficiency log with owners and due dates\nRemediation tickets showing closure'),

('risk-treatment','Record risk treatment decisions','Governance & policy','mandatory',
 'For each risk, a decision to mitigate, transfer, avoid or accept — with a rationale.',
 'Every risk needs a recorded decision and an owner. Accepted risks need a named approver and a review date; mitigated risks need the controls that reduce them linked.',
 E'Risk register showing treatment decision per risk\nControls linked to the risks they mitigate\nSign-off on accepted risks'),

-- ============================================ People
('job-descriptions','Define roles and required competence','People','mandatory',
 'Written responsibilities so security duties sit with named roles.',
 'Keep job descriptions that state security responsibilities and the competence required. This is what evidences both organisational structure and commitment to competence.',
 E'Job descriptions naming security responsibilities\nOrg chart with reporting lines\nRole-based competence requirements'),

('background-checks','Screen new hires','People','mandatory',
 'Pre-employment checks proportionate to the access being granted.',
 'Run background checks where lawful in your jurisdiction, before access is granted, and keep the record of completion (not the underlying report).',
 E'Background check completion records\nScreening policy stating scope and timing'),

('security-training','Train staff on security','People','mandatory',
 'Security awareness training at hire and annually, with completion tracked.',
 'Deliver training covering phishing, passwords, data handling and how to report an incident. Track completion per person — an untracked training programme evidences nothing.',
 E'Training completion records per employee\nTraining content or provider details\nAnnual refresher schedule'),

('onboarding-checklist','Run a security onboarding checklist','People','mandatory',
 'A repeatable joiner process covering access, devices, training and policies.',
 'Use one checklist for every new joiner: provision least-privilege access, issue and enrol the device, assign training, and collect policy acknowledgements. Keep the completed checklist.',
 E'Completed onboarding checklists\nAccess provisioning tickets with approval\nNew-hire training and acknowledgement records'),

('offboarding-checklist','Offboard people the same day','People','mandatory',
 'All access revoked promptly when someone leaves, and evidenced.',
 'Revoke SSO, email, cloud, code and third-party access on the last day — target same business day — and confirm removal across every system. Recover or wipe the device.',
 E'Completed offboarding checklists with timestamps\nDeprovisioning tickets\nAccess review showing no orphaned accounts'),

('accountability','Hold people accountable for control duties','People','preferred',
 'Security responsibilities reflected in performance expectations.',
 'Include control ownership in performance expectations so accountability is real. Document the escalation path when responsibilities are not met.',
 E'Performance expectations referencing security duties\nControl owner assignments\nDisciplinary or escalation policy'),

-- ============================================ Communication
('internal-security-comms','Communicate security internally','Communication','mandatory',
 'Staff know their obligations and how to raise a concern.',
 'Distribute policies, announce material security changes, and publish a clear channel for reporting a concern or a suspected incident. Keep evidence the channel exists and is used.',
 E'Internal security announcements\nDocumented reporting channel\nPolicy distribution records'),

('trust-center','Publish a customer-facing security page','Communication','mandatory',
 'A public page describing your security posture and subprocessors.',
 'Publish what you do for security, which certifications you hold, and who your subprocessors are. ShieldFlow''s Trust Center does this and captures access requests.',
 E'Public trust or security page\nSubprocessor list\nSecurity package request process'),

('breach-notification','Define breach notification duties','Communication','mandatory',
 'Who tells customers and regulators about an incident, and within what deadline.',
 'Write down the notification obligations from your contracts and applicable law, who is authorised to communicate, and the clock for each. Under GDPR that is 72 hours; NIS2 and DORA are shorter still.',
 E'Breach notification procedure with deadlines\nContractual notification clauses\nNamed external communications owner'),

('data-inventory','Maintain a data inventory and flow diagram','Communication','mandatory',
 'A record of what data you hold, where it lives, and how it moves.',
 'List your data types, their classification, where each is stored, and who can reach it. A data-flow diagram makes the audit far faster and is the basis for scoping every other control.',
 E'Data inventory with classification\nData-flow diagram\nSystem and data location register'),

-- ============================================ Identity & access
('sso','Enforce single sign-on','Identity & access','mandatory',
 'Central authentication for every service that supports it.',
 'Route access through one identity provider so joiners, leavers and policy changes happen in one place. Ties directly to onboarding and offboarding evidence.',
 E'IdP configuration showing enforced SSO\nList of apps connected to SSO\nExceptions register for apps that cannot use it'),

('mfa','Require multi-factor authentication','Identity & access','mandatory',
 'MFA on every account, enforced rather than optional.',
 'Enforce MFA at the identity provider and on any service outside it — especially cloud consoles, source control, and email. Phishing-resistant factors where you can.',
 E'IdP policy showing MFA enforced\nMFA enrolment report covering all users\nCloud root or admin account MFA evidence'),

('least-privilege','Grant least-privilege access','Identity & access','mandatory',
 'Role-based permissions, with admin rights the exception.',
 'Define roles and grant the minimum each needs. Keep the number of administrators small and documented, and re-justify privileged access at each review.',
 E'Role definitions and permission matrix\nList of privileged users with justification\nAccess-control policy'),

('access-request','Approve access through a documented process','Identity & access','mandatory',
 'Every grant traceable to a request and an approval.',
 'Access changes should come from a ticket with an approver, not a direct message. Every account should tie to a named individual — no shared logins.',
 E'Access request tickets with approvals\nProvisioning process documentation\nEvidence that accounts map to named individuals'),

('access-reviews','Review access on a cadence','Identity & access','mandatory',
 'Periodic certification that the right people have the right access.',
 'At least quarterly for critical systems, walk the roster and decide keep, revoke or out-of-scope for each account. ShieldFlow''s access review module pulls the roster and files the result as evidence.',
 E'Completed access review with per-account decisions\nReview schedule\nEvidence that revocations were actioned'),

('service-accounts','Manage service accounts and keys','Identity & access','mandatory',
 'Non-human credentials inventoried, owned and rotated.',
 'Keep an inventory of service accounts, API keys and tokens with a named owner and a rotation schedule. Prefer short-lived credentials and workload identity over long-lived secrets.',
 E'Service account and API key inventory with owners\nRotation schedule and evidence of rotation\nSecrets management configuration'),

('password-manager','Provide a password manager','Identity & access','preferred',
 'A managed way to store credentials, plus a password standard.',
 'Issue a password manager to everyone and set a password standard (length, uniqueness, no reuse). This is what makes the standard actually followed.',
 E'Password manager deployment and coverage\nPassword policy\nEvidence of enforcement in the IdP'),

-- ============================================ Infrastructure & network
('network-boundary','Restrict network access','Infrastructure','mandatory',
 'Deny-by-default at the perimeter, with justified exceptions.',
 'Lock down security groups and firewall rules so nothing is open to the internet unless it must be. Review the rule set periodically and keep a network diagram.',
 E'Firewall or security group rule sets\nNetwork diagram\nReview evidence for open ingress rules'),

('encrypt-in-transit','Encrypt data in transit','Infrastructure','mandatory',
 'TLS 1.2 or higher everywhere, including internal service traffic.',
 'Enforce modern TLS on every public endpoint, redirect HTTP to HTTPS, and encrypt traffic between internal services and to your databases.',
 E'TLS configuration and version evidence per endpoint\nCertificate inventory and renewal process\nDatabase connection encryption settings'),

('encrypt-at-rest','Encrypt data at rest','Infrastructure','mandatory',
 'Databases, object storage, backups and laptops all encrypted.',
 'Turn on encryption at rest for every datastore and backup, and confirm disk encryption on endpoints. Record where the keys live and who can reach them.',
 E'Encryption-at-rest settings for databases and storage\nBackup encryption evidence\nKey management configuration'),

('vuln-scanning','Scan for vulnerabilities continuously','Infrastructure','mandatory',
 'Automated scanning of infrastructure, containers and dependencies.',
 'Run dependency, container and infrastructure scanning on a schedule and in CI. Route findings somewhere they get triaged rather than to an unread dashboard.',
 E'Scan configuration and recent scan output\nDependency alerting (e.g. Dependabot) configuration\nTriage records for findings'),

('patching','Patch to a defined SLA','Infrastructure','mandatory',
 'Severity-based deadlines for remediating known vulnerabilities.',
 'Set and publish remediation deadlines by severity — for example critical within 7 days, high within 30 — and track against them. An SLA you cannot evidence is not a control.',
 E'Documented remediation SLA by severity\nTickets showing remediation within SLA\nException records for anything overdue'),

('pen-test','Run a penetration test','Infrastructure','preferred',
 'An independent test at least annually, with findings tracked.',
 'Commission an external penetration test annually or after major architectural change. What auditors actually check is that the findings were remediated, so track them to closure.',
 E'Penetration test report\nRemediation tickets for each finding\nRetest or closure evidence'),

('clock-sync','Synchronise clocks','Infrastructure','preferred',
 'Consistent time across systems so logs can be correlated.',
 'Use NTP across all infrastructure. Without it, log correlation during an incident is unreliable and your timeline evidence is weak.',
 E'NTP configuration across systems\nLog samples showing consistent timestamps'),

('separate-environments','Separate production from non-production','Infrastructure','mandatory',
 'Production isolated, with no real customer data in test.',
 'Keep production credentials, networks and data separate from development and staging. Do not copy live customer data into test environments without masking it.',
 E'Environment separation evidence (accounts, VPCs, projects)\nData masking or synthetic data process\nAccess differences between environments'),

-- ============================================ Endpoint & physical
('endpoint-protection','Protect company devices','Endpoint & physical','mandatory',
 'Managed laptops with disk encryption, screen lock and malware protection.',
 'Enforce full-disk encryption, automatic screen lock, OS auto-update and endpoint protection on every device that touches company data, and keep a coverage report.',
 E'Endpoint protection coverage report\nDisk encryption evidence per device\nDevice configuration or MDM policy'),

('asset-inventory','Keep an asset inventory','Endpoint & physical','mandatory',
 'A current list of the devices, systems and services you run.',
 'Maintain an inventory of laptops, servers, cloud accounts and SaaS applications with an owner for each. Everything else — patching, access review, offboarding — depends on this being accurate.',
 E'Device and system inventory with owners\nSaaS application inventory\nEvidence the inventory is reviewed'),

('unauthorised-software','Control what software can run','Endpoint & physical','mandatory',
 'A stated position on what may be installed, and detection when it is not.',
 'Publish an acceptable-use standard covering software installation, and detect unapproved or malicious software on endpoints and in your build pipeline.',
 E'Acceptable use or software installation policy\nEndpoint detection alerts and dispositions\nContainer or dependency scanning output'),

('physical-access','Control physical access','Endpoint & physical','mandatory',
 'Office access controlled; datacentre security inherited and evidenced.',
 'For cloud-hosted systems this is largely inherited — file your provider''s SOC 2 or ISO 27001 report as the evidence. Cover your own offices separately if staff handle customer data there.',
 E'Cloud provider SOC 2 or ISO 27001 report\nOffice access control or badge records\nVisitor log and policy'),

('secure-disposal','Dispose of data and media securely','Endpoint & physical','mandatory',
 'Defined retention, then verified destruction.',
 'Set retention periods per data type, then delete or destroy on schedule. Wipe or crypto-erase devices before reuse or disposal, and keep the certificate where a vendor does it.',
 E'Data retention and disposal policy\nDevice wipe records or certificates of destruction\nStorage lifecycle and deletion configuration'),

-- ============================================ Secure development
('code-review','Require peer review','Secure development','mandatory',
 'No change reaches production without another person approving it.',
 'Require pull requests with at least one reviewer for production code. This is the single most commonly sampled change-management control.',
 E'Branch protection settings requiring review\nSample pull requests showing approval\nList of users who can bypass review'),

('branch-protection','Protect production branches','Secure development','mandatory',
 'Main branches protected, with checks required to pass.',
 'Block direct pushes to main, require status checks to pass, and restrict who can force-push or override. ShieldFlow''s GitHub and GitLab checks verify this automatically.',
 E'Branch protection configuration per repository\nEvidence that checks are required to merge\nAudit of override permissions'),

('change-management','Track every production change','Secure development','mandatory',
 'An audit trail from request through approval to deployment.',
 'Every production change should be traceable: what changed, who approved it, when it shipped, and how to roll back. Emergency changes need a documented after-the-fact approval path.',
 E'Change tickets or PRs linked to deployments\nDeployment logs\nEmergency change procedure and examples'),

('sdlc','Document your development lifecycle','Secure development','preferred',
 'A written description of how code goes from idea to production.',
 'Document the stages, the required gates (review, tests, scanning), and who can deploy. This is what evidences that your change controls are designed, not incidental.',
 E'SDLC documentation\nCI pipeline configuration showing gates\nEvidence gates cannot be skipped'),

('code-scanning','Scan code for vulnerabilities','Secure development','preferred',
 'Static analysis and secret scanning in the pipeline.',
 'Enable static analysis and secret scanning on every pull request so problems are caught before merge rather than in production.',
 E'Code scanning configuration\nRecent scan results\nSecret scanning alerts and dispositions'),

-- ============================================ Logging & monitoring
('centralised-logging','Centralise and retain logs','Logging & monitoring','mandatory',
 'Security-relevant logs collected in one place and kept long enough to investigate.',
 'Ship application, infrastructure and access logs to a central store with a stated retention period — 90 days minimum is the common expectation, a year is safer.',
 E'Log aggregation configuration\nStated retention period and evidence of it\nSample logs covering access and admin actions'),

('alerting','Alert on security events','Logging & monitoring','mandatory',
 'Automated alerts with a named person responsible for acting on them.',
 'Define which events page someone — failed admin logins, privilege changes, disabled logging, unusual egress — and record who owns the response. Alerts nobody owns are not a control.',
 E'Alerting rules configuration\nNamed on-call or responder rota\nSample alert with its investigation and disposition'),

('availability-monitoring','Monitor availability and capacity','Logging & monitoring','preferred',
 'Uptime and capacity watched, with thresholds that trigger action.',
 'Monitor availability, error rates and capacity headroom, and alert before limits are reached. Supports both operations criteria and any availability commitments you have made.',
 E'Monitoring dashboards\nAlert thresholds configuration\nCapacity review records'),

-- ============================================ Incident response
('incident-response-plan','Maintain an incident response plan','Incident response','mandatory',
 'A written, tested plan with severities, roles and escalation.',
 'Define severity levels, who does what at each, how to escalate, and the external notification clock. Test it at least annually — a tabletop exercise counts and is far cheaper than the alternative.',
 E'Incident response plan with roles and severity tiers\nTabletop exercise or IR test records\nEscalation and contact list'),

('incident-log','Record every incident','Incident response','mandatory',
 'A log of incidents with timeline, impact and resolution.',
 'Record every security incident, including the ones that turned out to be nothing: when detected, what was affected, what you did, when it closed. An empty incident log is a finding, not a clean bill of health.',
 E'Incident register with timelines\nEvidence of severity classification\nCustomer or regulator notifications where applicable'),

('post-incident-review','Review incidents afterwards','Incident response','mandatory',
 'A blameless review that produces tracked actions.',
 'After anything significant, run a review covering root cause, what worked, and what changes follow. Track the resulting actions to closure — that is the part auditors sample.',
 E'Post-incident review notes\nRoot cause analysis\nFollow-up actions tracked to closure'),

-- ============================================ Business continuity
('backups','Back up and test restores','Business continuity','mandatory',
 'Automated, encrypted backups that have actually been restored.',
 'Automate backups of everything you cannot recreate, encrypt them, and — the part almost everyone skips — perform and document a test restore at least annually.',
 E'Backup configuration and schedule\nBackup encryption evidence\nDocumented restore test with date and outcome'),

('dr-plan','Maintain a disaster recovery plan','Business continuity','mandatory',
 'A DR plan with stated RTO and RPO, exercised periodically.',
 'Write down what you would do if your primary environment were lost, with a target recovery time and acceptable data loss. Exercise it and record the result against those targets.',
 E'Business continuity and DR plan with RTO/RPO\nDR test results against stated targets\nEmergency contact and escalation list'),

-- ============================================ Vendors
('vendor-inventory','Keep a vendor inventory','Vendors','mandatory',
 'Every third party with access to your data, tiered by risk.',
 'List your vendors, what data each can reach, and a risk tier. This is the basis for how much diligence each one needs and is increasingly what your own customers will ask you for.',
 E'Vendor inventory with data access and risk tier\nData classification per vendor\nEvidence the inventory is kept current'),

('vendor-reviews','Review vendors on a cadence','Vendors','mandatory',
 'Periodic diligence proportionate to the vendor''s risk tier.',
 'Collect each critical vendor''s SOC 2, ISO 27001 or equivalent, check it has not expired, and re-review on a set cadence. ShieldFlow tracks cadence and SOC 2 expiry and raises an alert when either lapses.',
 E'Completed vendor reviews with dates\nVendor SOC 2 or ISO 27001 reports on file\nEvidence of follow-up on expired assurance'),

('vendor-contracts','Require security terms in contracts','Vendors','mandatory',
 'Contractual security, privacy and notification obligations.',
 'Make sure vendor agreements carry security requirements, a DPA where personal data is involved, and a breach-notification obligation with a deadline you can meet in turn.',
 E'Executed DPAs\nSecurity clauses in vendor contracts\nBreach notification obligations with deadlines')

on conflict (key) do nothing;

-- ------------------------------------------------------------- the crosswalk
-- measure key -> SOC 2 criterion. Joined by code so this is readable and can be
-- extended for NIS2/DORA/CRA/ISO by adding rows with a different framework slug.
insert into public.measure_controls (measure_id, control_id)
select m.id, c.id
from (values
  ('code-of-conduct','CC1.1'),
  ('security-leadership','CC1.2'),('security-leadership','CC1.3'),
  ('security-policies','CC5.1'),('security-policies','CC5.3'),
  ('policy-acknowledgement','CC5.3'),('policy-acknowledgement','CC1.5'),
  ('risk-assessment','CC3.1'),('risk-assessment','CC3.2'),
  ('fraud-risk','CC3.3'),
  ('change-risk-review','CC3.4'),
  ('control-review','CC4.1'),('control-review','CC4.2'),
  ('risk-treatment','CC9.1'),('risk-treatment','CC3.1'),
  ('job-descriptions','CC1.3'),('job-descriptions','CC1.4'),
  ('background-checks','CC1.4'),
  ('security-training','CC1.4'),('security-training','CC2.2'),
  ('onboarding-checklist','CC1.4'),('onboarding-checklist','CC6.2'),
  ('offboarding-checklist','CC6.3'),('offboarding-checklist','CC6.5'),
  ('accountability','CC1.5'),('accountability','CC1.3'),
  ('internal-security-comms','CC2.1'),('internal-security-comms','CC2.2'),
  ('trust-center','CC2.3'),
  ('breach-notification','CC2.3'),('breach-notification','CC7.4'),
  ('data-inventory','CC2.1'),('data-inventory','CC3.2'),
  ('sso','CC6.1'),
  ('mfa','CC6.1'),('mfa','CC6.8'),
  ('least-privilege','CC6.1'),('least-privilege','CC6.3'),
  ('access-request','CC6.2'),
  ('access-reviews','CC6.1'),('access-reviews','CC6.2'),('access-reviews','CC6.3'),
  ('service-accounts','CC6.1'),('service-accounts','CC6.3'),
  ('password-manager','CC6.1'),
  ('network-boundary','CC6.6'),
  ('encrypt-in-transit','CC6.6'),('encrypt-in-transit','CC6.7'),
  ('encrypt-at-rest','CC6.7'),
  ('vuln-scanning','CC7.1'),('vuln-scanning','CC8.1'),
  ('patching','CC7.1'),('patching','CC6.8'),
  ('pen-test','CC4.1'),('pen-test','CC7.1'),
  ('clock-sync','CC7.2'),
  ('separate-environments','CC5.2'),
  ('endpoint-protection','CC6.7'),('endpoint-protection','CC6.8'),
  ('asset-inventory','CC2.1'),('asset-inventory','CC4.1'),
  ('unauthorised-software','CC6.8'),
  ('physical-access','CC6.4'),
  ('secure-disposal','CC6.5'),
  ('code-review','CC8.1'),('code-review','CC5.2'),
  ('branch-protection','CC8.1'),
  ('change-management','CC8.1'),('change-management','CC5.2'),
  ('sdlc','CC5.2'),('sdlc','CC8.1'),
  ('code-scanning','CC7.1'),('code-scanning','CC8.1'),
  ('centralised-logging','CC7.2'),
  ('alerting','CC7.2'),('alerting','CC4.2'),
  ('availability-monitoring','CC7.2'),
  ('incident-response-plan','CC7.3'),('incident-response-plan','CC7.4'),
  ('incident-log','CC7.3'),('incident-log','CC7.4'),
  ('post-incident-review','CC7.5'),('post-incident-review','CC4.2'),
  ('backups','CC7.5'),('backups','CC9.1'),
  ('dr-plan','CC7.5'),('dr-plan','CC9.1'),
  ('vendor-inventory','CC9.2'),
  ('vendor-reviews','CC9.2'),('vendor-reviews','CC3.2'),
  ('vendor-contracts','CC9.2'),('vendor-contracts','CC2.3')
) as x(mkey, code)
join public.measures m on m.key = x.mkey
join public.frameworks f on f.slug = 'soc2'
join public.controls c on c.framework_id = f.id and c.code = x.code
on conflict do nothing;
