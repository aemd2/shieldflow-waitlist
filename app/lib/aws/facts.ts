import type { SupabaseClient } from "@supabase/supabase-js";
import { mergePeople, productionGrants, type WorkspacePeople } from "@/lib/aws/roster";
import { allowedRegion, regionName, RESIDENCY_LABEL, STORE_LABEL, storesByRegion, type Residency } from "@/lib/aws/stores";
import { settingsFrom, type AwsSettings } from "@/lib/aws/settings";
import type { AccountScan, AwsCheckResult, DataStore } from "@/lib/aws/types";

/**
 * What a company can tell its customers about its AWS, in sentences, each one
 * verified by the last scan of its in-scope (production) accounts: where data
 * lives, encryption, backups and restore tests, logging, access, exposure.
 *
 * A fact is only ever stated as true when the checks behind it passed. When they
 * failed the sentence says what's wrong; when they couldn't be read it says so.
 * These sentences go into questionnaire drafts and Co-Pilot, the Trust Center
 * (true ones only, if the company opts in) and the supplier data sheet.
 *
 * Aggregate on purpose: counts, regions and service names — never a person.
 */

export interface AwsFact {
  key: "location" | "encryption" | "backups" | "logging" | "access" | "exposure" | "detection";
  title: string;
  /** True: verified. False: verified NOT true (statement says what's wrong). Null: couldn't verify. */
  ok: boolean | null;
  statement: string;
  proof: string[];
}

export interface AwsFacts {
  verifiedAt: string | null;
  accounts: number;
  facts: AwsFact[];
  regions: { region: string; name: string; stores: DataStore[]; allowed: boolean | null }[];
  residency: Residency | null;
}

/** "accepted": passed only because something was marked out of scope. */
type Verdict = AwsCheckResult["result"] | "accepted" | null;

const EXPOSURE_GAP: Record<string, string> = {
  "aws.s3_public_buckets": "a storage bucket is public",
  "aws.s3_account_public_access_block": "S3 Block Public Access isn't on for the whole account",
  "aws.rds_public": "a database is reachable from the internet",
  "aws.public_snapshots": "a snapshot or machine image is shared publicly",
  "aws.open_admin_ports": "SSH or RDP is open to the internet",
  "aws.open_database_ports": "a database port is open to the internet",
};

/** One verdict for a check across accounts: any fail fails, any can't-tell can't tell. */
function verdict(scans: AccountScan[], key: string): Verdict {
  const rs = scans.map((s) => s.results.find((r) => r.key === key)).filter(Boolean) as AwsCheckResult[];
  if (!rs.length) return null;
  if (rs.some((r) => r.result === "fail")) return "fail";
  if (rs.some((r) => r.result === "inconclusive")) return "inconclusive";
  // An exception is a risk the company accepted, not a fact about its AWS:
  // never claim it to a customer as verified.
  if (rs.some((r) => r.accepted?.length)) return "accepted";
  return "pass";
}

function failing(scans: AccountScan[], key: string): number {
  return scans.reduce((n, s) => n + (s.results.find((r) => r.key === key)?.failingCount ?? 0), 0);
}

const joinAnd = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

function allPass(...vs: Verdict[]): boolean | null {
  if (vs.some((v) => v === "fail")) return false;
  if (vs.some((v) => v !== "pass")) return null;
  return true;
}

/** Why a fact isn't stated: exceptions recorded, or something couldn't be read. */
function unverified(what: string, ...vs: Verdict[]): string {
  return vs.includes("accepted")
    ? `${what} isn't stated as verified: some resources were accepted as exceptions.`
    : `${what} couldn't be fully verified in the last scan.`;
}

export function awsFacts(scans: AccountScan[], people: WorkspacePeople | null, settings: Pick<AwsSettings, "residency" | "logRetentionDays" | "restoreTestDays">): AwsFacts {
  const verifiedAt = scans.map((s) => s.scannedAt).sort()[0] ?? null;
  const facts: AwsFact[] = [];
  const stores = scans.flatMap((s) => s.stores ?? []);
  const data = stores.filter((s) => s.kind !== "audit-logs");
  const residency = settings.residency;

  // ------------------------------------------------------------ location
  const regions = storesByRegion(data).map((r) => ({
    region: r.region,
    name: regionName(r.region),
    stores: r.stores,
    allowed: residency ? allowedRegion(r.region, residency) : null,
  }));
  const PLURAL: Partial<Record<DataStore["kind"], string>> = {
    rds: "RDS databases",
    aurora: "Aurora clusters",
    dynamodb: "DynamoDB tables",
    s3: "S3 buckets",
    "backup-copy": "backup copies",
  };
  const describe = (list: DataStore[]) => {
    const parts: string[] = [];
    for (const k of ["rds", "aurora", "dynamodb", "s3", "backup-copy"] as const) {
      const n = list.filter((s) => s.kind === k).length;
      if (n) parts.push(`${n} ${n === 1 ? STORE_LABEL[k] : PLURAL[k]}`);
    }
    for (const e of list.filter((s) => s.kind === "ebs")) parts.push(e.id.replace(/(volumes?)$/, "EBS $1"));
    return parts.join(", ");
  };
  const unscanned = scans.flatMap((s) => s.regions.unscanned.map((u) => u.region));
  if (!scans.length) {
    facts.push({ key: "location", title: "Where data is stored", ok: null, statement: "No production AWS account has been scanned yet.", proof: [] });
  } else if (!regions.length) {
    facts.push({ key: "location", title: "Where data is stored", ok: null, statement: "No databases, buckets, volumes or backup copies were found in the production AWS accounts.", proof: [] });
  } else {
    const names = regions.map((r) => r.name);
    const outside = residency ? regions.filter((r) => !r.allowed) : [];
    const where = residency ? RESIDENCY_LABEL[residency] : null;
    const statement =
      `Production data — databases, tables, buckets, volumes and backup copies — is hosted on AWS in ${joinAnd(names)}.` +
      (where ? (outside.length ? ` ${outside.length} ${outside.length === 1 ? "region is" : "regions are"} outside ${where}: ${joinAnd(outside.map((r) => r.name))}.` : ` All of it is in ${where}.`) : "");
    facts.push({
      key: "location",
      title: "Where data is stored",
      ok: unscanned.length ? null : residency ? !outside.length : true,
      statement: unscanned.length ? `${statement} (Not every region could be scanned: ${unscanned.join(", ")}.)` : statement,
      proof: regions.map((r) => `${r.name}: ${describe(r.stores)}`),
    });
  }

  // ---------------------------------------------------------- encryption
  {
    const rds = verdict(scans, "aws.rds_encrypted");
    const ebs = verdict(scans, "aws.ebs_unencrypted_volumes");
    const dbCount = data.filter((s) => s.kind === "rds" || s.kind === "aurora").length;
    const volumes = data.some((s) => s.kind === "ebs");
    const managed = [data.some((s) => s.kind === "s3") ? "S3" : null, data.some((s) => s.kind === "dynamodb") ? "DynamoDB" : null].filter(Boolean) as string[];
    // Never a claim about nothing: with no data stores there is nothing to call encrypted.
    const ok = data.length ? allPass(rds, ebs) : null;
    const bad = failing(scans, "aws.rds_encrypted") + failing(scans, "aws.ebs_unencrypted_volumes");
    const subjects = [
      dbCount === 1 ? "the database" : dbCount ? `all ${dbCount} databases` : null,
      volumes ? "every EBS volume" : null,
    ].filter(Boolean) as string[];
    const kms = subjects.length
      ? `${joinAnd(subjects)} ${subjects.length === 1 && !subjects[0].startsWith("all") ? "is" : "are"} encrypted with AWS KMS`
      : null;
    const byDefault = managed.length ? `${joinAnd(managed)} ${managed.length === 1 ? "encrypts" : "encrypt"} everything by default` : null;
    facts.push({
      key: "encryption",
      title: "Encryption at rest",
      ok,
      statement: !data.length
        ? "No databases, volumes or buckets were found to encrypt."
        : ok === true
          ? `All data at rest is encrypted: ${[kms, byDefault].filter(Boolean).join(", and ")}.`
          : ok === false
            ? `${bad} ${bad === 1 ? "database or volume is" : "databases or volumes are"} not encrypted at rest.`
            : unverified("Encryption at rest", rds, ebs),
      proof: ["RDS: StorageEncrypted on every instance and cluster", "EC2: every EBS volume Encrypted", "S3: default encryption on every bucket since January 2023", "DynamoDB: encryption at rest always on"],
    });
  }

  // ------------------------------------------------------------- backups
  {
    const rds = verdict(scans, "aws.rds_backups");
    const pitr = verdict(scans, "aws.dynamodb_pitr");
    const tested = verdict(scans, "aws.restore_tested");
    const last = scans.flatMap((s) => s.restores ?? []).sort((a, b) => b.at.localeCompare(a.at))[0];
    const retention = data
      .filter((s) => s.kind === "rds" || s.kind === "aurora")
      .map((s) => Number(/^(\d+)-day/.exec(s.backup ?? "")?.[1] ?? 0))
      .filter(Boolean);
    const range = retention.length ? (Math.min(...retention) === Math.max(...retention) ? `${retention[0]} days` : `${Math.min(...retention)}–${Math.max(...retention)} days`) : null;
    const hasData = data.some((s) => s.kind === "rds" || s.kind === "aurora" || s.kind === "dynamodb");
    const ok = hasData ? allPass(rds, pitr, tested) : null;
    const parts = [
      range ? `databases keep ${range} of automated backups` : null,
      data.some((s) => s.kind === "dynamodb") && pitr === "pass" ? "every DynamoDB table has point-in-time recovery" : null,
      last ? `the last restore test was on ${last.at.slice(0, 10)} (${last.via}${last.automated ? ", automated" : ""})` : null,
    ].filter(Boolean) as string[];
    facts.push({
      key: "backups",
      title: "Backups and restore tests",
      ok,
      statement: !hasData
        ? "No databases or tables were found to back up."
        : ok === true
          ? `${parts.join("; ").replace(/^./, (c) => c.toUpperCase())}.`
          : ok === false
            ? `Backups are not fully in place: ${[rds === "fail" ? "some databases keep under 7 days of backups" : null, pitr === "fail" ? "some DynamoDB tables lack point-in-time recovery" : null, tested === "fail" ? `no restore has been tested in the last ${settings.restoreTestDays} days` : null].filter(Boolean).join("; ")}.`
            : unverified("Backup coverage", rds, pitr, tested),
      proof: ["RDS: BackupRetentionPeriod", "DynamoDB: point-in-time recovery status", "AWS Backup restore jobs and RDS/DynamoDB restores in CloudTrail"],
    });
  }

  // ------------------------------------------------------------- logging
  {
    const on = verdict(scans, "aws.cloudtrail_enabled");
    const valid = verdict(scans, "aws.cloudtrail_log_validation");
    const kept = verdict(scans, "aws.log_retention");
    const ok = allPass(on, valid, kept);
    facts.push({
      key: "logging",
      title: "Audit logging",
      ok,
      statement:
        ok === true
          ? `Every AWS API call in every region is recorded by CloudTrail, with tamper-evident log files kept at least ${settings.logRetentionDays} days.`
          : ok === false
            ? `Audit logging has gaps: ${[on === "fail" ? "CloudTrail doesn't record every region" : null, valid === "fail" ? "log file validation is off" : null, kept === "fail" ? `logs are kept less than ${settings.logRetentionDays} days` : null].filter(Boolean).join("; ")}.`
            : unverified("Audit logging", on, valid, kept),
      proof: ["CloudTrail: multi-region trail logging", "CloudTrail: log file validation", "CloudWatch Logs retention / S3 lifecycle"],
    });
  }

  // -------------------------------------------------------------- access
  {
    const root = verdict(scans, "aws.root_mfa");
    const users = verdict(scans, "aws.iam_user_mfa");
    const admins = verdict(scans, "aws.admin_users");
    const ok = allPass(root, users);
    const inScope = people?.inScope ?? [];
    const reach = people ? people.identities.filter((i) => i.active && productionGrants(i, inScope).length) : [];
    const adminCount = reach.filter((i) => productionGrants(i, inScope).some((g) => g.admin)).length;
    const sso = reach.filter((i) => i.kind === "sso").length;
    const who = people
      ? ` ${reach.length} ${reach.length === 1 ? "person or user has" : "people and users have"} access to production${sso ? ` (${sso} through IAM Identity Center)` : ""}, ${adminCount} with administrator rights.`
      : "";
    facts.push({
      key: "access",
      title: "Access to production",
      ok,
      statement:
        ok === true
          ? `The root account and every IAM user who can sign in to the console use multi-factor authentication${admins === "pass" ? "; no IAM user holds standing administrator rights" : ""}.${who}`
          : ok === false
            ? `MFA is missing: ${[root === "fail" ? "the root account has no MFA" : null, users === "fail" ? `${failing(scans, "aws.iam_user_mfa")} console users have no MFA` : null].filter(Boolean).join("; ")}.${who}`
            : `${unverified("MFA", root, users)}${who}`,
      proof: ["IAM credential report", "IAM Identity Center assignments"],
    });
  }

  // ------------------------------------------------------------ exposure
  {
    const keys = ["aws.s3_public_buckets", "aws.s3_account_public_access_block", "aws.rds_public", "aws.public_snapshots", "aws.open_admin_ports", "aws.open_database_ports"];
    const vs = keys.map((k) => verdict(scans, k));
    const ok = allPass(...vs);
    facts.push({
      key: "exposure",
      title: "Internet exposure",
      ok,
      statement:
        ok === true
          ? "No database, storage bucket or snapshot is publicly accessible, S3 Block Public Access is on account-wide, and no admin (SSH/RDP) or database port is open to the internet."
          : ok === false
            ? `Internet exposure has gaps: ${keys
                .filter((_, i) => vs[i] === "fail")
                .map((k) => EXPOSURE_GAP[k])
                .join("; ")}.`
            : unverified("Internet exposure", ...vs),
      proof: keys.map((k) => k.replace("aws.", "").replace(/_/g, " ")),
    });
  }

  // ----------------------------------------------------------- detection
  {
    const on = verdict(scans, "aws.guardduty_enabled");
    const open = verdict(scans, "aws.guardduty_findings");
    // No region in use means nothing for GuardDuty to watch — not "on everywhere".
    const inUse = scans.some((x) => x.regions.scanned.length > 0);
    const ok = inUse ? allPass(on, open) : null;
    facts.push({
      key: "detection",
      title: "Threat detection",
      ok,
      statement: !inUse
        ? "No region has running resources yet, so there is nothing for threat detection to watch."
        : ok === true
          ? "Amazon GuardDuty threat detection runs in every region in use, and no high-severity finding has been left open for more than a week."
          : ok === false
            ? `Threat detection has gaps: ${[on === "fail" ? "GuardDuty is off in a region in use" : null, open === "fail" ? "high-severity findings have been open over a week" : null].filter(Boolean).join("; ")}.`
            : unverified("Threat detection", on, open),
      proof: ["GuardDuty detectors per region", "GuardDuty findings with severity ≥ 7"],
    });
  }

  return { verifiedAt, accounts: scans.length, facts, regions, residency };
}

/** Facts from the last scan of every in-scope account (RLS: members of the company). */
export async function loadAwsFacts(db: SupabaseClient, companyId: string): Promise<AwsFacts | null> {
  const [{ data: umbrella }, { data: rows }] = await Promise.all([
    db.from("integrations").select("metadata").eq("company_id", companyId).eq("provider", "aws").maybeSingle(),
    db.from("aws_accounts").select("in_scope, account_id, alias, last_scan").eq("company_id", companyId),
  ]);
  if (!umbrella || !rows?.length) return null;
  const accounts = rows.map((r) => ({ scan: (r.last_scan as AccountScan | null) ?? null, inScope: r.in_scope as boolean }));
  const scans = accounts.filter((a) => a.inScope && a.scan).map((a) => a.scan!);
  if (!scans.length) return null;
  return awsFacts(scans, mergePeople(accounts), settingsFrom(umbrella.metadata));
}

/** The verified facts as prompt lines for questionnaire drafts and Co-Pilot. */
export function factsForPrompt(f: AwsFacts | null): string[] {
  if (!f) return [];
  const date = f.verifiedAt?.slice(0, 10) ?? "unknown";
  return [
    `AWS infrastructure facts, verified by ShieldFlow's read-only scan of ${f.accounts} production AWS ${f.accounts === 1 ? "account" : "accounts"} on ${date} (state them as verified only when marked VERIFIED): ` +
      f.facts.map((x) => `[${x.ok === true ? "VERIFIED" : x.ok === false ? "NOT MET" : "UNVERIFIED"}] ${x.title}: ${x.statement}`).join(" "),
  ];
}

/** The true facts only, for public pages: a claim that stops being true disappears. */
export function publishableFacts(f: AwsFacts): { verifiedAt: string | null; facts: { title: string; statement: string }[] } {
  return {
    verifiedAt: f.verifiedAt,
    facts: f.facts.filter((x) => x.ok === true && x.key !== "access").map((x) => ({ title: x.title, statement: x.statement })),
  };
}
