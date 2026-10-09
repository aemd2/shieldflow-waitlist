/**
 * Branch cases for lib/aws/evaluate.ts. Run with:  npx tsx lib/aws/checks.cases.ts
 *
 * Same reason as lib/identity-checks.cases.ts: the expensive bug is a check that
 * WRONGLY PASSES — "your databases are encrypted" when one region was never read.
 * Every "must NOT pass" case pins that down. Nothing imports this file.
 */

import { evaluateAccount, resourceId, type EvaluateOptions } from "@/lib/aws/evaluate";
import { toChange, toRestore } from "@/lib/aws/cloudtrail";
import { inlineIsAdmin } from "@/lib/aws/people";
import { addressesFor, awsRosters, mergePeople, peopleBlindSpot } from "@/lib/aws/roster";
import { dataStores } from "@/lib/aws/stores";
import { awsFacts, publishableFacts } from "@/lib/aws/facts";
import { mergeRestores, nextCoverage } from "@/lib/aws/scan";
import type {
  AccountPosture,
  AccountScan,
  AwsCheckResult,
  AwsIdentity,
  ChangeEvent,
  RegionalPosture,
  RestoreRecord,
  Section,
  SecurityGroupInfo,
} from "@/lib/aws/types";

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
    backup: ok({ protected: [], restores: [], testingPlans: 0, copies: [] }),
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
    identityCenter: ok(null),
    organization: ok(null),
    changes: null,
    nativeRestores: null,
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

// -------------------------------------------------------- restore tests
const withDb = region({
  rds: ok([{ id: "main-db", kind: "instance", engine: "postgres", engineVersion: "16.3", instanceClass: "db.t4g.medium", encrypted: true, publiclyAccessible: false, backupRetentionDays: 14, deletionProtection: true, lifecycleSupport: null, clusterId: null, tags: {} }]),
});
const restore = (at: string, account = ACCT): RestoreRecord => ({ id: `r-${at}-${account}`, accountId: account, region: "eu-central-1", via: "RDS", resourceType: "RDS database", source: "main-db", at, automated: false });
expect("no data stores -> restore test passes on nothing", get(clean, "aws.restore_tested").result, "pass");
const untested = evaluateAccount(account({}, { "eu-central-1": withDb }), opts());
expect("a database never restored fails", get(untested, "aws.restore_tested").result, "fail");
console.log(`      detail: ${get(untested, "aws.restore_tested").detail}`);
expect("restored 30 days ago passes", get(evaluateAccount(account({}, { "eu-central-1": withDb }), opts({ restores: [restore("2026-09-09T10:00:00Z")] })), "aws.restore_tested").result, "pass");
expect("restored 400 days ago fails a yearly policy", get(evaluateAccount(account({}, { "eu-central-1": withDb }), opts({ restores: [restore("2025-09-05T10:00:00Z")] })), "aws.restore_tested").result, "fail");
expect("a restore in another account doesn't count", get(evaluateAccount(account({}, { "eu-central-1": withDb }), opts({ restores: [restore("2026-09-09T10:00:00Z", "999999999999")] })), "aws.restore_tested").result, "fail");
const blindRestores = evaluateAccount(account({}, { "eu-central-1": region({ ...withDb, backup: denied("backup:ListProtectedResources") }) }), opts());
expect("restore sources unreadable -> must NOT fail or pass", get(blindRestores, "aws.restore_tested").result, "inconclusive");
const viaTrail = evaluateAccount(
  account({ nativeRestores: ok([]) }, { "eu-central-1": region({ ...withDb, backup: denied("backup:ListProtectedResources") }) }),
  opts(),
);
expect("CloudTrail readable, AWS Backup not -> a real fail", get(viaTrail, "aws.restore_tested").result, "fail");

// ------------------------------------------------------------ residency
expect("no residency commitment -> no residency check", clean.some((r) => r.key === "aws.data_residency") ? "present" : "absent", "absent");
expect("all in Frankfurt passes EU residency", get(evaluateAccount(account(), opts({ residency: "eu" })), "aws.data_residency").result, "pass");
const virginia = account({ buckets: ok([{ name: "exports", region: "us-east-1", policyPublic: false, aclPublic: false, bucketBpa: null, tags: {} }]) });
const res = get(evaluateAccount(virginia, opts({ residency: "eu" })), "aws.data_residency");
expect("a bucket in us-east-1 breaks EU residency", res.result, "fail");
expect("the bucket and its region are named", res.resources[0]?.label, "S3 bucket exports in us-east-1");
const london = account({ buckets: ok([{ name: "uk", region: "eu-west-2", policyPublic: false, aclPublic: false, bucketBpa: null, tags: {} }]) });
expect("London is not in the EU", get(evaluateAccount(london, opts({ residency: "eu" })), "aws.data_residency").result, "fail");
expect("London is in Europe", get(evaluateAccount(london, opts({ residency: "europe" })), "aws.data_residency").result, "pass");
const copyOut = account({}, { "eu-central-1": region({ backup: ok({ protected: [], restores: [], testingPlans: 0, copies: [{ resourceArn: "arn:aws:rds:eu-central-1:1:db:main-db", region: "us-east-1", accountId: null }] }) }) });
expect("a backup copied to Virginia breaks EU residency", get(evaluateAccount(copyOut, opts({ residency: "eu" })), "aws.data_residency").result, "fail");
const rdsBlind = account({}, { "eu-central-1": region({ rds: denied("rds:DescribeDBInstances") }) });
expect("databases unreadable -> residency must NOT pass", get(evaluateAccount(rdsBlind, opts({ residency: "eu" })), "aws.data_residency").result, "inconclusive");

// -------------------------------------------------------------- changes
const change: ChangeEvent = { eventId: "e-1", accountId: ACCT, region: "eu-central-1", at: "2026-10-08T09:30:00Z", name: "AuthorizeSecurityGroupIngress", source: "ec2", principal: "jane@acme.com (AdministratorAccess)", via: "console", resources: "sg-1" };
expect("out of scope -> no manual-change check", clean.some((r) => r.key === "aws.manual_changes") ? "present" : "absent", "absent");
expect("no console changes passes", get(evaluateAccount(account(), opts({ recentChanges: [] })), "aws.manual_changes").result, "pass");
const changed = get(evaluateAccount(account(), opts({ recentChanges: [change] })), "aws.manual_changes");
expect("a console change is listed", changed.result, "fail");
console.log(`      resource: ${changed.resources[0]?.label}`);
expect("change history unreadable -> must NOT pass", get(evaluateAccount(account(), opts({ recentChanges: null })), "aws.manual_changes").result, "inconclusive");
const recorded = evaluateAccount(account(), opts({ recentChanges: [change], exceptions: [{ checkKey: "aws.manual_changes", resourceId: resourceId(ACCT, "eu-central-1", "change", "e-1"), reason: "incident #12 break-glass", expiresAt: null }] }));
expect("a change with a recorded reason is accepted", get(recorded, "aws.manual_changes").result, "pass");

// ----------------------------------------------------- CloudTrail parsing
const ev = (rec: Record<string, unknown>) => ({ CloudTrailEvent: JSON.stringify({ eventID: "x", eventTime: "2026-10-08T09:30:00Z", eventName: "PutBucketPolicy", eventSource: "s3.amazonaws.com", ...rec }), Resources: [{ ResourceName: "exports" }] });
const sso = { type: "AssumedRole", arn: "arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_AdministratorAccess_0123456789abcdef/jane@acme.com" };
expect("console change is kept", toChange(ev({ sessionCredentialFromConsole: "true", userIdentity: sso }), ACCT, "eu-central-1")?.via ?? "none", "console");
expect("SSO principal reads as person + permission set", toChange(ev({ sessionCredentialFromConsole: "true", userIdentity: sso }), ACCT, "eu-central-1")?.principal ?? "none", "jane@acme.com (AdministratorAccess)");
expect("pipeline change (no console session) is dropped", toChange(ev({ userIdentity: { type: "AssumedRole", arn: "arn:aws:sts::1:assumed-role/github-deploy/run-42" } }), ACCT, "eu-central-1") ? "kept" : "dropped", "dropped");
expect("failed call is dropped", toChange(ev({ sessionCredentialFromConsole: "true", errorCode: "AccessDenied", userIdentity: sso }), ACCT, "eu-central-1") ? "kept" : "dropped", "dropped");
expect("console sign-in is not a change", toChange(ev({ eventName: "ConsoleLogin", eventSource: "signin.amazonaws.com", sessionCredentialFromConsole: "true", userIdentity: sso }), ACCT, "us-east-1") ? "kept" : "dropped", "dropped");
expect("root activity is kept", toChange(ev({ userIdentity: { type: "Root", arn: "arn:aws:iam::1:root" } }), ACCT, "us-east-1")?.via ?? "none", "root");
expect("restore source is the snapshot name", toRestore({ CloudTrailEvent: JSON.stringify({ eventID: "r", eventTime: "2026-09-01T00:00:00Z", eventSource: "rds.amazonaws.com", requestParameters: { dBSnapshotIdentifier: "nightly-2026-08-31", dBInstanceIdentifier: "restore-test" } }) }, ACCT, "eu-central-1", "RDS database")?.source ?? "none", "nightly-2026-08-31");

// ---------------------------------------------------------------- people
const staff = [
  { name: "Jane Doe", email: "jane@acme.com" },
  { name: "Sam Lee", email: "sam@acme.com" },
  { name: "Sam Park", email: "spark@acme.com" },
];
const iamUser = (name: string): AwsIdentity => ({ id: `iam:${ACCT}:${name}`, kind: "iam", name, email: null, active: true, console: true, keys: 0, mfa: true, lastUsed: null, access: [] });
expect("IAM user 'jane' is Jane", addressesFor(iamUser("jane"), staff).join(), "jane@acme.com");
expect("IAM user 'jane.doe' is Jane by name", addressesFor(iamUser("jane.doe"), staff).join(), "jane@acme.com");
expect("IAM user 'sam' is the one sam@ address", addressesFor(iamUser("sam"), staff).join() || "none", "sam@acme.com");
const twoAlexes = [{ name: "Alex", email: "alex.k@acme.com" }, { name: "Alex Brown", email: "alex@acme.com" }];
expect("IAM user 'alex' fits two people -> no guess", addressesFor(iamUser("alex"), twoAlexes).join() || "none", "none");
expect("IAM user 'samlee' matches Sam Lee only", addressesFor(iamUser("samlee"), staff).join(), "sam@acme.com");
expect("an email username matches itself", addressesFor(iamUser("Ops@Acme.com"), staff).join(), "ops@acme.com");
expect("inline *:* is admin", inlineIsAdmin(JSON.stringify({ Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }] })) ? "admin" : "not", "admin");
expect("inline read-only is not admin", inlineIsAdmin(JSON.stringify({ Statement: [{ Effect: "Allow", Action: ["s3:Get*"], Resource: "*" }] })) ? "admin" : "not", "not");

const scanWith = (accountId: string, identities: AwsIdentity[], extra: Partial<NonNullable<AccountScan["people"]>> = {}): AccountScan => ({
  accountId, alias: null, scannedAt: NOW.toISOString(), durationMs: 1, regions: { enabled: [], active: [], scanned: [], unscanned: [] }, results: [],
  inventory: { regions: [], buckets: 0, instances: 0, volumes: 0, databases: 0, functions: 0, tables: 0, clusters: 0 },
  people: { identities, identityCenter: null, organization: null, truncated: false, gaps: [], ...extra },
});
const ssoUser: AwsIdentity = { id: "sso:u1", kind: "sso", name: "Jane Doe", email: "jane@acme.com", active: true, console: true, keys: 0, mfa: null, lastUsed: null, access: [{ accountId: "111111111111", role: "AdministratorAccess", admin: true, via: null }] };
const merged = mergePeople([
  { scan: scanWith("111111111111", [iamUser("deploy-bot")]), inScope: true },
  { scan: scanWith("222222222222", [ssoUser, iamUser("dev-only")], { identityCenter: { region: "eu-central-1", instanceArn: "i" } }), inScope: false },
]);
expect("Identity Center users count even from an out-of-scope account", merged?.identities.some((i) => i.id === "sso:u1") ? "yes" : "no", "yes");
expect("IAM users of out-of-scope accounts don't", merged?.identities.some((i) => i.name === "dev-only") ? "yes" : "no", "no");
expect("Identity Center seen", merged?.identityCenter ?? "null", "seen");
const orgBlind = mergePeople([{ scan: scanWith("111111111111", [], { organization: { managementAccountId: "999999999999" } }), inScope: true }]);
expect("org management account not connected -> Identity Center elsewhere", orgBlind?.identityCenter ?? "null", "elsewhere");
expect("...and the blind spot is spelled out", peopleBlindSpot(orgBlind!) ? "said" : "silent", "said");
const failedAcct = mergePeople([{ scan: scanWith("111111111111", []), inScope: true }, { scan: null, inScope: true, error: "role rejected", label: "prod" }]);
expect("an unscanned account is a gap", failedAcct?.gaps.length ?? 0, 1);
const machine: AwsIdentity = { ...iamUser("ci"), console: false, keys: 1 };
const ro = awsRosters({ identities: [ssoUser, iamUser("jane"), machine], identityCenter: "seen", truncated: false, gaps: [], inScope: [] }, staff);
expect("machine users are not in the humans roster", ro.humans.length, 2);
expect("but leavers are looked for in everything", ro.all.length, 3);

// ----------------------------------------------------- stores & memory
const st = dataStores(account({ trails: ok([{ arn: "t", name: "main", homeRegion: "eu-central-1", multiRegion: true, organization: false, logging: true, logValidation: true, s3Bucket: "assets", retentionDays: null, retentionSource: "S3" }]) }, { "eu-central-1": aurora }));
expect("Aurora is one store", st.filter((s) => s.kind === "aurora" || s.kind === "rds").length, 1);
expect("the trail's bucket is audit logs", st.find((s) => s.id === "assets")?.kind ?? "none", "audit-logs");
const mem = mergeRestores([restore("2025-01-01T00:00:00Z"), restore("2026-09-01T00:00:00Z")], [restore("2026-09-01T00:00:00Z"), restore("2026-10-01T00:00:00Z")], NOW);
expect("restores: deduplicated, ancient ones forgotten", mem.length, 2);
const since = new Date("2026-10-08T11:00:00Z");
expect(
  "coverage extends when the read joins up",
  nextCoverage({ from: "2026-09-09T00:00:00Z", until: "2026-10-08T12:00:00Z" }, { ok: true, data: { events: [], readFrom: since.toISOString(), until: NOW.toISOString() } }, since)?.from ?? "null",
  "2026-09-09T00:00:00Z",
);
expect(
  "coverage restarts after a truncated read",
  nextCoverage({ from: "2026-09-09T00:00:00Z", until: "2026-10-08T12:00:00Z" }, { ok: true, data: { events: [], readFrom: "2026-10-09T06:00:00.000Z", until: NOW.toISOString() } }, since)?.from ?? "null",
  "2026-10-09T06:00:00.000Z",
);

// ----------------------------------------------------------------- facts
const toScan = (p: AccountPosture, o: Partial<EvaluateOptions> = {}): AccountScan => ({
  accountId: p.accountId, alias: p.alias, scannedAt: NOW.toISOString(), durationMs: 1, regions: p.regions,
  results: evaluateAccount(p, opts(o)),
  inventory: { regions: p.regions.scanned, buckets: 0, instances: 0, volumes: 0, databases: 0, functions: 0, tables: 0, clusters: 0 },
  stores: dataStores(p),
  restores: o.restores ?? [],
});
const settings = { residency: null, logRetentionDays: 365, restoreTestDays: 365 } as const;
const emptyAcct = account({ buckets: ok([]), trails: ok([]) }, {});
const emptyFacts = awsFacts([toScan(emptyAcct)], null, settings);
const fact = (f: ReturnType<typeof awsFacts>, key: string) => f.facts.find((x) => x.key === key)!;
expect("empty account: no encryption claim", String(fact(emptyFacts, "encryption").ok), "null");
expect("empty account: no backup claim", String(fact(emptyFacts, "backups").ok), "null");
expect("empty account: no threat-detection claim", String(fact(emptyFacts, "detection").ok), "null");
expect("empty account: nothing vacuous is published", publishableFacts(emptyFacts).facts.filter((f) => /Encryption|Backups|Threat/.test(f.title)).length, 0);
const dbAcct = account({}, { "eu-central-1": region({ ...withDb, inventory: { instances: 0, volumes: 0, databases: 1, functions: 0, tables: 0, clusters: 0 } }) });
const dbFacts = awsFacts([toScan(dbAcct, { restores: [restore("2026-09-09T10:00:00Z")] })], null, settings);
expect("encryption sentence reads right", fact(dbFacts, "encryption").statement, "All data at rest is encrypted: the database is encrypted with AWS KMS, and S3 encrypts everything by default.");
expect("location names the city", fact(dbFacts, "location").statement.includes("Frankfurt, Germany (eu-central-1)") ? "yes" : "no", "yes");
expect("backups fact mentions the restore test", fact(dbFacts, "backups").statement.includes("2026-09-09") ? "yes" : "no", "yes");
const usFacts = awsFacts([toScan(virginia, { residency: "eu" })], null, { ...settings, residency: "eu" });
expect("a Virginia bucket makes the EU location fact false", String(fact(usFacts, "location").ok), "false");
expect("...and it is never published", publishableFacts(usFacts).facts.some((f) => f.title === "Where data is stored") ? "published" : "hidden", "hidden");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
