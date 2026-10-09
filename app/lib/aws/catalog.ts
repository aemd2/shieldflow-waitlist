import type { CheckArea, Severity } from "@/lib/aws/types";

/**
 * Every AWS check, in one place: what it's called, why it matters in one plain
 * sentence, how bad a failure is, which requirements it proves, the exact
 * read-only API calls it makes (published as the public check catalogue), and
 * the fix — Terraform first, because the people who run these accounts write
 * Terraform.
 *
 * `informational` checks are shown but never gate a measure or raise a dashboard
 * alert: useful, but either they cost the customer money (Flow Logs, Config,
 * Security Hub) or they're judgement calls a small team shouldn't be nagged into.
 *
 * Fix templates use {id} (resource), {region}, {account}.
 */

export interface AwsFix {
  terraform?: string;
  cli?: string;
  console: string;
  /** What the fix itself costs in AWS, when it isn't free. */
  cost?: string;
}

export interface AwsCheckDef {
  key: string;
  title: string;
  area: CheckArea;
  severity: Severity;
  informational?: boolean;
  why: string;
  controlCodes: string[];
  apiCalls: string[];
  fix: AwsFix;
}

const MFA = ["CC6.1", "A.8.5", "164.312(d)", "164.312(a)(1)", "Req 8", "Art. 32"];
const PASSWORD = ["CC6.1", "A.8.5", "164.312(a)(1)", "Req 8"];
const IDENTITY = ["CC6.1", "CC6.2", "A.5.16", "A.5.18", "A.8.5", "164.308(a)(4)", "Req 8"];
const LEAST_PRIV = ["CC6.1", "CC6.3", "A.5.15", "A.8.2", "164.308(a)(4)", "Req 7"];
const LOGGING = ["CC7.2", "CC7.3", "A.8.15", "164.312(b)", "Req 10", "Art. 32"];
const DETECTION = ["CC7.2", "CC7.3", "A.8.16", "164.308(a)(1)", "Req 10"];
const EXPOSURE = ["CC6.1", "CC6.6", "A.8.20", "A.8.22", "Req 1", "Art. 32"];
const ENCRYPT_REST = ["CC6.1", "CC6.7", "A.8.24", "164.312(a)(2)(iv)", "Req 3", "Art. 32"];
const PATCHING = ["CC7.1", "CC8.1", "A.8.8", "Req 6"];
const VULN = ["CC7.1", "A.8.8", "Req 6", "Req 11"];
const BACKUP = ["A1.2", "A1.3", "A.8.13", "164.308(a)(7)"];

export const AWS_CHECKS: AwsCheckDef[] = [
  // ------------------------------------------------------------- identity
  {
    key: "aws.root_mfa",
    title: "Root account has MFA",
    area: "identity",
    severity: "high",
    why: "The root user can do anything, including closing the account; a password alone shouldn't be enough.",
    controlCodes: MFA,
    apiCalls: ["iam:GenerateCredentialReport", "iam:GetCredentialReport"],
    fix: {
      console: "Sign in as root → account menu → Security credentials → Multi-factor authentication → Assign MFA device. A hardware key held by two people is best.",
    },
  },
  {
    key: "aws.root_access_keys",
    title: "Root account has no access keys",
    area: "identity",
    severity: "high",
    why: "A root access key is a permanent all-powerful credential; if it leaks, nothing in the account is safe.",
    controlCodes: IDENTITY,
    apiCalls: ["iam:GetCredentialReport"],
    fix: {
      console: "Sign in as root → Security credentials → Access keys → Deactivate, then Delete each key. Use IAM roles for automation instead.",
    },
  },
  {
    key: "aws.root_recent_use",
    title: "Root account not used day to day",
    area: "identity",
    severity: "high",
    informational: true,
    why: "Root should only be used for the handful of tasks that need it; regular use means someone is working with no guardrails.",
    controlCodes: [],
    apiCalls: ["iam:GetCredentialReport"],
    fix: {
      console: "Give people their own access through IAM Identity Center and keep root for break-glass only. Review what root was used for in CloudTrail (userIdentity.type = Root).",
    },
  },
  {
    key: "aws.iam_user_mfa",
    title: "Every IAM user with a console password has MFA",
    area: "identity",
    severity: "high",
    why: "A console login without MFA is one phished password away from your production account.",
    controlCodes: MFA,
    apiCalls: ["iam:GetCredentialReport"],
    fix: {
      cli: "aws iam create-virtual-mfa-device --virtual-mfa-device-name {id} --outfile {id}-qr.png --bootstrap-method QRCodePNG",
      console: "IAM → Users → {id} → Security credentials → Assign MFA device. Better: move people to IAM Identity Center and remove console passwords from IAM users.",
    },
  },
  {
    key: "aws.access_key_age",
    title: "Access keys rotated within 90 days",
    area: "identity",
    severity: "medium",
    why: "Long-lived keys end up in laptops, CI logs and old repos; rotating them limits how long a leaked key works.",
    controlCodes: IDENTITY,
    apiCalls: ["iam:GetCredentialReport"],
    fix: {
      cli: "aws iam create-access-key --user-name {id}\n# switch the workload to the new key, then:\naws iam update-access-key --user-name {id} --access-key-id <OLD_KEY_ID> --status Inactive",
      console: "IAM → Users → {id} → Security credentials → Create access key, move the workload over, then deactivate and delete the old key. Better: replace the key with an IAM role (OIDC for CI).",
    },
  },
  {
    key: "aws.unused_credentials",
    title: "No credentials unused for 90+ days",
    area: "identity",
    severity: "low",
    why: "A password or key nobody uses is pure risk: it can be stolen and nobody would notice it being used.",
    controlCodes: IDENTITY,
    apiCalls: ["iam:GetCredentialReport"],
    fix: {
      cli: "aws iam delete-login-profile --user-name {id}   # unused console password\naws iam update-access-key --user-name {id} --access-key-id <KEY_ID> --status Inactive",
      console: "IAM → Users → {id} → Security credentials: remove the console password or deactivate the key. If the user belongs to someone who left, delete the user.",
    },
  },
  {
    key: "aws.password_policy",
    title: "IAM password policy is set",
    area: "identity",
    severity: "low",
    why: "Without a policy, IAM users can set any password at all.",
    controlCodes: PASSWORD,
    apiCalls: ["iam:GetAccountPasswordPolicy"],
    fix: {
      terraform: 'resource "aws_iam_account_password_policy" "this" {\n  minimum_password_length      = 14\n  password_reuse_prevention    = 24\n  allow_users_to_change_password = true\n}',
      cli: "aws iam update-account-password-policy --minimum-password-length 14 --password-reuse-prevention 24 --allow-users-to-change-password",
      console: "IAM → Account settings → Password policy → Edit: minimum length 14, prevent reuse. Current NIST guidance: no forced expiry, no composition rules.",
    },
  },
  {
    key: "aws.admin_users",
    title: "No IAM users with full admin rights",
    area: "identity",
    severity: "medium",
    why: "Standing admin access on a long-lived user means one stolen credential owns the account; admins should assume a role when they need it.",
    controlCodes: LEAST_PRIV,
    apiCalls: ["iam:ListUsers", "iam:ListAttachedUserPolicies", "iam:ListGroupsForUser", "iam:ListAttachedGroupPolicies"],
    fix: {
      cli: "aws iam detach-user-policy --user-name {id} --policy-arn arn:aws:iam::aws:policy/AdministratorAccess",
      console: "Give admins an AdministratorAccess permission set in IAM Identity Center (short-lived, MFA via your IdP), then detach AdministratorAccess from the IAM user {id} or remove it from the admin group.",
    },
  },

  // -------------------------------------------------------------- logging
  {
    key: "aws.cloudtrail_enabled",
    title: "CloudTrail records every region",
    area: "logging",
    severity: "high",
    why: "CloudTrail is the record of who did what in AWS; without it you can't investigate an incident or show an auditor anything.",
    controlCodes: LOGGING,
    apiCalls: ["cloudtrail:DescribeTrails", "cloudtrail:GetTrailStatus"],
    fix: {
      terraform:
        'resource "aws_cloudtrail" "main" {\n  name                          = "main"\n  s3_bucket_name                = aws_s3_bucket.trail.id\n  is_multi_region_trail         = true\n  include_global_service_events = true\n  enable_log_file_validation    = true\n}',
      cli: "aws cloudtrail create-trail --name main --s3-bucket-name <BUCKET> --is-multi-region-trail --enable-log-file-validation\naws cloudtrail start-logging --name main",
      console: "CloudTrail → Trails → Create trail: apply to all regions, log file validation on. The first trail's management events are free.",
    },
  },
  {
    key: "aws.cloudtrail_log_validation",
    title: "CloudTrail log files are tamper-evident",
    area: "logging",
    severity: "medium",
    why: "Log file validation lets you prove the logs weren't edited after the fact — the property an auditor or investigator relies on.",
    controlCodes: LOGGING,
    apiCalls: ["cloudtrail:DescribeTrails"],
    fix: {
      terraform: "# on the aws_cloudtrail resource:\n  enable_log_file_validation = true",
      cli: "aws cloudtrail update-trail --name {id} --enable-log-file-validation",
      console: "CloudTrail → Trails → {id} → Edit → Log file validation: Enabled.",
    },
  },
  {
    key: "aws.log_retention",
    title: "Audit logs kept long enough",
    area: "logging",
    severity: "medium",
    why: "Intrusions are often found months later; logs deleted before then can't answer what happened. Your policy sets the period (365 days by default).",
    controlCodes: LOGGING,
    apiCalls: ["cloudtrail:DescribeTrails", "logs:DescribeLogGroups", "s3:GetLifecycleConfiguration"],
    fix: {
      terraform:
        '# S3 lifecycle on the trail bucket — expire no sooner than your policy:\nresource "aws_s3_bucket_lifecycle_configuration" "trail" {\n  bucket = aws_s3_bucket.trail.id\n  rule {\n    id     = "retain-logs"\n    status = "Enabled"\n    filter {}\n    transition { days = 90  storage_class = "GLACIER_IR" }\n    expiration { days = 400 }\n  }\n}',
      console: "S3 → the trail's bucket → Management → Lifecycle rules: expire after at least your retention period (move to Glacier after 90 days to keep it cheap). For a CloudWatch log group: Actions → Edit retention.",
    },
  },

  // ------------------------------------------------------------ detection
  {
    key: "aws.guardduty_enabled",
    title: "GuardDuty watches every region you use",
    area: "detection",
    severity: "medium",
    why: "GuardDuty spots stolen credentials, crypto-mining and unusual access from logs you already have — it's the cheapest intrusion detection in AWS.",
    controlCodes: DETECTION,
    apiCalls: ["guardduty:ListDetectors", "guardduty:GetDetector"],
    fix: {
      terraform: 'resource "aws_guardduty_detector" "this" {\n  enable = true\n}\n# one per region you use (provider alias per region)',
      cli: "aws guardduty create-detector --enable --region {region}",
      console: "GuardDuty → Get started → Enable, in {region}. 30-day free trial; afterwards usage-based, typically a few dollars a month for a small account.",
      cost: "Usage-based; usually a few dollars a month for a small account.",
    },
  },
  {
    key: "aws.guardduty_findings",
    title: "No high-severity GuardDuty findings left open",
    area: "detection",
    severity: "high",
    why: "A high-severity finding nobody has looked at for a week is the definition of a missed incident.",
    controlCodes: DETECTION,
    apiCalls: ["guardduty:ListFindings", "guardduty:GetFindings"],
    fix: {
      console: "GuardDuty → Findings in {region} → open {id}, investigate, then archive it with a note (or fix the cause). Record real incidents in ShieldFlow's incident log.",
    },
  },

  // ------------------------------------------------------------- exposure
  {
    key: "aws.s3_account_public_access_block",
    title: "S3 Block Public Access on for the account",
    area: "exposure",
    severity: "high",
    why: "The account-wide switch stops any bucket being made public by mistake — the most common way startups leak data.",
    controlCodes: EXPOSURE,
    apiCalls: ["s3:GetAccountPublicAccessBlock"],
    fix: {
      terraform:
        'resource "aws_s3_account_public_access_block" "this" {\n  block_public_acls       = true\n  ignore_public_acls      = true\n  block_public_policy     = true\n  restrict_public_buckets = true\n}',
      cli: "aws s3control put-public-access-block --account-id {account} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
      console: "S3 → Block Public Access settings for this account → Edit → turn all four on. If a bucket must stay public (a static site), serve it through CloudFront instead.",
    },
  },
  {
    key: "aws.s3_public_buckets",
    title: "No public S3 buckets",
    area: "exposure",
    severity: "high",
    why: "A public bucket can be read by anyone on the internet who guesses or finds its name.",
    controlCodes: EXPOSURE,
    apiCalls: ["s3:ListAllMyBuckets", "s3:GetBucketPolicyStatus", "s3:GetBucketAcl", "s3:GetBucketPublicAccessBlock"],
    fix: {
      terraform:
        'resource "aws_s3_bucket_public_access_block" "{id}" {\n  bucket                  = "{id}"\n  block_public_acls       = true\n  ignore_public_acls      = true\n  block_public_policy     = true\n  restrict_public_buckets = true\n}',
      cli: "aws s3api put-public-access-block --bucket {id} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
      console: "S3 → {id} → Permissions → Block public access → Edit → all on. If it's intentionally public (website assets), tag it shieldflow:scope=out or mark it out of scope here with the reason.",
    },
  },
  {
    key: "aws.public_snapshots",
    title: "No public snapshots or machine images",
    area: "exposure",
    severity: "high",
    why: "A public EBS or database snapshot is a full copy of your disk or database that anyone with an AWS account can restore.",
    controlCodes: EXPOSURE,
    apiCalls: ["ec2:DescribeSnapshots", "ec2:DescribeImages", "rds:DescribeDBSnapshots", "rds:DescribeDBSnapshotAttributes"],
    fix: {
      cli: "aws ec2 modify-snapshot-attribute --snapshot-id {id} --attribute createVolumePermission --operation-type remove --group-names all --region {region}\n# RDS:\naws rds modify-db-snapshot-attribute --db-snapshot-identifier {id} --attribute-name restore --values-to-remove all --region {region}",
      console: "EC2 → Snapshots (or RDS → Snapshots) → {id} → Modify permissions → Private.",
    },
  },
  {
    key: "aws.rds_public",
    title: "Databases not reachable from the internet",
    area: "exposure",
    severity: "high",
    why: "A publicly accessible database is one weak password or unpatched bug away from being dumped.",
    controlCodes: EXPOSURE,
    apiCalls: ["rds:DescribeDBInstances"],
    fix: {
      terraform: "# on the aws_db_instance:\n  publicly_accessible = false",
      cli: "aws rds modify-db-instance --db-instance-identifier {id} --no-publicly-accessible --apply-immediately --region {region}",
      console: "RDS → {id} → Modify → Connectivity → Public access: No. Reach it through a bastion, SSM or a VPN instead.",
    },
  },
  {
    key: "aws.open_admin_ports",
    title: "SSH and RDP not open to the internet",
    area: "exposure",
    severity: "high",
    why: "Port 22 or 3389 open to the world gets brute-forced within minutes of going live.",
    controlCodes: EXPOSURE,
    apiCalls: ["ec2:DescribeSecurityGroups", "ec2:DescribeNetworkInterfaces"],
    fix: {
      terraform:
        '# replace 0.0.0.0/0 on the ingress rule with your office/VPN range — or drop SSH and use SSM Session Manager:\ningress {\n  from_port   = 22\n  to_port     = 22\n  protocol    = "tcp"\n  cidr_blocks = ["<your-vpn-cidr>"]\n}',
      cli: "aws ec2 revoke-security-group-ingress --group-id {id} --protocol tcp --port 22 --cidr 0.0.0.0/0 --region {region}",
      console: "EC2 → Security Groups → {id} → Inbound rules → remove the 0.0.0.0/0 rule for 22/3389. Use SSM Session Manager for shell access — no open port needed.",
    },
  },
  {
    key: "aws.open_database_ports",
    title: "Database ports not open to the internet",
    area: "exposure",
    severity: "high",
    why: "MySQL, Postgres, Redis or Elasticsearch open to the world are scanned and attacked constantly.",
    controlCodes: EXPOSURE,
    apiCalls: ["ec2:DescribeSecurityGroups", "ec2:DescribeNetworkInterfaces"],
    fix: {
      terraform: "# on the ingress rule, allow only the app's security group:\n  security_groups = [aws_security_group.app.id]   # instead of cidr_blocks = [\"0.0.0.0/0\"]",
      cli: "aws ec2 revoke-security-group-ingress --group-id {id} --protocol tcp --port <PORT> --cidr 0.0.0.0/0 --region {region}",
      console: "EC2 → Security Groups → {id} → Inbound rules → replace 0.0.0.0/0 with the security group of the app that needs the database.",
    },
  },
  {
    key: "aws.lambda_public_urls",
    title: "No Lambda function URLs without authentication",
    area: "exposure",
    severity: "medium",
    why: "A function URL with auth NONE is a public endpoint anyone can call — fine for a webhook you meant to expose, a leak if you didn't.",
    controlCodes: EXPOSURE,
    apiCalls: ["lambda:ListFunctions", "lambda:ListFunctionUrlConfigs"],
    fix: {
      terraform: '# on the aws_lambda_function_url:\n  authorization_type = "AWS_IAM"',
      cli: "aws lambda update-function-url-config --function-name {id} --auth-type AWS_IAM --region {region}",
      console: "Lambda → {id} → Configuration → Function URL → Edit → Auth type: AWS_IAM. If it's an intended public webhook, mark it out of scope here and say how it's protected (signature check).",
    },
  },

  // ----------------------------------------------------------- encryption
  {
    key: "aws.rds_encrypted",
    title: "Databases encrypted at rest",
    area: "encryption",
    severity: "medium",
    why: "Every questionnaire asks it, and an unencrypted database means its snapshots and backups are unencrypted too.",
    controlCodes: ENCRYPT_REST,
    apiCalls: ["rds:DescribeDBInstances", "rds:DescribeDBClusters"],
    fix: {
      terraform: "# can't be switched on in place — on a new instance restored from an encrypted snapshot copy:\n  storage_encrypted = true",
      cli: "aws rds create-db-snapshot --db-instance-identifier {id} --db-snapshot-identifier {id}-pre-encrypt --region {region}\naws rds copy-db-snapshot --source-db-snapshot-identifier {id}-pre-encrypt --target-db-snapshot-identifier {id}-encrypted --kms-key-id alias/aws/rds --region {region}\n# then restore {id}-encrypted and switch the app over",
      console: "RDS can't encrypt an existing database in place: snapshot it, copy the snapshot with encryption on, restore the copy, and switch the app to the new endpoint in a maintenance window.",
    },
  },
  {
    key: "aws.ebs_default_encryption",
    title: "New disks encrypted by default",
    area: "encryption",
    severity: "medium",
    why: "One setting per region makes every new EBS volume and snapshot encrypted, so nobody has to remember.",
    controlCodes: ENCRYPT_REST,
    apiCalls: ["ec2:GetEbsEncryptionByDefault"],
    fix: {
      terraform: 'resource "aws_ebs_encryption_by_default" "this" {\n  enabled = true\n}   # per region',
      cli: "aws ec2 enable-ebs-encryption-by-default --region {region}",
      console: "EC2 → Settings (Dashboard, right panel) → Data protection and security → EBS encryption → Manage → Always encrypt new EBS volumes, in {region}.",
    },
  },
  {
    key: "aws.ebs_unencrypted_volumes",
    title: "No unencrypted disks in use",
    area: "encryption",
    severity: "medium",
    why: "Volumes created before default encryption was on stay unencrypted until replaced.",
    controlCodes: ENCRYPT_REST,
    apiCalls: ["ec2:DescribeVolumes"],
    fix: {
      cli: "aws ec2 create-snapshot --volume-id {id} --region {region}\naws ec2 copy-snapshot --source-snapshot-id <SNAP> --source-region {region} --encrypted --region {region}\n# create a volume from the encrypted copy and swap it in",
      console: "Snapshot {id}, copy the snapshot with encryption on, create a volume from the copy and swap it onto the instance during a maintenance window. Unattached old volumes can usually just be deleted.",
    },
  },
  {
    key: "aws.kms_rotation",
    title: "Customer-managed keys rotate yearly",
    area: "encryption",
    severity: "low",
    why: "Automatic rotation limits how much data any one key version protects. Only applies if you created your own keys.",
    controlCodes: ENCRYPT_REST,
    apiCalls: ["kms:ListKeys", "kms:DescribeKey", "kms:GetKeyRotationStatus"],
    fix: {
      terraform: "# on the aws_kms_key:\n  enable_key_rotation = true",
      cli: "aws kms enable-key-rotation --key-id {id} --region {region}",
      console: "KMS → Customer managed keys → {id} → Key rotation → Automatically rotate this KMS key every year.",
    },
  },

  // -------------------------------------------------------------- patching
  {
    key: "aws.lambda_runtimes",
    title: "Lambda functions on supported runtimes",
    area: "patching",
    severity: "medium",
    why: "After a runtime's deprecation date AWS stops patching it — your code keeps running on an unpatched language and OS.",
    controlCodes: PATCHING,
    apiCalls: ["lambda:ListFunctions"],
    fix: {
      terraform: '# on the aws_lambda_function — move to a current runtime, e.g.:\n  runtime = "nodejs22.x"   # or "python3.13"',
      cli: "aws lambda update-function-configuration --function-name {id} --runtime <NEW_RUNTIME> --region {region}",
      console: "Lambda → {id} → Code → Runtime settings → Edit. Test on a version/alias first; you can't roll back to a runtime once updates are blocked.",
    },
  },
  {
    key: "aws.rds_engine_support",
    title: "Database engines in standard support",
    area: "patching",
    severity: "medium",
    why: "Past standard support, AWS charges Extended Support per vCPU-hour to keep patching — or the version gets force-upgraded. Upgrading fixes both the risk and the bill.",
    controlCodes: PATCHING,
    apiCalls: ["rds:DescribeDBInstances", "rds:DescribeDBClusters", "rds:DescribeDBMajorEngineVersions"],
    fix: {
      cli: "aws rds modify-db-instance --db-instance-identifier {id} --engine-version <NEW_MAJOR_VERSION> --allow-major-version-upgrade --region {region}",
      console: "RDS → {id} → Modify → DB engine version. Test the upgrade on a snapshot restore first; use a blue/green deployment to cut over with minimal downtime.",
      cost: "Extended Support: about $0.10 per vCPU-hour in years 1–2, $0.20 in year 3 — upgrading removes it.",
    },
  },
  {
    key: "aws.eks_version_support",
    title: "Kubernetes clusters in standard support",
    area: "patching",
    severity: "medium",
    why: "EKS versions in extended support cost six times more to run ($0.60 vs $0.10 per cluster-hour) and fall behind on add-on fixes.",
    controlCodes: PATCHING,
    apiCalls: ["eks:ListClusters", "eks:DescribeCluster", "eks:DescribeClusterVersions"],
    fix: {
      terraform: '# on the aws_eks_cluster:\n  version = "<NEXT_MINOR>"   # one minor version at a time',
      cli: "aws eks update-cluster-version --name {id} --kubernetes-version <NEXT_MINOR> --region {region}",
      console: "EKS → {id} → Upgrade now — one minor version at a time, add-ons and node groups after the control plane.",
      cost: "Extended support adds about $365 per cluster per month.",
    },
  },

  // -------------------------------------------------------- vulnerabilities
  {
    key: "aws.image_vulnerabilities",
    title: "No critical vulnerabilities in deployed images",
    area: "vulnerabilities",
    severity: "high",
    why: "A critical CVE in the image you ship is the vulnerability-management finding auditors and pen-testers look for first.",
    controlCodes: VULN,
    apiCalls: ["ecr:DescribeRepositories", "ecr:DescribeImages", "inspector2:BatchGetAccountStatus", "inspector2:ListFindingAggregations"],
    fix: {
      cli: "aws ecr put-image-scanning-configuration --repository-name {id} --image-scanning-configuration scanOnPush=true --region {region}\naws ecr describe-image-scan-findings --repository-name {id} --image-id imageTag=<TAG> --region {region}",
      console: "ECR → {id} → the latest image → Vulnerabilities. Rebuild on a patched base image and redeploy. Turn on scan-on-push (free basic scanning) for every repository.",
    },
  },

  // --------------------------------------------------------------- backups
  {
    key: "aws.rds_backups",
    title: "Databases keep at least 7 days of backups",
    area: "backups",
    severity: "medium",
    why: "Automated backups are how you undo a bad migration or a ransomware hit; under a week of history is rarely enough to notice in time.",
    controlCodes: BACKUP,
    apiCalls: ["rds:DescribeDBInstances", "rds:DescribeDBClusters"],
    fix: {
      terraform: "# on the aws_db_instance / aws_rds_cluster:\n  backup_retention_period = 14",
      cli: "aws rds modify-db-instance --db-instance-identifier {id} --backup-retention-period 14 --apply-immediately --region {region}",
      console: "RDS → {id} → Modify → Backup → Backup retention period: 14 days.",
    },
  },
  {
    key: "aws.dynamodb_pitr",
    title: "DynamoDB tables have point-in-time recovery",
    area: "backups",
    severity: "medium",
    why: "Without PITR, a bad write or delete on a table can't be rolled back.",
    controlCodes: BACKUP,
    apiCalls: ["dynamodb:ListTables", "dynamodb:DescribeContinuousBackups"],
    fix: {
      terraform: "# on the aws_dynamodb_table:\n  point_in_time_recovery {\n    enabled = true\n  }",
      cli: "aws dynamodb update-continuous-backups --table-name {id} --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true --region {region}",
      console: "DynamoDB → Tables → {id} → Backups → Point-in-time recovery → Edit → On.",
      cost: "Charged per GB stored; small for most tables.",
    },
  },

  // ---------------------------------------------------------- informational
  {
    key: "aws.vpc_flow_logs",
    title: "VPC Flow Logs on for networks in use",
    area: "hygiene",
    severity: "low",
    informational: true,
    why: "Flow logs show which addresses talked to what — useful in an investigation, but they cost money, so it's your call.",
    controlCodes: [],
    apiCalls: ["ec2:DescribeFlowLogs", "ec2:DescribeNetworkInterfaces"],
    fix: {
      terraform: 'resource "aws_flow_log" "this" {\n  vpc_id               = "{id}"\n  traffic_type         = "REJECT"\n  log_destination_type = "s3"\n  log_destination      = aws_s3_bucket.flow.arn\n}',
      console: "VPC → {id} → Flow logs → Create. Logging only REJECT traffic to S3 keeps the cost low.",
      cost: "Charged per GB ingested; REJECT-only to S3 is usually cheap.",
    },
  },
  {
    key: "aws.config_recorder",
    title: "AWS Config recording",
    area: "hygiene",
    severity: "low",
    informational: true,
    why: "Config keeps a history of every resource's settings. Helpful, not required — ShieldFlow keeps its own daily history of these checks.",
    controlCodes: [],
    apiCalls: ["config:DescribeConfigurationRecorderStatus"],
    fix: { console: "AWS Config → Get started → record all resources in {region}.", cost: "Charged per configuration item recorded." },
  },
  {
    key: "aws.security_hub",
    title: "Security Hub enabled",
    area: "hygiene",
    severity: "low",
    informational: true,
    why: "Security Hub runs AWS's own best-practice checks. Not required — these checks cover what auditors cite, at no AWS cost.",
    controlCodes: [],
    apiCalls: ["securityhub:DescribeHub"],
    fix: { console: "Security Hub → Go to Security Hub → Enable.", cost: "Charged per check and finding; a few hundred dollars a year for a small account." },
  },
  {
    key: "aws.rds_deletion_protection",
    title: "Production databases have deletion protection",
    area: "hygiene",
    severity: "low",
    informational: true,
    why: "One wrong click or terraform destroy shouldn't be able to delete the production database.",
    controlCodes: [],
    apiCalls: ["rds:DescribeDBInstances", "rds:DescribeDBClusters"],
    fix: {
      terraform: "# on the aws_db_instance / aws_rds_cluster:\n  deletion_protection = true",
      cli: "aws rds modify-db-instance --db-instance-identifier {id} --deletion-protection --region {region}",
      console: "RDS → {id} → Modify → Deletion protection: Enable.",
    },
  },
];

export const AWS_CHECK_BY_KEY = new Map(AWS_CHECKS.map((c) => [c.key, c]));

/** Fill a fix template for one resource. */
export function fillFix(template: string, vars: { id?: string; region?: string | null; account?: string }): string {
  return template
    .replaceAll("{id}", vars.id ?? "<RESOURCE>")
    .replaceAll("{region}", vars.region ?? "<REGION>")
    .replaceAll("{account}", vars.account ?? "<ACCOUNT_ID>");
}
