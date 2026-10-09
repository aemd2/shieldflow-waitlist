/**
 * Branch cases for lib/aws/evaluate.ts. Run with:  npx tsx lib/aws/checks.cases.ts
 *
 * Same reason as lib/identity-checks.cases.ts: the expensive bug is a check that
 * WRONGLY PASSES — "your databases are encrypted" when one region was never read.
 * Every "must NOT pass" case pins that down. Nothing imports this file.
 */

import { evaluateAccount, resourceId, type EvaluateOptions } from "@/lib/aws/evaluate";
import type { AccountPosture, AwsCheckResult, RegionalPosture, Section, SecurityGroupInfo } from "@/lib/aws/types";

const NOW = new Date("2026-10-09T12:00:00Z");
const ACCT = "123456789012";
const ok = <T,>(data: T): Section<T> => ({ ok: true, data });
const denied = (action: string): Section<never> => ({ ok: false, reason: "denied", action, message: `ShieldFlow's role isn't allowed ${action}.` });

function region(over: Partial<RegionalPosture> = {}): RegionalPosture {
  return {
    ebsDefaultEncryption: ok(true),
    unencryptedVolumes: ok([]),
    publicEbsSnapshots: ok([]),
    publicAmis: ok([]),
    securityGroups: ok([]),
    rds: ok([]),
    engineSupport: ok([]),
    publicRdsSnapshots: ok([]),
    dynamo: ok([]),
    lambda: ok([]),
    eks: ok([]),
    guardduty: ok({ enabled: true, oldHighFindings: [] }),
    kms: ok([]),
    images: ok([{ repository: "api", scanned: true, critical: 0, high: 1, pushedAt: "2026-10-01" }]),
    inspector: ok({ enabled: false, critical: 0, high: 0 }),
    vpcsWithoutFlowLogs: ok([]),
    configRecording: ok(false),
    securityHub: ok(false),
    inventory: { instances: 2, volumes: 2, databases: 1, functions: 0, tables: 0, clusters: 0 },
    ...over,
  };
}

function account(over: Partial<AccountPosture> = {}, regions: Record<string, RegionalPosture> = { "eu-central-1": region() }): AccountPosture {
  return {
    accountId: ACCT,
    alias: "acme-prod",
    scannedAt: NOW.toISOString(),
    durationMs: 1000,
    regions: { enabled: Object.keys(regions), active: Object.keys(regions), scanned: Object.keys(regions), unscanned: [] },
    credentialReport: ok([
      { user: "<root_account>", arn: "root", createdAt: "2023-01-01", passwordEnabled: true, passwordLastUsed: "2026-01-01", mfaActive: true, keys: [{ active: false, lastRotated: null, lastUsed: null }, { active: false, lastRotated: null, lastUsed: null }] },
      { user: "ci", arn: "u/ci", createdAt: "2025-01-01", passwordEnabled: false, passwordLastUsed: null, mfaActive: false, keys: [{ active: true, lastRotated: "2026-09-01", lastUsed: "2026-10-08" }, { active: false, lastRotated: null, lastUsed: null }] },
    ]),
    passwordPolicy: ok({ minimumLength: 14, maxPasswordAge: null, reusePrevention: 24 }),
    adminUsers: ok([]),
    accountBpa: ok({ blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: true, restrictPublicBuckets: true }),
    buckets: ok([{ name: "assets", region: "eu-central-1", policyPublic: false, aclPublic: false, bucketBpa: null, tags: {} }]),
    trails: ok([{ arn: "t", name: "main", homeRegion: "eu-central-1", multiRegion: true, organization: false, logging: true, logValidation: true, s3Bucket: "logs", retentionDays: null, retentionSource: "S3 bucket logs" }]),
    regional: regions,
    ...over,
  };
}

const opts = (o: Partial<EvaluateOptions> = {}): EvaluateOptions => ({ now: NOW, exceptions: [], logRetentionDays: 365, ...o });
const get = (rs: AwsCheckResult[], key: string) => {
  const r = rs.find((x) => x.key === key);
  if (!r) throw new Error(`no result for ${key}`);
  return r;
};

let failures = 0;
function expect(label: string, got: string | number, want: string | number) {
  const pass = got === want;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  -> ${got}${pass ? "" : ` (wanted ${want})`}`);
}

// ---------------------------------------------------------------- baseline
const clean = evaluateAccount(account(), opts());
const gating = clean.filter((r) => !["aws.vpc_flow_logs", "aws.config_recorder", "aws.security_hub", "aws.rds_deletion_protection"].includes(r.key));
expect("clean account: no gating check fails", gating.filter((r) => r.result === "fail").length, 0);
expect("clean account: no gating check inconclusive", gating.filter((r) => r.result === "inconclusive").length, 0);

// ------------------------------------------------------------- identity
const noMfa = account({
  credentialReport: ok([
    { user: "<root_account>", arn: "root", createdAt: "2023-01-01", passwordEnabled: true, passwordLastUsed: "2026-10-05", mfaActive: false, keys: [{ active: true, lastRotated: "2023-01-01", lastUsed: null }, { active: false, lastRotated: null, lastUsed: null }] },
    { user: "sam", arn: "u/sam", createdAt: "2024-01-01", passwordEnabled: true, passwordLastUsed: "2026-10-01", mfaActive: false, keys: [{ active: true, lastRotated: "2025-01-01", lastUsed: "2025-02-01" }, { active: false, lastRotated: null, lastUsed: null }] },
  ]),
});
const id = evaluateAccount(noMfa, opts());
expect("root without MFA fails", get(id, "aws.root_mfa").result, "fail");
expect("root access key fails", get(id, "aws.root_access_keys").result, "fail");
expect("root used 4 days ago flagged", get(id, "aws.root_recent_use").result, "fail");
expect("console user without MFA fails", get(id, "aws.iam_user_mfa").result, "fail");
expect("console user without MFA is named", get(id, "aws.iam_user_mfa").resources[0]?.label, "sam");
expect("key from 2025 is too old", get(id, "aws.access_key_age").result, "fail");
expect("key unused since Feb 2025 flagged", get(id, "aws.unused_credentials").result, "fail");

const reportDenied = evaluateAccount(account({ credentialReport: denied("iam:GenerateCredentialReport") }), opts());
expect("credential report denied -> root MFA must NOT pass", get(reportDenied, "aws.root_mfa").result, "inconclusive");
expect("credential report denied -> user MFA must NOT pass", get(reportDenied, "aws.iam_user_mfa").result, "inconclusive");
console.log(`      detail: ${get(reportDenied, "aws.iam_user_mfa").detail}`);

expect("no password policy fails", get(evaluateAccount(account({ passwordPolicy: ok(null) }), opts()), "aws.password_policy").result, "fail");

// -------------------------------------------------------------- logging
const noTrail = evaluateAccount(account({ trails: ok([]) }), opts());
expect("no trail fails", get(noTrail, "aws.cloudtrail_enabled").result, "fail");
expect("no trail -> retention fails", get(noTrail, "aws.log_retention").result, "fail");
const stopped = evaluateAccount(account({ trails: ok([{ arn: "t", name: "main", homeRegion: "eu-central-1", multiRegion: true, organization: false, logging: false, logValidation: false, s3Bucket: "logs", retentionDays: 30, retentionSource: "S3 bucket logs" }]) }), opts());
expect("stopped trail fails", get(stopped, "aws.cloudtrail_enabled").result, "fail");
expect("stopped trail named", get(stopped, "aws.cloudtrail_enabled").resources[0]?.label, "main");
const shortLogs = evaluateAccount(account({ trails: ok([{ arn: "t", name: "main", homeRegion: "eu-central-1", multiRegion: true, organization: false, logging: true, logValidation: true, s3Bucket: "logs", retentionDays: 90, retentionSource: "S3 bucket logs" }]) }), opts());
expect("90-day logs vs 365-day policy fails", get(shortLogs, "aws.log_retention").result, "fail");
expect("90-day logs pass a 90-day policy", get(evaluateAccount(account({ trails: ok([{ arn: "t", name: "main", homeRegion: "eu-central-1", multiRegion: true, organization: false, logging: true, logValidation: true, s3Bucket: "logs", retentionDays: 90, retentionSource: "S3" }]) }), opts({ logRetentionDays: 90 })), "aws.log_retention").result, "pass");
const orgBucket = evaluateAccount(account({ trails: ok([{ arn: "t", name: "org", homeRegion: "eu-central-1", multiRegion: true, organization: true, logging: true, logValidation: true, s3Bucket: "archive", retentionDays: undefined, retentionSource: "S3 bucket archive (not readable from this account)" }]) }), opts());
expect("log bucket in another account -> retention must NOT pass", get(orgBucket, "aws.log_retention").result, "inconclusive");

// ------------------------------------------------------------- exposure
const sgOpen = region({
  securityGroups: ok<SecurityGroupInfo[]>([
    { id: "sg-1", name: "web", vpcId: "v", inUse: true, openAdminPorts: [22], openDbPorts: [], allPortsOpen: false, tags: {} },
    { id: "sg-2", name: "old", vpcId: "v", inUse: false, openAdminPorts: [22], openDbPorts: [], allPortsOpen: false, tags: {} },
    { id: "sg-3", name: "bastion", vpcId: "v", inUse: true, openAdminPorts: [22], openDbPorts: [], allPortsOpen: false, tags: { "shieldflow:scope": "out" } },
  ]),
});
const exp = evaluateAccount(account({}, { "eu-central-1": sgOpen }), opts());
const ssh = get(exp, "aws.open_admin_ports");
expect("SSH open on an attached group fails", ssh.result, "fail");
expect("only the attached, untagged group counts", ssh.failingCount, 1);
expect("unattached + tagged groups are accepted", ssh.accepted.length, 2);

const sgId = resourceId(ACCT, "eu-central-1", "security-group", "sg-1");
const excepted = evaluateAccount(account({}, { "eu-central-1": sgOpen }), opts({ exceptions: [{ checkKey: "aws.open_admin_ports", resourceId: sgId, reason: "IP-restricted at the NACL", expiresAt: null }] }));
expect("an exception turns it into a pass", get(excepted, "aws.open_admin_ports").result, "pass");
const expired = evaluateAccount(account({}, { "eu-central-1": sgOpen }), opts({ exceptions: [{ checkKey: "aws.open_admin_ports", resourceId: sgId, reason: "temporary", expiresAt: "2026-09-01" }] }));
expect("an expired exception no longer counts", get(expired, "aws.open_admin_ports").result, "fail");

const publicBucket = account({ buckets: ok([{ name: "dump", region: "eu-central-1", policyPublic: true, aclPublic: false, bucketBpa: null, tags: {} }]), accountBpa: ok(null) });
const pb = evaluateAccount(publicBucket, opts());
expect("public bucket without account BPA fails", get(pb, "aws.s3_public_buckets").result, "fail");
expect("account BPA off fails", get(pb, "aws.s3_account_public_access_block").result, "fail");
const blocked = account({ buckets: ok([{ name: "dump", region: "eu-central-1", policyPublic: true, aclPublic: false, bucketBpa: null, tags: {} }]) });
expect("account BPA neutralises a public policy", get(evaluateAccount(blocked, opts()), "aws.s3_public_buckets").result, "pass");
const bpaUnknown = account({ accountBpa: denied("s3:GetAccountPublicAccessBlock"), buckets: ok([{ name: "dump", region: "eu-central-1", policyPublic: true, aclPublic: false, bucketBpa: null, tags: {} }]) });
expect("public policy + unreadable account BPA -> must NOT pass", get(evaluateAccount(bpaUnknown, opts()), "aws.s3_public_buckets").result, "inconclusive");

// ----------------------------------------------------- regions & gaps
const half = account(
  { regions: { enabled: ["eu-central-1", "us-east-1"], active: ["eu-central-1", "us-east-1"], scanned: ["eu-central-1"], unscanned: [{ region: "us-east-1", reason: "scan time ran out" }] } },
  { "eu-central-1": region() },
);
const halfRes = evaluateAccount(half, opts());
expect("unscanned region -> encryption must NOT pass", get(halfRes, "aws.rds_encrypted").result, "inconclusive");
console.log(`      detail: ${get(halfRes, "aws.rds_encrypted").detail}`);

const failPlusGap = account(
  { regions: { enabled: ["eu-central-1", "us-east-1"], active: ["eu-central-1", "us-east-1"], scanned: ["eu-central-1"], unscanned: [{ region: "us-east-1", reason: "scan time ran out" }] } },
  { "eu-central-1": region({ ebsDefaultEncryption: ok(false) }) },
);
expect("a real failure still fails despite another region's gap", get(evaluateAccount(failPlusGap, opts()), "aws.ebs_default_encryption").result, "fail");

const sgDenied = evaluateAccount(account({}, { "eu-central-1": region({ securityGroups: denied("ec2:DescribeSecurityGroups") }) }), opts());
expect("security groups denied -> must NOT pass", get(sgDenied, "aws.open_admin_ports").result, "inconclusive");
console.log(`      detail: ${get(sgDenied, "aws.open_admin_ports").detail}`);

// -------------------------------------------------------------- patching
const oldStuff = region({
  lambda: ok([
    { name: "legacy-cron", runtime: "nodejs18.x", urlAuth: null },
    { name: "webhook", runtime: "python3.12", urlAuth: "NONE" },
    { name: "container-fn", runtime: null, urlAuth: null },
  ]),
  rds: ok([
    { id: "main-db", kind: "instance", engine: "mysql", engineVersion: "5.7.44", instanceClass: "db.m5.large", encrypted: true, publiclyAccessible: false, backupRetentionDays: 7, deletionProtection: true, lifecycleSupport: "open-source-rds-extended-support", clusterId: null, tags: {} },
  ]),
  engineSupport: ok([{ engine: "mysql", major: "5.7", standardEnd: "2024-02-29T00:00:00Z" }]),
  eks: ok([{ name: "prod", version: "1.28", supportType: "EXTENDED", versionStatus: "EXTENDED_SUPPORT", standardEnd: "2025-11-26T00:00:00Z" }]),
});
const pat = evaluateAccount(account({}, { "eu-central-1": oldStuff }), opts());
expect("nodejs18.x is past deprecation", get(pat, "aws.lambda_runtimes").result, "fail");
expect("only the deprecated function is flagged", get(pat, "aws.lambda_runtimes").failingCount, 1);
expect("public function URL fails", get(pat, "aws.lambda_public_urls").result, "fail");
const engine = get(pat, "aws.rds_engine_support");
expect("MySQL 5.7 past standard support fails", engine.result, "fail");
expect("Extended Support cost estimated (2 vCPU, year 3: $0.20)", engine.costPerMonth ?? 0, Math.round(2 * 0.2 * 730));
console.log(`      detail: ${engine.detail}`);
expect("EKS in extended support costs ~$365/month", get(pat, "aws.eks_version_support").costPerMonth ?? 0, 365);

// ------------------------------------------------------- vulnerabilities
const noImages = evaluateAccount(account({}, { "eu-central-1": region({ images: ok([]) }) }), opts());
expect("nothing scannable -> vuln check must NOT pass", get(noImages, "aws.image_vulnerabilities").result, "inconclusive");
const unscannedImage = evaluateAccount(account({}, { "eu-central-1": region({ images: ok([{ repository: "api", scanned: false, critical: 0, high: 0, pushedAt: null }]) }) }), opts());
expect("image never scanned -> must NOT pass", get(unscannedImage, "aws.image_vulnerabilities").result, "inconclusive");
const critical = evaluateAccount(account({}, { "eu-central-1": region({ images: ok([{ repository: "api", scanned: true, critical: 3, high: 9, pushedAt: "2026-10-01" }]) }) }), opts());
expect("critical CVEs in the latest image fail", get(critical, "aws.image_vulnerabilities").result, "fail");

// --------------------------------------------------------------- backups
const aurora = region({
  rds: ok([
    { id: "aurora-1", kind: "cluster", engine: "aurora-postgresql", engineVersion: "15.4", instanceClass: null, encrypted: false, publiclyAccessible: false, backupRetentionDays: 1, deletionProtection: false, lifecycleSupport: null, clusterId: null, tags: {} },
    { id: "aurora-1-a", kind: "instance", engine: "aurora-postgresql", engineVersion: "15.4", instanceClass: "db.r6g.large", encrypted: false, publiclyAccessible: false, backupRetentionDays: 1, deletionProtection: false, lifecycleSupport: null, clusterId: "aurora-1", tags: {} },
  ]),
});
const au = evaluateAccount(account({}, { "eu-central-1": aurora }), opts());
expect("Aurora: counted once, on the cluster (encryption)", get(au, "aws.rds_encrypted").failingCount, 1);
expect("Aurora: counted once, on the cluster (backups)", get(au, "aws.rds_backups").failingCount, 1);

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
