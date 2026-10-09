import type { AccountPosture, DataStore } from "@/lib/aws/types";

/**
 * Where data lives: every database, table, bucket, volume group and backup copy
 * we found, with its region. Pure — the facts, the residency check and the
 * Facts tab all read the same list.
 */

/** AWS regions in EU member states (Zurich and London are in Europe but not the EU). */
export const EU_REGIONS = ["eu-central-1", "eu-west-1", "eu-west-3", "eu-north-1", "eu-south-1", "eu-south-2"];

export type Residency = "eu" | "europe";

export function allowedRegion(region: string, residency: Residency): boolean {
  return residency === "eu" ? EU_REGIONS.includes(region) : region.startsWith("eu-");
}

export const RESIDENCY_LABEL: Record<Residency, string> = {
  eu: "the EU",
  europe: "Europe (EU, UK and Switzerland)",
};

const REGION_NAMES: Record<string, string> = {
  "us-east-1": "N. Virginia, USA",
  "us-east-2": "Ohio, USA",
  "us-west-1": "N. California, USA",
  "us-west-2": "Oregon, USA",
  "ca-central-1": "Montreal, Canada",
  "ca-west-1": "Calgary, Canada",
  "eu-central-1": "Frankfurt, Germany",
  "eu-central-2": "Zurich, Switzerland",
  "eu-west-1": "Ireland",
  "eu-west-2": "London, UK",
  "eu-west-3": "Paris, France",
  "eu-north-1": "Stockholm, Sweden",
  "eu-south-1": "Milan, Italy",
  "eu-south-2": "Spain",
  "ap-south-1": "Mumbai, India",
  "ap-southeast-1": "Singapore",
  "ap-southeast-2": "Sydney, Australia",
  "ap-northeast-1": "Tokyo, Japan",
  "ap-northeast-2": "Seoul, South Korea",
  "sa-east-1": "São Paulo, Brazil",
  "me-central-1": "UAE",
  "il-central-1": "Tel Aviv, Israel",
};

export function regionName(region: string): string {
  const n = REGION_NAMES[region];
  return n ? `${n} (${region})` : region;
}

export const STORE_LABEL: Record<DataStore["kind"], string> = {
  rds: "RDS database",
  aurora: "Aurora cluster",
  dynamodb: "DynamoDB table",
  s3: "S3 bucket",
  ebs: "EBS volumes",
  "backup-copy": "backup copy",
  "audit-logs": "audit-log bucket",
};

/** The data stores in one account's posture. Sections we couldn't read contribute nothing. */
export function dataStores(p: AccountPosture): DataStore[] {
  const acct = p.accountId;
  const out: DataStore[] = [];
  const logBuckets = new Set((p.trails.ok ? p.trails.data : []).map((t) => t.s3Bucket).filter(Boolean) as string[]);

  for (const [region, r] of Object.entries(p.regional)) {
    const prot = r.backup.ok ? r.backup.data.protected : [];
    const awsBackup = (name: string) => {
      const hit = prot.find((x) => x.arn.endsWith(`:${name}`) || x.arn.endsWith(`/${name}`));
      return hit ? `AWS Backup${hit.lastBackup ? ` (last ${hit.lastBackup.slice(0, 10)})` : ""}` : null;
    };
    for (const d of r.rds.ok ? r.rds.data : []) {
      if (d.clusterId) continue; // counted once, on the cluster
      const native = d.backupRetentionDays > 0 ? `${d.backupRetentionDays}-day automated backups` : null;
      out.push({
        kind: d.kind === "cluster" ? "aurora" : "rds",
        id: d.id,
        accountId: acct,
        region,
        encrypted: d.encrypted,
        backup: [native, awsBackup(d.id)].filter(Boolean).join(", ") || null,
      });
    }
    for (const t of r.dynamo.ok ? r.dynamo.data : []) {
      out.push({
        kind: "dynamodb",
        id: t.name,
        accountId: acct,
        region,
        encrypted: true, // DynamoDB encrypts every table at rest
        backup: [t.pitr ? "point-in-time recovery" : null, awsBackup(t.name)].filter(Boolean).join(", ") || null,
      });
    }
    if (r.inventory.volumes > 0) {
      const unencrypted = r.unencryptedVolumes.ok ? r.unencryptedVolumes.data.length : null;
      out.push({
        kind: "ebs",
        id: `${r.inventory.volumes} ${r.inventory.volumes === 1 ? "volume" : "volumes"}`,
        accountId: acct,
        region,
        encrypted: unencrypted === null ? null : unencrypted === 0,
        backup: null,
      });
    }
    for (const c of r.backup.ok ? r.backup.data.copies : []) {
      const name = c.resourceArn?.split(/[:/]/).pop() ?? "backup";
      if (out.some((s) => s.kind === "backup-copy" && s.id === name && s.region === c.region)) continue;
      out.push({ kind: "backup-copy", id: name, accountId: c.accountId ?? acct, region: c.region, encrypted: true, backup: `copied from ${region}` });
    }
  }
  for (const b of p.buckets.ok ? p.buckets.data : []) {
    // S3 has encrypted every new object by default since January 2023.
    out.push({ kind: logBuckets.has(b.name) ? "audit-logs" : "s3", id: b.name, accountId: acct, region: b.region, encrypted: true, backup: null });
  }
  return out;
}

/** Regions holding data, with what's in each — for statements like "all data is in the EU". */
export function storesByRegion(stores: DataStore[]): { region: string; stores: DataStore[] }[] {
  const m = new Map<string, DataStore[]>();
  for (const s of stores) m.set(s.region, [...(m.get(s.region) ?? []), s]);
  return [...m.entries()].map(([region, list]) => ({ region, stores: list })).sort((a, b) => b.stores.length - a.stores.length);
}
