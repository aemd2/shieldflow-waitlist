/**
 * Shapes shared by the AWS scanner (collect → evaluate → scan).
 *
 * Every piece of collected data is a `Section`: either the data, or the reason we
 * couldn't get it. Evaluators never guess past a missing section — a check whose
 * input was denied, timed out or failed is `inconclusive` and says which, never a
 * false pass or fail.
 */

export type SectionFailure = {
  ok: false;
  reason: "denied" | "timeout" | "error";
  /** The AWS action that failed, e.g. "ec2:DescribeSecurityGroups". */
  action: string;
  message: string;
};
export type Section<T> = { ok: true; data: T } | SectionFailure;

export type Tags = Record<string, string>;

export interface CredentialRow {
  user: string;
  arn: string;
  createdAt: string | null;
  passwordEnabled: boolean;
  passwordLastUsed: string | null;
  mfaActive: boolean;
  keys: { active: boolean; lastRotated: string | null; lastUsed: string | null }[];
}

export interface PasswordPolicy {
  minimumLength: number | null;
  maxPasswordAge: number | null;
  reusePrevention: number | null;
}

export interface BlockPublicAccess {
  blockPublicAcls: boolean;
  ignorePublicAcls: boolean;
  blockPublicPolicy: boolean;
  restrictPublicBuckets: boolean;
}

export interface BucketInfo {
  name: string;
  region: string;
  policyPublic: boolean | null;
  aclPublic: boolean | null;
  bucketBpa: BlockPublicAccess | null;
  tags: Tags;
}

export interface TrailInfo {
  arn: string;
  name: string;
  homeRegion: string;
  multiRegion: boolean;
  organization: boolean;
  logging: boolean | null;
  logValidation: boolean;
  s3Bucket: string | null;
  /** Days the logs are kept: null = kept indefinitely, undefined = couldn't tell. */
  retentionDays: number | null | undefined;
  retentionSource: string;
}

export interface SecurityGroupInfo {
  id: string;
  name: string;
  vpcId: string | null;
  inUse: boolean;
  openAdminPorts: number[];
  openDbPorts: number[];
  allPortsOpen: boolean;
  tags: Tags;
}

export interface RdsInfo {
  id: string;
  kind: "instance" | "cluster";
  engine: string;
  engineVersion: string;
  instanceClass: string | null;
  encrypted: boolean;
  publiclyAccessible: boolean;
  backupRetentionDays: number;
  deletionProtection: boolean;
  /** "open-source-rds-extended-support" when the engine may run past standard support. */
  lifecycleSupport: string | null;
  /** Inside an Aurora cluster: reported on the cluster, not per instance. */
  clusterId: string | null;
  tags: Tags;
}

export interface EngineSupport {
  engine: string;
  major: string;
  standardEnd: string | null;
}

export interface LambdaInfo {
  name: string;
  runtime: string | null;
  urlAuth: "NONE" | "AWS_IAM" | null;
}

export interface EksInfo {
  name: string;
  version: string;
  supportType: string | null;
  versionStatus: string | null;
  standardEnd: string | null;
}

export interface GuardDutyInfo {
  enabled: boolean;
  oldHighFindings: { id: string; type: string; title: string; severity: number; updatedAt: string }[];
}

export interface KmsKeyInfo {
  id: string;
  alias: string | null;
  rotation: boolean;
}

export interface ImageScanInfo {
  repository: string;
  /** False when the latest image has no scan results (scan-on-push off, or never scanned). */
  scanned: boolean;
  critical: number;
  high: number;
  pushedAt: string | null;
}

export interface InspectorInfo {
  enabled: boolean;
  critical: number;
  high: number;
}

/** A restore that actually ran — the evidence that backups work, not just exist. */
export interface RestoreRecord {
  /** Restore job id, or the CloudTrail event id for a native RDS/DynamoDB restore. */
  id: string;
  accountId: string;
  region: string;
  /** "AWS Backup", "RDS" or "DynamoDB". */
  via: string;
  resourceType: string;
  /** What was restored from, when AWS says (snapshot, table, recovery point). */
  source: string | null;
  at: string;
  /** Run by an AWS Backup restore testing plan rather than by hand. */
  automated: boolean;
}

export interface BackupInfo {
  /** Resources with an AWS Backup recovery point. */
  protected: { arn: string; type: string; lastBackup: string | null }[];
  /** Completed AWS Backup restore jobs AWS still lists. */
  restores: RestoreRecord[];
  testingPlans: number;
  /** Where completed copy jobs (last 30 days) put backup copies. */
  copies: { resourceArn: string | null; region: string; accountId: string | null }[];
}

export interface RegionalPosture {
  ebsDefaultEncryption: Section<boolean>;
  unencryptedVolumes: Section<{ id: string; attached: boolean; tags: Tags }[]>;
  publicEbsSnapshots: Section<string[]>;
  publicAmis: Section<{ id: string; name: string }[]>;
  securityGroups: Section<SecurityGroupInfo[]>;
  rds: Section<RdsInfo[]>;
  engineSupport: Section<EngineSupport[]>;
  publicRdsSnapshots: Section<string[]>;
  dynamo: Section<{ name: string; pitr: boolean }[]>;
  lambda: Section<LambdaInfo[]>;
  eks: Section<EksInfo[]>;
  guardduty: Section<GuardDutyInfo>;
  kms: Section<KmsKeyInfo[]>;
  images: Section<ImageScanInfo[]>;
  inspector: Section<InspectorInfo>;
  vpcsWithoutFlowLogs: Section<string[]>;
  configRecording: Section<boolean>;
  securityHub: Section<boolean>;
  backup: Section<BackupInfo>;
  /** Counts for the asset inventory. */
  inventory: { instances: number; volumes: number; databases: number; functions: number; tables: number; clusters: number };
}

export interface AccountPosture {
  accountId: string;
  alias: string | null;
  scannedAt: string;
  durationMs: number;
  regions: {
    enabled: string[];
    active: string[];
    scanned: string[];
    /** Regions we meant to scan but couldn't finish, and why. */
    unscanned: { region: string; reason: string }[];
  };
  credentialReport: Section<CredentialRow[]>;
  passwordPolicy: Section<PasswordPolicy | null>;
  adminUsers: Section<{ user: string; via: string }[]>;
  accountBpa: Section<BlockPublicAccess | null>;
  buckets: Section<BucketInfo[]>;
  trails: Section<TrailInfo[]>;
  regional: Record<string, RegionalPosture>;
  /** IAM Identity Center as seen from this account; null data = no instance visible here. */
  identityCenter: Section<IdentityCenterInfo | null>;
  /** Whether this account belongs to an AWS Organization (and which is its management account). */
  organization: Section<{ managementAccountId: string } | null>;
  /**
   * Console and root changes since the last scan (in-scope accounts only; null =
   * not read). `readFrom` is how far back every region was read without a gap.
   */
  changes: Section<{ events: ChangeEvent[]; readFrom: string; until: string }> | null;
  /** Native RDS / DynamoDB restores from CloudTrail's 90-day history (null = not read). */
  nativeRestores: Section<RestoreRecord[]> | null;
}

// ------------------------------------------------------------------ people

/** One permission set (or IAM user) granting access to one account. */
export interface AwsAccessGrant {
  accountId: string;
  /** Permission set name, or "IAM user". */
  role: string;
  admin: boolean;
  /** "group Engineers" when it comes through a group; null when assigned directly. */
  via: string | null;
}

/** Someone who can sign in to AWS: an Identity Center user or an IAM user. */
export interface AwsIdentity {
  /** "sso:<userId>" or "iam:<account>:<userName>". */
  id: string;
  kind: "sso" | "iam";
  name: string;
  email: string | null;
  /** Can still sign in: Identity Center user enabled; IAM user with a password or an active key. */
  active: boolean;
  /** Signs in to the console (IAM: has a password; Identity Center: always). */
  console: boolean;
  /** Active access keys (IAM users only). */
  keys: number;
  /** IAM users only; Identity Center MFA is a setting AWS doesn't expose per user. */
  mfa: boolean | null;
  lastUsed: string | null;
  access: AwsAccessGrant[];
}

export interface IdentityCenterInfo {
  instanceArn: string;
  region: string;
  ownerAccountId: string | null;
  users: AwsIdentity[];
  /** More users or assignments than one scan reads. */
  truncated: boolean;
}

// ----------------------------------------------------------------- changes

/** A change made by hand in the console, or by root — never the request's contents. */
export interface ChangeEvent {
  eventId: string;
  accountId: string;
  region: string;
  at: string;
  name: string;
  source: string;
  principal: string | null;
  via: "console" | "root";
  resources: string | null;
}

// ------------------------------------------------------------------- facts

/** Where a copy of data lives, for the data-location facts. */
export interface DataStore {
  kind: "rds" | "aurora" | "dynamodb" | "s3" | "ebs" | "backup-copy" | "audit-logs";
  /** Resource name, or a count label for EBS ("12 volumes"). */
  id: string;
  accountId: string;
  region: string;
  encrypted: boolean | null;
  /** RDS retention days, DynamoDB PITR, or AWS Backup's last recovery point. */
  backup: string | null;
}

/** A resource named in a check result. `id` is stable and account-qualified. */
export interface AwsResource {
  id: string;
  label: string;
  region: string | null;
  accountId: string;
}

export type CheckArea =
  | "identity"
  | "logging"
  | "detection"
  | "exposure"
  | "encryption"
  | "patching"
  | "vulnerabilities"
  | "backups"
  | "changes"
  | "residency"
  | "hygiene";

export type Severity = "high" | "medium" | "low";

export interface AwsCheckResult {
  key: string;
  result: "pass" | "fail" | "inconclusive";
  detail: string;
  /** Failing resources not accepted as out of scope (capped). */
  resources: AwsResource[];
  failingCount: number;
  /** Resources excluded by a tag or a recorded exception, with the reason. */
  accepted: (AwsResource & { reason: string })[];
  /** Extra AWS spend this finding is costing, per month (estimate), if any. */
  costPerMonth?: number;
}

export interface AccountScan {
  accountId: string;
  alias: string | null;
  scannedAt: string;
  durationMs: number;
  regions: AccountPosture["regions"];
  results: AwsCheckResult[];
  inventory: { regions: string[]; buckets: number } & RegionalPosture["inventory"];
  /** Per region, for the data-location facts. */
  regionInventory?: Record<string, RegionalPosture["inventory"]>;
  /** IAM users of this account, plus Identity Center users if its instance lives here. */
  people?: {
    identities: AwsIdentity[];
    identityCenter: { region: string; instanceArn: string } | null;
    organization: { managementAccountId: string } | null;
    truncated: boolean;
    /** Why people couldn't be fully read, if they couldn't. */
    gaps: string[];
  };
  /** Restores seen so far, carried forward scan to scan (AWS forgets them after a while). */
  restores?: RestoreRecord[];
  /** Every data store and copy we found, with its region. */
  stores?: DataStore[];
  /** AWS Backup restore testing plans across the scanned regions. */
  restoreTestingPlans?: number;
  /** Console changes have been read without a gap from `from` up to `until`. */
  changesCoverage?: { from: string; until: string } | null;
}
