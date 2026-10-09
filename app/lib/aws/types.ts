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
}
