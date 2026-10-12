import {
  IAMClient,
  GenerateCredentialReportCommand,
  GetCredentialReportCommand,
  GetAccountPasswordPolicyCommand,
  ListUsersCommand,
  ListAttachedUserPoliciesCommand,
  ListGroupsForUserCommand,
  ListAttachedGroupPoliciesCommand,
  ListAccountAliasesCommand,
  type User,
} from "@aws-sdk/client-iam";
import {
  EC2Client,
  DescribeRegionsCommand,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  GetEbsEncryptionByDefaultCommand,
  DescribeSnapshotsCommand,
  DescribeImagesCommand,
  DescribeSecurityGroupsCommand,
  DescribeNetworkInterfacesCommand,
  DescribeFlowLogsCommand,
  type IpPermission,
} from "@aws-sdk/client-ec2";
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetPublicAccessBlockCommand,
  GetBucketPolicyStatusCommand,
  GetBucketAclCommand,
  GetBucketTaggingCommand,
  GetBucketLifecycleConfigurationCommand,
} from "@aws-sdk/client-s3";
import { S3ControlClient, GetPublicAccessBlockCommand as GetAccountPublicAccessBlockCommand } from "@aws-sdk/client-s3-control";
import {
  RDSClient,
  DescribeDBInstancesCommand,
  DescribeDBClustersCommand,
  DescribeDBMajorEngineVersionsCommand,
  DescribeDBSnapshotsCommand,
  DescribeDBSnapshotAttributesCommand,
  DescribeDBClusterSnapshotsCommand,
  DescribeDBClusterSnapshotAttributesCommand,
} from "@aws-sdk/client-rds";
import { DynamoDBClient, ListTablesCommand, DescribeContinuousBackupsCommand } from "@aws-sdk/client-dynamodb";
import { LambdaClient, ListFunctionsCommand, ListFunctionUrlConfigsCommand } from "@aws-sdk/client-lambda";
import { EKSClient, ListClustersCommand, DescribeClusterCommand, DescribeClusterVersionsCommand } from "@aws-sdk/client-eks";
import { GuardDutyClient, ListDetectorsCommand, GetDetectorCommand, ListFindingsCommand, GetFindingsCommand } from "@aws-sdk/client-guardduty";
import { KMSClient, ListKeysCommand, DescribeKeyCommand, GetKeyRotationStatusCommand, ListAliasesCommand } from "@aws-sdk/client-kms";
import { ECRClient, DescribeRepositoriesCommand, DescribeImagesCommand as DescribeEcrImagesCommand } from "@aws-sdk/client-ecr";
import { Inspector2Client, BatchGetAccountStatusCommand, ListFindingAggregationsCommand } from "@aws-sdk/client-inspector2";
import { ConfigServiceClient, DescribeConfigurationRecorderStatusCommand } from "@aws-sdk/client-config-service";
import { SecurityHubClient, DescribeHubCommand } from "@aws-sdk/client-securityhub";
import { CloudTrailClient, DescribeTrailsCommand, GetTrailStatusCommand } from "@aws-sdk/client-cloudtrail";
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import {
  BackupClient,
  ListProtectedResourcesCommand,
  ListRestoreJobsCommand,
  ListRestoreTestingPlansCommand,
  ListCopyJobsCommand,
} from "@aws-sdk/client-backup";
import { identityCenter, organizationOf } from "@/lib/aws/people";
import { collectCloudTrail } from "@/lib/aws/cloudtrail";
import { client, collectPages, errorName, pool, section, sleep, tagsOf, timeLeft, type ScanCtx } from "@/lib/aws/sdk";
import type {
  AccountPosture,
  BackupInfo,
  BlockPublicAccess,
  BucketInfo,
  CredentialRow,
  EngineSupport,
  RdsInfo,
  RegionalPosture,
  Section,
  SecurityGroupInfo,
  TrailInfo,
} from "@/lib/aws/types";

/**
 * Read one AWS account's security posture — read-only calls only, every one listed
 * in lib/aws/catalog.ts for the public check catalogue.
 *
 * Shape of a scan, inside a single time budget:
 *   1. global: credential report, password policy, admin users, S3 (account
 *      Block Public Access + every bucket), CloudTrail;
 *   2. enabled regions → which are *active* (hold resources) — or the account's
 *      chosen regions;
 *   3. regional collectors in active regions only, a few regions at a time.
 * Inactive regions are never scanned, so a startup in one region never hears
 * about GuardDuty being off in São Paulo.
 */

const HOME = "us-east-1";

export const ADMIN_PORTS = [22, 3389];
export const DB_PORTS = [3306, 5432, 1433, 1521, 27017, 6379, 9200, 5984, 11211, 9042, 5439];

const ADMIN_POLICY_ARNS = new Set([
  "arn:aws:iam::aws:policy/AdministratorAccess",
  "arn:aws:iam::aws:policy/IAMFullAccess",
]);

// ------------------------------------------------------------------ global

function parseCsv(text: string): Record<string, string>[] {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const cols = header.split(",");
  return rows.map((line) => {
    const cells = line.split(",");
    const rec: Record<string, string> = {};
    cols.forEach((c, i) => (rec[c] = cells[i] ?? ""));
    return rec;
  });
}

const dateOrNull = (v: string | undefined) => (v && v !== "N/A" && v !== "no_information" && v !== "not_supported" ? v : null);

async function credentialReport(ctx: ScanCtx): Promise<Section<CredentialRow[]>> {
  const iam = client(IAMClient, HOME, ctx);
  return section("iam:GenerateCredentialReport", ctx, async () => {
    for (let i = 0; i < 8; i++) {
      const g = await iam.send(new GenerateCredentialReportCommand({}));
      if (g.State === "COMPLETE") break;
      await sleep(1_500);
    }
    const r = await iam.send(new GetCredentialReportCommand({}));
    const text = Buffer.from(r.Content ?? new Uint8Array()).toString("utf8");
    return parseCsv(text).map((x) => ({
      user: x.user,
      arn: x.arn,
      createdAt: dateOrNull(x.user_creation_time),
      passwordEnabled: x.password_enabled === "true",
      passwordLastUsed: dateOrNull(x.password_last_used),
      mfaActive: x.mfa_active === "true",
      keys: [1, 2].map((n) => ({
        active: x[`access_key_${n}_active`] === "true",
        lastRotated: dateOrNull(x[`access_key_${n}_last_rotated`]),
        lastUsed: dateOrNull(x[`access_key_${n}_last_used_date`]),
      })),
    }));
  });
}

async function passwordPolicy(ctx: ScanCtx) {
  const iam = client(IAMClient, HOME, ctx);
  return section("iam:GetAccountPasswordPolicy", ctx, async () => {
    try {
      const r = await iam.send(new GetAccountPasswordPolicyCommand({}));
      const p = r.PasswordPolicy;
      return {
        minimumLength: p?.MinimumPasswordLength ?? null,
        maxPasswordAge: p?.MaxPasswordAge ?? null,
        reusePrevention: p?.PasswordReusePrevention ?? null,
      };
    } catch (err) {
      if (errorName(err) === "NoSuchEntityException") return null; // no policy set
      throw err;
    }
  });
}

async function adminUsers(ctx: ScanCtx) {
  const iam = client(IAMClient, HOME, ctx);
  return section("iam:ListAttachedUserPolicies", ctx, async () => {
    const users = await collectPages(
      () => iam.send(new ListUsersCommand({ MaxItems: 100 })),
      (m) => iam.send(new ListUsersCommand({ MaxItems: 100, Marker: m })),
      (p) => p.Users,
      (p) => (p.IsTruncated ? p.Marker : undefined),
      300,
      ctx,
    );
    const groupAdmin = new Map<string, boolean>();
    const found: { user: string; via: string }[] = [];
    await pool(users, 5, ctx, async (u: User) => {
      const name = u.UserName!;
      const direct = await iam.send(new ListAttachedUserPoliciesCommand({ UserName: name }));
      const hit = direct.AttachedPolicies?.find((p) => ADMIN_POLICY_ARNS.has(p.PolicyArn ?? ""));
      if (hit) {
        found.push({ user: name, via: `${hit.PolicyName} attached directly` });
        return;
      }
      const groups = await iam.send(new ListGroupsForUserCommand({ UserName: name }));
      for (const g of groups.Groups ?? []) {
        const gName = g.GroupName!;
        if (!groupAdmin.has(gName)) {
          const gp = await iam.send(new ListAttachedGroupPoliciesCommand({ GroupName: gName }));
          groupAdmin.set(gName, Boolean(gp.AttachedPolicies?.some((p) => ADMIN_POLICY_ARNS.has(p.PolicyArn ?? ""))));
        }
        if (groupAdmin.get(gName)) {
          found.push({ user: name, via: `admin through group ${gName}` });
          return;
        }
      }
    });
    return found;
  });
}

async function accountAlias(ctx: ScanCtx): Promise<string | null> {
  try {
    const r = await client(IAMClient, HOME, ctx).send(new ListAccountAliasesCommand({}));
    return r.AccountAliases?.[0] ?? null;
  } catch {
    return null;
  }
}

function bpaFrom(c: { BlockPublicAcls?: boolean; IgnorePublicAcls?: boolean; BlockPublicPolicy?: boolean; RestrictPublicBuckets?: boolean } | undefined): BlockPublicAccess | null {
  if (!c) return null;
  return {
    blockPublicAcls: Boolean(c.BlockPublicAcls),
    ignorePublicAcls: Boolean(c.IgnorePublicAcls),
    blockPublicPolicy: Boolean(c.BlockPublicPolicy),
    restrictPublicBuckets: Boolean(c.RestrictPublicBuckets),
  };
}

async function accountBpa(ctx: ScanCtx) {
  const s3c = client(S3ControlClient, HOME, ctx);
  return section("s3:GetAccountPublicAccessBlock", ctx, async () => {
    try {
      const r = await s3c.send(new GetAccountPublicAccessBlockCommand({ AccountId: ctx.accountId }));
      return bpaFrom(r.PublicAccessBlockConfiguration);
    } catch (err) {
      if (/NoSuchPublicAccessBlockConfiguration/i.test(errorName(err))) return null;
      throw err;
    }
  });
}

const PUBLIC_GRANTEES = /AllUsers|AuthenticatedUsers/;

/** The account never signed up for the service (GuardDuty, Security Hub): it's off. */
const NOT_SUBSCRIBED = /SubscriptionRequired|needs a subscription|OptInRequired/i;

async function buckets(ctx: ScanCtx) {
  const home = client(S3Client, HOME, ctx, { followRegionRedirects: true });
  return section("s3:ListAllMyBuckets", ctx, async () => {
    const list = await collectPages(
      () => home.send(new ListBucketsCommand({ MaxBuckets: 1000 })),
      (t) => home.send(new ListBucketsCommand({ MaxBuckets: 1000, ContinuationToken: t })),
      (p) => p.Buckets,
      (p) => p.ContinuationToken,
      300,
      ctx,
    );
    const clients = new Map<string, S3Client>();
    const s3For = (region: string) => {
      if (!clients.has(region)) clients.set(region, client(S3Client, region, ctx, { followRegionRedirects: true }));
      return clients.get(region)!;
    };
    const out: BucketInfo[] = [];
    await pool(list.slice(0, 150), 8, ctx, async (b) => {
      const name = b.Name!;
      let region = (b as { BucketRegion?: string }).BucketRegion ?? null;
      if (!region) {
        try {
          const loc = await home.send(new GetBucketLocationCommand({ Bucket: name }));
          region = loc.LocationConstraint || HOME;
        } catch {
          region = HOME;
        }
      }
      const s3 = s3For(region);
      const soft = async <T,>(fn: () => Promise<T>, missing: RegExp, fallback: T): Promise<T | null> => {
        try {
          return await fn();
        } catch (err) {
          return missing.test(errorName(err)) ? fallback : null;
        }
      };
      const [bpa, policy, acl, tags] = await Promise.all([
        soft(async () => bpaFrom((await s3.send(new GetPublicAccessBlockCommand({ Bucket: name }))).PublicAccessBlockConfiguration), /NoSuchPublicAccessBlockConfiguration/i, null),
        soft(async () => Boolean((await s3.send(new GetBucketPolicyStatusCommand({ Bucket: name }))).PolicyStatus?.IsPublic), /NoSuchBucketPolicy/i, false),
        soft(async () => Boolean((await s3.send(new GetBucketAclCommand({ Bucket: name }))).Grants?.some((g) => PUBLIC_GRANTEES.test(g.Grantee?.URI ?? ""))), /^$/, false),
        soft(async () => tagsOf((await s3.send(new GetBucketTaggingCommand({ Bucket: name }))).TagSet), /NoSuchTagSet/i, {}),
      ]);
      out.push({ name, region, bucketBpa: bpa ?? null, policyPublic: policy, aclPublic: acl, tags: tags ?? {} });
    });
    return out;
  });
}

async function trailRetention(t: { S3BucketName?: string; CloudWatchLogsLogGroupArn?: string; HomeRegion?: string }, ctx: ScanCtx) {
  // A CloudWatch log group's retention wins if there is one; otherwise the S3 bucket's lifecycle.
  if (t.CloudWatchLogsLogGroupArn) {
    try {
      const name = t.CloudWatchLogsLogGroupArn.split(":log-group:")[1]?.replace(/:\*$/, "");
      const logs = client(CloudWatchLogsClient, t.HomeRegion ?? HOME, ctx);
      const r = await logs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: name, limit: 5 }));
      const g = r.logGroups?.find((x) => x.logGroupName === name);
      if (g) return { days: g.retentionInDays ?? null, source: `CloudWatch log group ${name}` };
    } catch {
      /* fall through to S3 */
    }
  }
  if (!t.S3BucketName) return { days: undefined, source: "no log destination" };
  try {
    const s3 = client(S3Client, t.HomeRegion ?? HOME, ctx, { followRegionRedirects: true });
    const r = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: t.S3BucketName }));
    const days = (r.Rules ?? [])
      .filter((x) => x.Status === "Enabled" && x.Expiration?.Days)
      .map((x) => x.Expiration!.Days!);
    return { days: days.length ? Math.min(...days) : null, source: `S3 bucket ${t.S3BucketName}` };
  } catch (err) {
    if (/NoSuchLifecycleConfiguration/i.test(errorName(err))) return { days: null, source: `S3 bucket ${t.S3BucketName}` };
    // Usually an organisation log-archive bucket in another account.
    return { days: undefined, source: `S3 bucket ${t.S3BucketName} (not readable from this account)` };
  }
}

async function trails(ctx: ScanCtx) {
  const ct = client(CloudTrailClient, HOME, ctx);
  return section("cloudtrail:DescribeTrails", ctx, async () => {
    const r = await ct.send(new DescribeTrailsCommand({ includeShadowTrails: true }));
    const unique = new Map<string, NonNullable<typeof r.trailList>[number]>();
    for (const t of r.trailList ?? []) if (t.TrailARN) unique.set(t.TrailARN, t);
    const out: TrailInfo[] = [];
    await pool([...unique.values()], 4, ctx, async (t) => {
      let logging: boolean | null = null;
      try {
        const st = await client(CloudTrailClient, t.HomeRegion ?? HOME, ctx).send(new GetTrailStatusCommand({ Name: t.TrailARN }));
        logging = Boolean(st.IsLogging);
      } catch {
        logging = null;
      }
      const ret = await trailRetention(t, ctx);
      out.push({
        arn: t.TrailARN!,
        name: t.Name ?? t.TrailARN!,
        homeRegion: t.HomeRegion ?? HOME,
        multiRegion: Boolean(t.IsMultiRegionTrail),
        organization: Boolean(t.IsOrganizationTrail),
        logging,
        logValidation: Boolean(t.LogFileValidationEnabled),
        s3Bucket: t.S3BucketName ?? null,
        retentionDays: ret.days,
        retentionSource: ret.source,
      });
    });
    return out;
  });
}

// ---------------------------------------------------------------- regions

async function enabledRegions(ctx: ScanCtx): Promise<string[]> {
  const r = await client(EC2Client, HOME, ctx).send(new DescribeRegionsCommand({ AllRegions: false }));
  return (r.Regions ?? []).map((x) => x.RegionName!).filter(Boolean).sort();
}

/**
 * A region is active if it holds anything we'd assess. Cheap probes only.
 * "unknown" when a probe was refused or failed: an unreadable region is scanned
 * (and reports what it couldn't read), never skipped as if it were empty — a
 * skipped region would let every regional check pass on nothing.
 */
async function regionState(region: string, ctx: ScanCtx): Promise<"active" | "inactive" | "unknown"> {
  const probes: Promise<boolean>[] = [
    client(EC2Client, region, ctx).send(new DescribeInstancesCommand({ MaxResults: 5 })).then((r) => Boolean(r.Reservations?.length)),
    client(EC2Client, region, ctx).send(new DescribeVolumesCommand({ MaxResults: 5 })).then((r) => Boolean(r.Volumes?.length)),
    client(RDSClient, region, ctx).send(new DescribeDBInstancesCommand({ MaxRecords: 20 })).then((r) => Boolean(r.DBInstances?.length)),
    client(LambdaClient, region, ctx).send(new ListFunctionsCommand({ MaxItems: 1 })).then((r) => Boolean(r.Functions?.length)),
    client(DynamoDBClient, region, ctx).send(new ListTablesCommand({ Limit: 1 })).then((r) => Boolean(r.TableNames?.length)),
    client(EKSClient, region, ctx).send(new ListClustersCommand({ maxResults: 1 })).then((r) => Boolean(r.clusters?.length)),
  ];
  const settled = await Promise.allSettled(probes);
  if (settled.some((x) => x.status === "fulfilled" && x.value)) return "active";
  return settled.some((x) => x.status === "rejected") ? "unknown" : "inactive";
}

// --------------------------------------------------------------- regional

function openPorts(perms: IpPermission[] | undefined) {
  const admin = new Set<number>();
  const db = new Set<number>();
  let all = false;
  for (const p of perms ?? []) {
    const world =
      (p.IpRanges ?? []).some((r) => r.CidrIp === "0.0.0.0/0") ||
      (p.Ipv6Ranges ?? []).some((r) => r.CidrIpv6 === "::/0");
    if (!world) continue;
    if (p.IpProtocol === "-1") {
      all = true;
      ADMIN_PORTS.forEach((x) => admin.add(x));
      DB_PORTS.forEach((x) => db.add(x));
      continue;
    }
    if (p.IpProtocol !== "tcp" && p.IpProtocol !== "6") continue;
    const from = p.FromPort ?? 0;
    const to = p.ToPort ?? 65535;
    if (from === 0 && to === 65535) all = true;
    for (const port of ADMIN_PORTS) if (port >= from && port <= to) admin.add(port);
    for (const port of DB_PORTS) if (port >= from && port <= to) db.add(port);
  }
  return { admin: [...admin], db: [...db], all };
}

async function collectRegion(region: string, ctx: ScanCtx): Promise<RegionalPosture> {
  const ec2 = client(EC2Client, region, ctx);
  const rds = client(RDSClient, region, ctx);
  const inventory = { instances: 0, volumes: 0, databases: 0, functions: 0, tables: 0, clusters: 0 };

  const [ebsDefaultEncryption, unencryptedVolumes, publicEbsSnapshots, publicAmis] = await Promise.all([
    section("ec2:GetEbsEncryptionByDefault", ctx, async () => Boolean((await ec2.send(new GetEbsEncryptionByDefaultCommand({}))).EbsEncryptionByDefault)),
    section("ec2:DescribeVolumes", ctx, async () => {
      const vols = await collectPages(
        () => ec2.send(new DescribeVolumesCommand({ MaxResults: 500 })),
        (t) => ec2.send(new DescribeVolumesCommand({ MaxResults: 500, NextToken: t })),
        (p) => p.Volumes,
        (p) => p.NextToken,
        2000,
        ctx,
      );
      inventory.volumes = vols.length;
      return vols
        .filter((v) => !v.Encrypted)
        .map((v) => ({ id: v.VolumeId!, attached: Boolean(v.Attachments?.length), tags: tagsOf(v.Tags) }));
    }),
    section("ec2:DescribeSnapshots", ctx, async () => {
      const r = await ec2.send(new DescribeSnapshotsCommand({ OwnerIds: ["self"], RestorableByUserIds: ["all"], MaxResults: 1000 }));
      return (r.Snapshots ?? []).map((s) => s.SnapshotId!);
    }),
    section("ec2:DescribeImages", ctx, async () => {
      const r = await ec2.send(new DescribeImagesCommand({ Owners: ["self"], ExecutableUsers: ["all"] }));
      return (r.Images ?? []).map((i) => ({ id: i.ImageId!, name: i.Name ?? i.ImageId! }));
    }),
  ]);

  const [securityGroups, vpcsWithoutFlowLogs] = await (async () => {
    const enis = await section("ec2:DescribeNetworkInterfaces", ctx, () =>
      collectPages(
        () => ec2.send(new DescribeNetworkInterfacesCommand({ MaxResults: 1000 })),
        (t) => ec2.send(new DescribeNetworkInterfacesCommand({ MaxResults: 1000, NextToken: t })),
        (p) => p.NetworkInterfaces,
        (p) => p.NextToken,
        3000,
        ctx,
      ),
    );
    const sgInUse = new Set<string>();
    const vpcInUse = new Set<string>();
    if (enis.ok) {
      for (const n of enis.data) {
        for (const g of n.Groups ?? []) if (g.GroupId) sgInUse.add(g.GroupId);
        if (n.VpcId) vpcInUse.add(n.VpcId);
      }
    }
    const sgs: Section<SecurityGroupInfo[]> = await section("ec2:DescribeSecurityGroups", ctx, async () => {
      const groups = await collectPages(
        () => ec2.send(new DescribeSecurityGroupsCommand({ MaxResults: 1000 })),
        (t) => ec2.send(new DescribeSecurityGroupsCommand({ MaxResults: 1000, NextToken: t })),
        (p) => p.SecurityGroups,
        (p) => p.NextToken,
        2000,
        ctx,
      );
      return groups
        .map((g) => {
          const o = openPorts(g.IpPermissions);
          return {
            id: g.GroupId!,
            name: g.GroupName ?? g.GroupId!,
            vpcId: g.VpcId ?? null,
            // Unknown usage (interfaces unreadable) counts as in use: never quieter than the truth.
            inUse: enis.ok ? sgInUse.has(g.GroupId!) : true,
            openAdminPorts: o.admin,
            openDbPorts: o.db,
            allPortsOpen: o.all,
            tags: tagsOf(g.Tags),
          };
        })
        .filter((g) => g.openAdminPorts.length || g.openDbPorts.length || g.allPortsOpen);
    });
    const flow: Section<string[]> = await section("ec2:DescribeFlowLogs", ctx, async () => {
      const r = await ec2.send(new DescribeFlowLogsCommand({ MaxResults: 1000 }));
      const covered = new Set((r.FlowLogs ?? []).map((f) => f.ResourceId));
      return [...vpcInUse].filter((v) => !covered.has(v));
    });
    return [sgs, flow] as const;
  })();

  // Instances only feed the inventory; their exposure shows up through security groups.
  try {
    const r = await ec2.send(new DescribeInstancesCommand({ MaxResults: 1000 }));
    inventory.instances = (r.Reservations ?? []).reduce((n, x) => n + (x.Instances?.length ?? 0), 0);
  } catch {
    /* inventory is best-effort */
  }

  const rdsSection: Section<RdsInfo[]> = await section("rds:DescribeDBInstances", ctx, async () => {
    const [inst, clus] = await Promise.all([
      rds.send(new DescribeDBInstancesCommand({ MaxRecords: 100 })),
      rds.send(new DescribeDBClustersCommand({ MaxRecords: 100 })).catch(() => ({ DBClusters: [] })),
    ]);
    const out: RdsInfo[] = [];
    for (const c of clus.DBClusters ?? []) {
      out.push({
        id: c.DBClusterIdentifier!,
        kind: "cluster",
        engine: c.Engine ?? "",
        engineVersion: c.EngineVersion ?? "",
        instanceClass: null,
        encrypted: Boolean(c.StorageEncrypted),
        publiclyAccessible: false,
        backupRetentionDays: c.BackupRetentionPeriod ?? 0,
        deletionProtection: Boolean(c.DeletionProtection),
        lifecycleSupport: c.EngineLifecycleSupport ?? null,
        clusterId: null,
        tags: tagsOf(c.TagList),
      });
    }
    for (const d of inst.DBInstances ?? []) {
      out.push({
        id: d.DBInstanceIdentifier!,
        kind: "instance",
        engine: d.Engine ?? "",
        engineVersion: d.EngineVersion ?? "",
        instanceClass: d.DBInstanceClass ?? null,
        encrypted: Boolean(d.StorageEncrypted),
        publiclyAccessible: Boolean(d.PubliclyAccessible),
        backupRetentionDays: d.BackupRetentionPeriod ?? 0,
        deletionProtection: Boolean(d.DeletionProtection),
        lifecycleSupport: d.EngineLifecycleSupport ?? null,
        clusterId: d.DBClusterIdentifier ?? null,
        tags: tagsOf(d.TagList),
      });
    }
    inventory.databases = out.filter((x) => x.kind === "cluster" || !x.clusterId).length;
    return out;
  });

  const engineSupport: Section<EngineSupport[]> = await section("rds:DescribeDBMajorEngineVersions", ctx, async () => {
    if (!rdsSection.ok || rdsSection.data.length === 0) return [];
    const engines = [...new Set(rdsSection.data.map((d) => d.engine))];
    const out: EngineSupport[] = [];
    for (const engine of engines) {
      try {
        const r = await rds.send(new DescribeDBMajorEngineVersionsCommand({ Engine: engine }));
        for (const v of r.DBMajorEngineVersions ?? []) {
          const std = v.SupportedEngineLifecycles?.find((l) => l.LifecycleSupportName === "open-source-rds-standard-support");
          out.push({ engine, major: v.MajorEngineVersion ?? "", standardEnd: std?.LifecycleSupportEndDate?.toISOString() ?? null });
        }
      } catch {
        // Commercial engines (Oracle, SQL Server) aren't covered by this API.
      }
    }
    return out;
  });

  const publicRdsSnapshots: Section<string[]> = await section("rds:DescribeDBSnapshotAttributes", ctx, async () => {
    const [snaps, csnaps] = await Promise.all([
      rds.send(new DescribeDBSnapshotsCommand({ SnapshotType: "manual", MaxRecords: 50 })),
      rds.send(new DescribeDBClusterSnapshotsCommand({ SnapshotType: "manual", MaxRecords: 50 })).catch(() => ({ DBClusterSnapshots: [] })),
    ]);
    const found: string[] = [];
    await pool(snaps.DBSnapshots ?? [], 5, ctx, async (s) => {
      const a = await rds.send(new DescribeDBSnapshotAttributesCommand({ DBSnapshotIdentifier: s.DBSnapshotIdentifier }));
      if (a.DBSnapshotAttributesResult?.DBSnapshotAttributes?.some((x) => x.AttributeName === "restore" && x.AttributeValues?.includes("all"))) {
        found.push(s.DBSnapshotIdentifier!);
      }
    });
    await pool(csnaps.DBClusterSnapshots ?? [], 5, ctx, async (s) => {
      const a = await rds.send(new DescribeDBClusterSnapshotAttributesCommand({ DBClusterSnapshotIdentifier: s.DBClusterSnapshotIdentifier }));
      if (a.DBClusterSnapshotAttributesResult?.DBClusterSnapshotAttributes?.some((x) => x.AttributeName === "restore" && x.AttributeValues?.includes("all"))) {
        found.push(s.DBClusterSnapshotIdentifier!);
      }
    });
    return found;
  });

  const ddb = client(DynamoDBClient, region, ctx);
  const dynamo = await section("dynamodb:DescribeContinuousBackups", ctx, async () => {
    const names = await collectPages(
      () => ddb.send(new ListTablesCommand({ Limit: 100 })),
      (t) => ddb.send(new ListTablesCommand({ Limit: 100, ExclusiveStartTableName: t })),
      (p) => p.TableNames,
      (p) => p.LastEvaluatedTableName,
      200,
      ctx,
    );
    inventory.tables = names.length;
    const out: { name: string; pitr: boolean }[] = [];
    await pool(names, 5, ctx, async (name) => {
      const r = await ddb.send(new DescribeContinuousBackupsCommand({ TableName: name }));
      out.push({ name, pitr: r.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus === "ENABLED" });
    });
    return out;
  });

  const lam = client(LambdaClient, region, ctx);
  const lambda = await section("lambda:ListFunctions", ctx, async () => {
    const fns = await collectPages(
      () => lam.send(new ListFunctionsCommand({ MaxItems: 50 })),
      (m) => lam.send(new ListFunctionsCommand({ MaxItems: 50, Marker: m })),
      // Environment variables come back in this call. They're dropped here and
      // never stored: we promise not to read customer secrets.
      (p) => p.Functions?.map((f) => ({ name: f.FunctionName!, runtime: f.Runtime ?? null })),
      (p) => p.NextMarker,
      300,
      ctx,
    );
    inventory.functions = fns.length;
    const withUrls = await pool(fns.slice(0, 100), 5, ctx, async (f) => {
      try {
        const u = await lam.send(new ListFunctionUrlConfigsCommand({ FunctionName: f.name }));
        const auth = u.FunctionUrlConfigs?.[0]?.AuthType ?? null;
        return { ...f, urlAuth: (auth === "NONE" || auth === "AWS_IAM" ? auth : null) as "NONE" | "AWS_IAM" | null };
      } catch {
        return { ...f, urlAuth: null };
      }
    });
    return [...withUrls, ...fns.slice(100).map((f) => ({ ...f, urlAuth: null }))];
  });

  const eksClient = client(EKSClient, region, ctx);
  const eks = await section("eks:DescribeCluster", ctx, async () => {
    const names = (await eksClient.send(new ListClustersCommand({ maxResults: 50 }))).clusters ?? [];
    inventory.clusters = names.length;
    if (!names.length) return [];
    const clusters = await pool(names, 4, ctx, async (name) => (await eksClient.send(new DescribeClusterCommand({ name }))).cluster);
    const versions = [...new Set(clusters.map((c) => c?.version).filter(Boolean) as string[])];
    const info = new Map<string, { status: string | null; end: string | null }>();
    try {
      const v = await eksClient.send(new DescribeClusterVersionsCommand({ clusterVersions: versions }));
      for (const cv of v.clusterVersions ?? []) {
        info.set(cv.clusterVersion!, { status: cv.versionStatus ?? null, end: cv.endOfStandardSupportDate?.toISOString() ?? null });
      }
    } catch {
      /* status unknown — evaluator reports that */
    }
    return clusters.filter(Boolean).map((c) => ({
      name: c!.name!,
      version: c!.version ?? "",
      supportType: c!.upgradePolicy?.supportType ?? null,
      versionStatus: info.get(c!.version ?? "")?.status ?? null,
      standardEnd: info.get(c!.version ?? "")?.end ?? null,
    }));
  });

  const gd = client(GuardDutyClient, region, ctx);
  const guardduty = await section("guardduty:GetDetector", ctx, async () => {
    let ids: string[];
    try {
      ids = (await gd.send(new ListDetectorsCommand({}))).DetectorIds ?? [];
    } catch (err) {
      // An account that has never signed up for GuardDuty: that's "off", not "can't tell".
      if (NOT_SUBSCRIBED.test(errorName(err)) || NOT_SUBSCRIBED.test((err as Error)?.message ?? "")) return { enabled: false, oldHighFindings: [] };
      throw err;
    }
    if (!ids.length) return { enabled: false, oldHighFindings: [] };
    const det = await gd.send(new GetDetectorCommand({ DetectorId: ids[0] }));
    if (det.Status !== "ENABLED") return { enabled: false, oldHighFindings: [] };
    const weekAgo = Date.now() - 7 * 86_400_000;
    const list = await gd.send(
      new ListFindingsCommand({
        DetectorId: ids[0],
        MaxResults: 50,
        FindingCriteria: {
          Criterion: {
            severity: { GreaterThanOrEqual: 7 },
            "service.archived": { Equals: ["false"] },
            updatedAt: { LessThan: weekAgo },
          },
        },
      }),
    );
    const findingIds = list.FindingIds ?? [];
    if (!findingIds.length) return { enabled: true, oldHighFindings: [] };
    const f = await gd.send(new GetFindingsCommand({ DetectorId: ids[0], FindingIds: findingIds.slice(0, 20) }));
    return {
      enabled: true,
      oldHighFindings: (f.Findings ?? []).map((x) => ({
        id: x.Id!,
        type: x.Type ?? "",
        title: x.Title ?? x.Type ?? "",
        severity: x.Severity ?? 0,
        updatedAt: x.UpdatedAt ?? "",
      })),
    };
  });

  const kmsClient = client(KMSClient, region, ctx);
  const kms = await section("kms:GetKeyRotationStatus", ctx, async () => {
    const keys = (await kmsClient.send(new ListKeysCommand({ Limit: 100 }))).Keys ?? [];
    const aliases = new Map<string, string>();
    try {
      for (const a of (await kmsClient.send(new ListAliasesCommand({ Limit: 100 }))).Aliases ?? []) {
        if (a.TargetKeyId && a.AliasName) aliases.set(a.TargetKeyId, a.AliasName);
      }
    } catch {
      /* labels only */
    }
    const out: { id: string; alias: string | null; rotation: boolean }[] = [];
    await pool(keys, 5, ctx, async (k) => {
      const d = (await kmsClient.send(new DescribeKeyCommand({ KeyId: k.KeyId }))).KeyMetadata;
      // Customer-managed, symmetric, enabled, AWS-generated material: the only keys rotation applies to.
      if (d?.KeyManager !== "CUSTOMER" || d.KeySpec !== "SYMMETRIC_DEFAULT" || d.KeyState !== "Enabled" || d.Origin !== "AWS_KMS") return;
      const r = await kmsClient.send(new GetKeyRotationStatusCommand({ KeyId: k.KeyId }));
      out.push({ id: k.KeyId!, alias: aliases.get(k.KeyId!) ?? null, rotation: Boolean(r.KeyRotationEnabled) });
    });
    return out;
  });

  const ecr = client(ECRClient, region, ctx);
  const images = await section("ecr:DescribeImages", ctx, async () => {
    const repos = (await ecr.send(new DescribeRepositoriesCommand({ maxResults: 100 }))).repositories ?? [];
    const out: { repository: string; scanned: boolean; critical: number; high: number; pushedAt: string | null }[] = [];
    await pool(repos.slice(0, 50), 4, ctx, async (repo) => {
      const r = await ecr.send(new DescribeEcrImagesCommand({ repositoryName: repo.repositoryName, maxResults: 100 }));
      const latest = (r.imageDetails ?? []).sort((a, b) => (b.imagePushedAt?.getTime() ?? 0) - (a.imagePushedAt?.getTime() ?? 0))[0];
      if (!latest) return;
      const summary = latest.imageScanFindingsSummary;
      const counts = summary?.findingSeverityCounts ?? {};
      out.push({
        repository: repo.repositoryName!,
        scanned: Boolean(summary && latest.imageScanStatus?.status !== "FAILED"),
        critical: counts.CRITICAL ?? 0,
        high: counts.HIGH ?? 0,
        pushedAt: latest.imagePushedAt?.toISOString() ?? null,
      });
    });
    return out;
  });

  const insp = client(Inspector2Client, region, ctx);
  const inspector = await section("inspector2:ListFindingAggregations", ctx, async () => {
    const status = await insp.send(new BatchGetAccountStatusCommand({ accountIds: [ctx.accountId] }));
    const rs = status.accounts?.[0]?.resourceState;
    const enabled = [rs?.ec2?.status, rs?.ecr?.status, rs?.lambda?.status].includes("ENABLED");
    if (!enabled) return { enabled: false, critical: 0, high: 0 };
    const agg = await insp.send(new ListFindingAggregationsCommand({ aggregationType: "ACCOUNT" }));
    const counts = agg.responses?.[0]?.accountAggregation?.severityCounts;
    return { enabled: true, critical: counts?.critical ?? 0, high: counts?.high ?? 0 };
  });

  const configRecording = await section("config:DescribeConfigurationRecorderStatus", ctx, async () => {
    const r = await client(ConfigServiceClient, region, ctx).send(new DescribeConfigurationRecorderStatusCommand({}));
    return Boolean(r.ConfigurationRecordersStatus?.some((x) => x.recording));
  });

  const securityHub = await section("securityhub:DescribeHub", ctx, async () => {
    try {
      await client(SecurityHubClient, region, ctx).send(new DescribeHubCommand({}));
      return true;
    } catch (err) {
      if (/InvalidAccessException|ResourceNotFound/i.test(errorName(err)) || NOT_SUBSCRIBED.test(errorName(err)) || NOT_SUBSCRIBED.test((err as Error)?.message ?? "")) return false;
      throw err;
    }
  });

  // AWS Backup: what's protected, restores that ran, and where copies went.
  const bk = client(BackupClient, region, ctx);
  const backup = await section("backup:ListProtectedResources", ctx, async (): Promise<BackupInfo> => {
    const prot = await collectPages(
      () => bk.send(new ListProtectedResourcesCommand({ MaxResults: 500 })),
      (t) => bk.send(new ListProtectedResourcesCommand({ MaxResults: 500, NextToken: t })),
      (p) => p.Results,
      (p) => p.NextToken,
      1000,
      ctx,
    );
    const yearAgo = new Date(Date.now() - 365 * 86_400_000);
    const [jobs, plans, copies] = await Promise.all([
      bk.send(new ListRestoreJobsCommand({ ByStatus: "COMPLETED", ByCreatedAfter: yearAgo, MaxResults: 100 })).then((r) => r.RestoreJobs ?? []),
      bk.send(new ListRestoreTestingPlansCommand({ MaxResults: 50 })).then((r) => r.RestoreTestingPlans?.length ?? 0).catch(() => 0),
      bk
        .send(new ListCopyJobsCommand({ ByState: "COMPLETED", ByCreatedAfter: new Date(Date.now() - 30 * 86_400_000), MaxResults: 200 }))
        .then((r) => r.CopyJobs ?? [])
        .catch(() => []),
    ]);
    return {
      protected: prot.map((x) => ({ arn: x.ResourceArn ?? "", type: x.ResourceType ?? "", lastBackup: x.LastBackupTime?.toISOString() ?? null })),
      restores: jobs.map((j) => ({
        id: j.RestoreJobId ?? "",
        accountId: ctx.accountId,
        region,
        via: "AWS Backup",
        resourceType: j.ResourceType ?? "resource",
        source: j.SourceResourceArn?.split(/[:/]/).pop() ?? null,
        at: (j.CompletionDate ?? j.CreationDate)?.toISOString() ?? new Date().toISOString(),
        automated: Boolean(j.CreatedBy?.RestoreTestingPlanArn),
      })),
      testingPlans: plans,
      copies: copies.map((c) => {
        // arn:aws:backup:REGION:ACCOUNT:backup-vault:NAME
        const [, , , destRegion, destAccount] = (c.DestinationBackupVaultArn ?? "").split(":");
        return { resourceArn: c.ResourceArn ?? null, region: destRegion || region, accountId: destAccount || null };
      }),
    };
  });

  return {
    ebsDefaultEncryption,
    unencryptedVolumes,
    publicEbsSnapshots,
    publicAmis,
    securityGroups,
    rds: rdsSection,
    engineSupport,
    publicRdsSnapshots,
    dynamo,
    lambda,
    eks,
    guardduty,
    kms,
    images,
    inspector,
    vpcsWithoutFlowLogs,
    configRecording,
    securityHub,
    backup,
    inventory,
  };
}

// ---------------------------------------------------------------- account

export interface CollectOptions {
  /** Regions the customer chose; null = detect the active ones. */
  regions: string[] | null;
  /** Total budget for this account, ms. */
  budgetMs: number;
  /** Every connected account id: Identity Center assignments are read into these. */
  targetAccounts?: string[];
  /** Read console changes after this time; null = don't (out-of-scope accounts). */
  changesSince?: Date | null;
  /** Look for native RDS/DynamoDB restores in CloudTrail's 90-day history. */
  lookForRestores?: boolean;
}

export async function collectAccount(ctx: Omit<ScanCtx, "deadline">, opts: CollectOptions): Promise<AccountPosture> {
  const started = Date.now();
  const full: ScanCtx = { ...ctx, deadline: started + opts.budgetMs };

  const [cred, pwd, admins, bpa, bkts, trls, alias, enabled] = await Promise.all([
    credentialReport(full),
    passwordPolicy(full),
    adminUsers(full),
    accountBpa(full),
    buckets(full),
    trails(full),
    accountAlias(full),
    enabledRegions(full).catch(() => [] as string[]),
  ]);

  let candidates: string[];
  if (opts.regions?.length) {
    candidates = enabled.length ? opts.regions.filter((r) => enabled.includes(r)) : opts.regions;
  } else {
    const bucketRegions = new Set(bkts.ok ? bkts.data.map((b) => b.region) : []);
    const probed = await pool(enabled, 6, full, async (r) => ({
      r,
      state: bucketRegions.has(r) ? ("active" as const) : await regionState(r, full),
    }));
    candidates = probed.filter((p) => p.state !== "inactive").map((p) => p.r).sort();
    // Regions the budget ran out on before they could even be probed are unknown too.
    for (const r of enabled) if (!probed.some((p) => p.r === r)) candidates.push(r);
  }

  const regional: Record<string, RegionalPosture> = {};
  const unscanned: { region: string; reason: string }[] = [];
  // People and console changes don't depend on the regional scan: run them alongside it.
  const sideRegions = enabled.length ? enabled : candidates.length ? candidates : [HOME];
  const [ic, org, trail] = await Promise.all([
    identityCenter(full, sideRegions, [...new Set([ctx.accountId, ...(opts.targetAccounts ?? [])])]),
    organizationOf(full),
    opts.changesSince
      ? collectCloudTrail(full, {
          changeRegions: [...new Set([HOME, ...candidates])],
          since: opts.changesSince,
          restoreRegions: [],
          maxPagesPerRegion: 12,
        })
      : Promise.resolve(null),
    pool(candidates, 3, full, async (region) => {
      // Leave room: a region started with seconds to spare would come back half-read.
      if (timeLeft(full) < 6_000) {
        unscanned.push({ region, reason: "scan time ran out" });
        return;
      }
      regional[region] = await collectRegion(region, full);
    }),
  ]);
  for (const r of candidates) {
    if (!regional[r] && !unscanned.some((u) => u.region === r)) unscanned.push({ region: r, reason: "scan time ran out" });
  }

  // Native restores: only where there are databases or tables to restore.
  const restoreRegions = Object.entries(regional)
    .map(([region, r]) => ({ region, rds: r.inventory.databases > 0, dynamodb: r.inventory.tables > 0 }))
    .filter((r) => r.rds || r.dynamodb);
  const restores =
    opts.lookForRestores && restoreRegions.length
      ? (await collectCloudTrail(full, { changeRegions: [], since: null, restoreRegions, maxPagesPerRegion: 1 })).restores
      : null;

  return {
    accountId: ctx.accountId,
    alias,
    scannedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    regions: { enabled, active: candidates, scanned: Object.keys(regional).sort(), unscanned },
    credentialReport: cred,
    passwordPolicy: pwd,
    adminUsers: admins,
    accountBpa: bpa,
    buckets: bkts,
    trails: trls,
    regional,
    identityCenter: ic,
    organization: org,
    changes: trail?.changes ?? null,
    nativeRestores: restores,
  };
}
