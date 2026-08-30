-- 0043_pci_dss_sub_requirements.sql
--
-- Expands PCI DSS from the 12 top-level requirements to all 63 sub-requirements
-- (the x.y level of PCI DSS v4.0), and re-categorises the existing 12 so each
-- requirement renders as its own section containing its sub-requirements.
--
-- Depth choice, stated plainly: PCI DSS nests further, to x.y.z defined-approach
-- requirements (~250) and below that to testing procedures. The x.y level is the
-- granularity a control matrix is normally built at and what an SAQ works from;
-- going to x.y.z would triple the row count for material that is mostly testing
-- detail an assessor supplies. If a customer needs x.y.z it is additive later —
-- the measure crosswalk does not change.

-- Regroup the existing 12 so parents and children sit in the same section.
update public.controls c
set category = 'Requirement ' || substring(c.code from 'Req (\d+)')
from public.frameworks f
where f.id = c.framework_id and f.slug = 'pci-dss' and c.code like 'Req %';

insert into public.controls (framework_id, code, title, description, category, criticality)
select f.id, v.code, v.title, v.description, v.category, v.criticality
from public.frameworks f
cross join (values
  ('1.1','NSC Processes Defined','Processes and mechanisms for installing and maintaining network security controls are defined and understood.','Requirement 1','important'),
  ('1.2','NSC Configuration','Network security controls are configured and maintained.','Requirement 1','core'),
  ('1.3','CDE Network Access Restricted','Network access to and from the cardholder data environment is restricted.','Requirement 1','core'),
  ('1.4','Trusted and Untrusted Networks','Network connections between trusted and untrusted networks are controlled.','Requirement 1','core'),
  ('1.5','Dual-Connected Devices','Risks to the CDE from devices able to connect to both untrusted networks and the CDE are mitigated.','Requirement 1','important'),
  ('2.1','Secure Configuration Processes Defined','Processes and mechanisms for applying secure configurations are defined and understood.','Requirement 2','important'),
  ('2.2','System Components Configured Securely','System components are configured and managed securely.','Requirement 2','core'),
  ('2.3','Wireless Configured Securely','Wireless environments are configured and managed securely.','Requirement 2','important'),
  ('3.1','Stored Data Processes Defined','Processes and mechanisms for protecting stored account data are defined and understood.','Requirement 3','important'),
  ('3.2','Storage Minimised','Storage of account data is kept to a minimum.','Requirement 3','core'),
  ('3.3','Sensitive Authentication Data Not Stored','Sensitive authentication data is not retained after authorisation.','Requirement 3','core'),
  ('3.4','PAN Display Restricted','Access to displays of full PAN and the ability to copy PAN is restricted.','Requirement 3','important'),
  ('3.5','PAN Secured Where Stored','Primary account number is secured wherever it is stored.','Requirement 3','core'),
  ('3.6','Cryptographic Keys Secured','Cryptographic keys protecting stored account data are secured.','Requirement 3','core'),
  ('3.7','Key Management Processes','Key management processes are defined and implemented across the key lifecycle.','Requirement 3','core'),
  ('4.1','Transmission Processes Defined','Processes for protecting cardholder data in transit are defined and documented.','Requirement 4','important'),
  ('4.2','PAN Encrypted in Transit','PAN is protected with strong cryptography during transmission over open networks.','Requirement 4','core'),
  ('5.1','Anti-Malware Processes Defined','Processes and mechanisms for protecting systems from malicious software are defined and understood.','Requirement 5','important'),
  ('5.2','Malware Prevented or Detected','Malicious software is prevented, or detected and addressed.','Requirement 5','core'),
  ('5.3','Anti-Malware Active and Monitored','Anti-malware mechanisms and processes are active, maintained and monitored.','Requirement 5','core'),
  ('5.4','Anti-Phishing Mechanisms','Anti-phishing mechanisms protect users against phishing attacks.','Requirement 5','important'),
  ('6.1','Secure Software Processes Defined','Processes for developing and maintaining secure systems and software are defined and understood.','Requirement 6','important'),
  ('6.2','Bespoke Software Developed Securely','Bespoke and custom software is developed securely.','Requirement 6','core'),
  ('6.3','Vulnerabilities Identified and Addressed','Security vulnerabilities are identified and addressed.','Requirement 6','core'),
  ('6.4','Public-Facing Web Applications Protected','Public-facing web applications are protected against attacks.','Requirement 6','core'),
  ('6.5','Changes Managed Securely','Changes to all system components are managed securely.','Requirement 6','core'),
  ('7.1','Access Restriction Processes Defined','Processes for restricting access by business need to know are defined and understood.','Requirement 7','important'),
  ('7.2','Access Defined and Assigned','Access to system components and data is appropriately defined and assigned.','Requirement 7','core'),
  ('7.3','Access Control System','Access is managed through an access control system that enforces least privilege.','Requirement 7','core'),
  ('8.1','Identification Processes Defined','Processes for identifying users and authenticating access are defined and understood.','Requirement 8','important'),
  ('8.2','User Accounts Managed','User identification and related accounts are strictly managed through their lifecycle.','Requirement 8','core'),
  ('8.3','Strong Authentication','Strong authentication for users and administrators is established and managed.','Requirement 8','core'),
  ('8.4','MFA for CDE Access','Multi-factor authentication is implemented to secure access into the CDE.','Requirement 8','core'),
  ('8.5','MFA Configured Against Misuse','MFA systems are configured to prevent misuse.','Requirement 8','important'),
  ('8.6','Application and System Accounts','Use of application and system accounts and their authentication factors is strictly managed.','Requirement 8','core'),
  ('9.1','Physical Access Processes Defined','Processes for restricting physical access to cardholder data are defined and understood.','Requirement 9','operational'),
  ('9.2','Facility Entry Controls','Physical access controls manage entry into facilities and systems containing cardholder data.','Requirement 9','operational'),
  ('9.3','Personnel and Visitor Access','Physical access for personnel and visitors is authorised and managed.','Requirement 9','operational'),
  ('9.4','Media Handling','Media with cardholder data is securely stored, accessed, distributed and destroyed.','Requirement 9','important'),
  ('9.5','POI Device Protection','Point-of-interaction devices are protected from tampering and unauthorised substitution.','Requirement 9','important'),
  ('10.1','Logging Processes Defined','Processes for logging and monitoring access are defined and documented.','Requirement 10','important'),
  ('10.2','Audit Logs Implemented','Audit logs are implemented to support detection of anomalies and suspicious activity.','Requirement 10','core'),
  ('10.3','Audit Logs Protected','Audit logs are protected from destruction and unauthorised modification.','Requirement 10','core'),
  ('10.4','Audit Logs Reviewed','Audit logs are reviewed to identify anomalies or suspicious activity.','Requirement 10','core'),
  ('10.5','Log Retention','Audit log history is retained and available for analysis.','Requirement 10','important'),
  ('10.6','Time Synchronisation','Time-synchronisation mechanisms support consistent time settings across systems.','Requirement 10','important'),
  ('10.7','Security Control Failures Detected','Failures of critical security control systems are detected, reported and responded to promptly.','Requirement 10','core'),
  ('11.1','Testing Processes Defined','Processes for regularly testing security of systems and networks are defined and understood.','Requirement 11','important'),
  ('11.2','Wireless Access Points Monitored','Wireless access points are identified and monitored, and unauthorised ones addressed.','Requirement 11','operational'),
  ('11.3','Vulnerability Scanning','External and internal vulnerabilities are regularly identified, prioritised and addressed.','Requirement 11','core'),
  ('11.4','Penetration Testing','External and internal penetration testing is performed and exploitable weaknesses corrected.','Requirement 11','core'),
  ('11.5','Intrusion and File Change Detection','Network intrusions and unexpected file changes are detected and responded to.','Requirement 11','important'),
  ('11.6','Payment Page Change Detection','Unauthorised changes on payment pages are detected and responded to.','Requirement 11','important'),
  ('12.1','Information Security Policy','A comprehensive information security policy is known, maintained and current.','Requirement 12','core'),
  ('12.2','Acceptable Use Policies','Acceptable use policies for end-user technologies are defined and implemented.','Requirement 12','important'),
  ('12.3','Risk Management','Risks to the cardholder data environment are formally identified, evaluated and managed.','Requirement 12','core'),
  ('12.4','PCI DSS Compliance Managed','PCI DSS compliance is managed with defined responsibility and oversight.','Requirement 12','important'),
  ('12.5','Scope Documented and Validated','PCI DSS scope is documented and validated at defined intervals.','Requirement 12','core'),
  ('12.6','Security Awareness Education','Security awareness education is an ongoing activity.','Requirement 12','core'),
  ('12.7','Personnel Screening','Personnel are screened to reduce risks from insider threats.','Requirement 12','important'),
  ('12.8','Third-Party Service Provider Risk','Risk associated with third-party service provider relationships is managed.','Requirement 12','core'),
  ('12.9','TPSP Support for Compliance','Third-party service providers support their customers'' PCI DSS compliance.','Requirement 12','important'),
  ('12.10','Incident Response','Suspected and confirmed incidents affecting the CDE are responded to immediately.','Requirement 12','core')
) as v(code, title, description, category, criticality)
where f.slug = 'pci-dss'
  and not exists (select 1 from public.controls c where c.framework_id = f.id and c.code = v.code);

insert into public.measure_controls (measure_id, control_id)
select m.id, c.id
from (values
  ('security-policies','1.1'),('network-boundary','1.2'),('network-boundary','1.3'),
  ('network-boundary','1.4'),('endpoint-protection','1.5'),
  ('security-policies','2.1'),('secure-defaults','2.2'),('network-boundary','2.3'),
  ('security-policies','3.1'),('data-inventory','3.2'),('data-inventory','3.3'),
  ('least-privilege','3.4'),('encrypt-at-rest','3.5'),('encrypt-at-rest','3.6'),('encrypt-at-rest','3.7'),
  ('security-policies','4.1'),('encrypt-in-transit','4.2'),
  ('security-policies','5.1'),('endpoint-protection','5.2'),('endpoint-protection','5.3'),
  ('unauthorised-software','5.3'),('security-training','5.4'),
  ('sdlc','6.1'),('code-review','6.2'),('code-scanning','6.2'),
  ('vuln-scanning','6.3'),('patching','6.3'),('secure-defaults','6.4'),
  ('change-management','6.5'),('branch-protection','6.5'),
  ('security-policies','7.1'),('least-privilege','7.2'),('access-reviews','7.3'),
  ('security-policies','8.1'),('access-request','8.2'),('offboarding-checklist','8.2'),
  ('password-manager','8.3'),('sso','8.3'),('mfa','8.4'),('mfa','8.5'),
  ('service-accounts','8.6'),
  ('physical-access','9.1'),('physical-access','9.2'),('physical-access','9.3'),
  ('secure-disposal','9.4'),('asset-inventory','9.5'),
  ('security-policies','10.1'),('centralised-logging','10.2'),('centralised-logging','10.3'),
  ('alerting','10.4'),('centralised-logging','10.5'),('clock-sync','10.6'),('alerting','10.7'),
  ('security-policies','11.1'),('network-boundary','11.2'),('vuln-scanning','11.3'),
  ('pen-test','11.4'),('alerting','11.5'),('code-scanning','11.6'),
  ('security-policies','12.1'),('policy-acknowledgement','12.1'),
  ('security-policies','12.2'),('unauthorised-software','12.2'),
  ('risk-assessment','12.3'),('risk-treatment','12.3'),
  ('control-review','12.4'),('effectiveness-review','12.4'),
  ('data-inventory','12.5'),('asset-inventory','12.5'),
  ('security-training','12.6'),('background-checks','12.7'),
  ('vendor-reviews','12.8'),('vendor-inventory','12.8'),('ict-register','12.8'),
  ('vendor-contracts','12.9'),
  ('incident-response-plan','12.10'),('incident-log','12.10'),('post-incident-review','12.10')
) as x(mkey, code)
join public.measures m on m.key = x.mkey
join public.frameworks f on f.slug = 'pci-dss'
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
