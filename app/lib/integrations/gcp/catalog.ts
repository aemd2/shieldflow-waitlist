import type { CheckDef } from "@/lib/checks-core";

export type GcpArea = "iam" | "exposure" | "data";

export const GCP_AREAS: { area: GcpArea; title: string }[] = [
  { area: "iam", title: "Identity & access" },
  { area: "exposure", title: "Internet exposure" },
  { area: "data", title: "Databases & backups" },
];

const PRIV = ["CC6.1", "CC6.3", "A.8.2", "A.5.15", "Req 7"];
const KEYS = ["CC6.1", "A.5.17", "A.8.5", "Req 8"];
const NET = ["CC6.6", "A.8.20", "A.8.22", "Req 1"];
const BACKUP = ["A1.2", "CC7.5", "A.8.13", "164.308(a)(7)"];

export const GCP_CHECKS: CheckDef<GcpArea>[] = [
  {
    key: "gcp.over_privilege",
    title: "Three or fewer project owners",
    area: "iam",
    severity: "medium",
    why: "Owners can do anything in a project, including deleting it and its backups. Three or fewer, with narrower roles for day-to-day work, is the usual bar.",
    controlCodes: PRIV,
    apiCalls: ["POST /v1/projects/{id}:getIamPolicy"],
    fix: { console: "Console → IAM & Admin → IAM → filter Role: Owner → edit the principal → replace Owner with a narrower role (Editor is still broad; prefer per-service roles)." },
  },
  {
    key: "gcp.public_iam",
    title: "Nothing is granted to everyone on the internet",
    area: "iam",
    severity: "high",
    why: "A role granted to allUsers or allAuthenticatedUsers on a project hands that access to anyone with a Google account.",
    controlCodes: PRIV,
    apiCalls: ["POST /v1/projects/{id}:getIamPolicy"],
    fix: { cli: "gcloud projects remove-iam-policy-binding {id} --member=allUsers --role=<ROLE>", console: "Console → IAM & Admin → IAM → the allUsers / allAuthenticatedUsers principal → Remove access." },
  },
  {
    key: "gcp.personal_accounts",
    title: "No personal Gmail accounts with access",
    area: "iam",
    severity: "medium",
    informational: true,
    why: "A personal @gmail.com account outside your Workspace isn't covered by your 2-step verification, offboarding or password rules — and stays when the person leaves.",
    controlCodes: [],
    apiCalls: ["POST /v1/projects/{id}:getIamPolicy"],
    fix: { console: "Grant the person's work account instead, then remove the personal one: Console → IAM & Admin → IAM." },
  },
  {
    key: "gcp.sa_owners",
    title: "No service account holds Owner or Editor",
    area: "iam",
    severity: "medium",
    why: "A service account's key in a CI system or on a laptop is a password that never expires — with Owner or Editor it can change anything.",
    controlCodes: PRIV,
    apiCalls: ["POST /v1/projects/{id}:getIamPolicy"],
    fix: { console: "Console → IAM & Admin → IAM → the service account → replace Owner/Editor with the specific roles it uses (Policy Analyzer shows which)." },
  },
  {
    key: "gcp.sa_key_age",
    title: "Service-account keys are rotated within 90 days",
    area: "iam",
    severity: "medium",
    why: "Downloaded keys never expire on their own. Old ones are the ones nobody remembers giving out.",
    controlCodes: KEYS,
    apiCalls: ["GET /v1/projects/{id}/serviceAccounts", "GET /v1/projects/{id}/serviceAccounts/{sa}/keys?keyTypes=USER_MANAGED"],
    fix: {
      cli: "gcloud iam service-accounts keys create new.json --iam-account=<SA_EMAIL>\n# deploy new.json, then:\ngcloud iam service-accounts keys delete <KEY_ID> --iam-account=<SA_EMAIL>",
      console: "Better: replace keys with Workload Identity Federation (GitHub Actions, AWS) so there is no key to rotate. Console → IAM & Admin → Service accounts → Keys.",
    },
  },
  {
    key: "gcp.public_buckets",
    title: "No storage bucket is public",
    area: "exposure",
    severity: "high",
    why: "A bucket readable by allUsers is a data breach waiting for someone to find the name.",
    controlCodes: NET,
    apiCalls: ["GET /storage/v1/b?project={id}", "GET /storage/v1/b/{bucket}/iam"],
    fix: {
      cli: "gcloud storage buckets update gs://{id} --public-access-prevention",
      console: "Console → Cloud Storage → the bucket → Permissions → Prevent public access. If it hosts a website on purpose, mark it out of scope with that reason.",
    },
  },
  {
    key: "gcp.open_admin_ports",
    title: "SSH and RDP aren't open to the internet",
    area: "exposure",
    severity: "high",
    why: "Port 22 or 3389 open to 0.0.0.0/0 is scanned and brute-forced within minutes of going live.",
    controlCodes: NET,
    apiCalls: ["GET /compute/v1/projects/{id}/global/firewalls"],
    fix: {
      cli: "gcloud compute firewall-rules update {id} --source-ranges=35.235.240.0/20  # IAP only",
      console: "Console → VPC network → Firewall → the rule → limit Source IPv4 ranges to 35.235.240.0/20 and connect through Identity-Aware Proxy (gcloud compute ssh --tunnel-through-iap).",
    },
  },
  {
    key: "gcp.sql_public",
    title: "Databases aren't reachable from anywhere",
    area: "data",
    severity: "high",
    why: "A Cloud SQL instance with a public IP open to 0.0.0.0/0, or without SSL required, puts your data one password away from the internet.",
    controlCodes: NET,
    apiCalls: ["GET /sql/v1/projects/{id}/instances"],
    fix: { console: "Console → SQL → the instance → Connections → remove 0.0.0.0/0 from Authorized networks (use the Cloud SQL Auth Proxy or private IP) and set SSL mode to 'Allow only SSL connections'." },
  },
  {
    key: "gcp.sql_backups",
    title: "Databases have automated backups",
    area: "data",
    severity: "high",
    why: "Without automated backups a bad migration or a deleted table is permanent.",
    controlCodes: BACKUP,
    apiCalls: ["GET /sql/v1/projects/{id}/instances"],
    fix: { cli: "gcloud sql instances patch {id} --backup-start-time=03:00 --enable-point-in-time-recovery", console: "Console → SQL → the instance → Edit → Data protection → Automate backups." },
  },
];

export const GCP_READS = [
  ["Viewer (roles/viewer)", "project IAM, buckets, firewall rules, Cloud SQL settings — no data inside them"],
  ["Security Reviewer (roles/iam.securityReviewer)", "service accounts and when their keys were created"],
] as const;
