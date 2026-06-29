// A starter catalogue of risks common to 11–200-person SaaS companies, so users
// pick from a real list instead of inventing risks from a blank box. Picking one
// pre-fills the risk form (client-side only — nothing is stored until they save).

export interface RiskTemplate {
  title: string;
  category: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  description: string;
  treatment: string;
}

export const RISK_LIBRARY: RiskTemplate[] = [
  {
    title: "No MFA on privileged accounts",
    category: "Access control",
    likelihood: "high",
    impact: "high",
    description: "Admin or root accounts without multi-factor authentication can be taken over with a single leaked password.",
    treatment: "Enforce MFA on all admin/root accounts and identity-provider logins; alert on non-compliant accounts.",
  },
  {
    title: "Over-privileged cloud IAM",
    category: "Access control",
    likelihood: "medium",
    impact: "high",
    description: "Broad cloud roles (e.g. multiple project owners / AdministratorAccess) widen the blast radius of any compromise.",
    treatment: "Apply least privilege, run periodic access reviews, and remove unused permissions.",
  },
  {
    title: "Single cloud region — no disaster recovery",
    category: "Availability",
    likelihood: "medium",
    impact: "high",
    description: "All production infrastructure in one region means a regional outage takes the whole service down.",
    treatment: "Document an RTO/RPO, add cross-region backups, and test restore procedures.",
  },
  {
    title: "Unencrypted backups or data at rest",
    category: "Data protection",
    likelihood: "low",
    impact: "high",
    description: "Backups or databases stored without encryption expose customer data if storage is accessed.",
    treatment: "Enable encryption at rest for all stores and backups; manage keys via a KMS.",
  },
  {
    title: "Critical vendor concentration",
    category: "Third-party",
    likelihood: "medium",
    impact: "high",
    description: "A critical subprocessor (hosting, auth, payments) failing or being breached directly impacts the product.",
    treatment: "Track critical vendors, collect their SOC 2 reports, and define contingencies for the most critical.",
  },
  {
    title: "Departing employees retain access",
    category: "People",
    likelihood: "medium",
    impact: "medium",
    description: "Without timely offboarding, former staff or contractors keep access to systems and data.",
    treatment: "Run an offboarding checklist that revokes access on the last day; reconcile in access reviews.",
  },
  {
    title: "No security awareness training",
    category: "People",
    likelihood: "high",
    impact: "medium",
    description: "Untrained staff are more susceptible to phishing and social-engineering attacks.",
    treatment: "Assign annual security awareness training and track completion.",
  },
  {
    title: "Source code without branch protection",
    category: "Change management",
    likelihood: "medium",
    impact: "medium",
    description: "Unprotected default branches allow unreviewed or malicious code to reach production.",
    treatment: "Require pull-request review and status checks on protected branches across all repos.",
  },
  {
    title: "Sensitive data in logs",
    category: "Data protection",
    likelihood: "medium",
    impact: "medium",
    description: "Secrets or personal data written to application logs can leak through log aggregation tooling.",
    treatment: "Scrub/secret-filter logs and restrict access to log stores.",
  },
  {
    title: "Weak TLS / transport security",
    category: "Network security",
    likelihood: "low",
    impact: "medium",
    description: "Outdated TLS versions or permissive SSL modes weaken data-in-transit protection.",
    treatment: "Enforce TLS 1.2+ and always-HTTPS on all public endpoints and zones.",
  },
  {
    title: "No vulnerability management process",
    category: "Vulnerability management",
    likelihood: "medium",
    impact: "high",
    description: "Without scanning and patching SLAs, known vulnerabilities linger in production.",
    treatment: "Adopt dependency/image scanning and define remediation SLAs by severity.",
  },
  {
    title: "Incident response plan untested",
    category: "Resilience",
    likelihood: "medium",
    impact: "medium",
    description: "An untested incident response plan may fail when a real incident occurs.",
    treatment: "Document an IR plan and run a tabletop exercise at least annually.",
  },
  {
    title: "Shadow IT / unsanctioned SaaS",
    category: "Third-party",
    likelihood: "high",
    impact: "low",
    description: "Staff adopting unvetted SaaS tools move company data outside reviewed vendors.",
    treatment: "Maintain an approved-tools list and review OAuth grants from connected identity providers.",
  },
  {
    title: "Customer PII without a retention policy",
    category: "Privacy",
    likelihood: "medium",
    impact: "medium",
    description: "Holding personal data indefinitely increases breach exposure and privacy-regulation risk.",
    treatment: "Define and enforce data retention & deletion schedules for personal data.",
  },
];
