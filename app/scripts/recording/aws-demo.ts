/**
 * The sample AWS estate the AWS clips (16–20) are filmed against, and the way
 * back to the real connection afterwards.
 *
 *   npx tsx scripts/recording/aws-demo.ts stage     real AWS → saved aside, sample in
 *   npx tsx scripts/recording/aws-demo.ts restore   sample out, real AWS back, re-scanned
 *
 * The recording workspace is connected to a real (nearly empty) AWS account.
 * Filming that would show little and put a real account number on screen, so
 * the clips use Northwind's invented estate instead — with AWS's own
 * documentation account numbers (123456789012, 111122223333). As with seed.ts,
 * nothing on screen is drawn by hand: the sample posture goes through the real
 * evaluators, merge, people matching, facts and checks engine, so every verdict
 * is exactly what the product would say about a company in this state.
 *
 * The real rows are kept in recordings/.aws-real.json (git-ignored) between
 * stage and restore. Don't run the daily sync in between.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountPosture,
  AccountScan,
  AwsIdentity,
  ChangeEvent,
  RegionalPosture,
  RestoreRecord,
  Section,
} from "@/lib/aws/types";
import { recordingCompanyId } from "./scene";

const BACKUP = path.resolve(process.cwd(), "..", "recordings", ".aws-real.json");

export const DEMO_PROD = "123456789012";
export const DEMO_STAGING = "111122223333";
/** Shown on the Connect screen while filming, instead of the workspace's real one. */
const DEMO_EXTERNAL_ID = "sf-3b9e7c1d5a2f4e6b8d0c2a4e6f8b0d1c";

const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const ok = <T,>(data: T): Section<T> => ({ ok: true, data });

const ENABLED = [
  "eu-central-1", "eu-west-1", "eu-west-2", "eu-west-3", "eu-north-1", "us-east-1", "us-east-2", "us-west-1",
  "us-west-2", "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2",
  "ap-northeast-3", "ca-central-1", "sa-east-1",
];

function region(over: Partial<RegionalPosture>): RegionalPosture {
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
    images: ok([]),
    inspector: ok({ enabled: false, critical: 0, high: 0 }),
    vpcsWithoutFlowLogs: ok([]),
    configRecording: ok(true),
    securityHub: ok(false),
    backup: ok({ protected: [], restores: [], testingPlans: 0, copies: [] }),
    inventory: { instances: 0, volumes: 0, databases: 0, functions: 0, tables: 0, clusters: 0 },
    ...over,
  };
}

const RESTORE: RestoreRecord = {
  id: "demo-restore-0914",
  accountId: DEMO_PROD,
  region: "eu-central-1",
  via: "AWS Backup",
  resourceType: "RDS",
  source: "northwind-db",
  at: ago(28),
  automated: true,
};

function prodPosture(): AccountPosture {
  return {
    accountId: DEMO_PROD,
    alias: "northwind-prod",
    scannedAt: NOW.toISOString(),
    durationMs: 21_400,
    regions: { enabled: ENABLED, active: ["eu-central-1"], scanned: ["eu-central-1"], unscanned: [] },
    credentialReport: ok([
      { user: "<root_account>", arn: "root", createdAt: "2022-01-10", passwordEnabled: true, passwordLastUsed: ago(210), mfaActive: true, keys: [{ active: false, lastRotated: null, lastUsed: null }, { active: false, lastRotated: null, lastUsed: null }] },
      { user: "ci-deploy", arn: "u/ci-deploy", createdAt: "2023-04-02", passwordEnabled: false, passwordLastUsed: null, mfaActive: false, keys: [{ active: true, lastRotated: ago(21), lastUsed: ago(0.2) }, { active: false, lastRotated: null, lastUsed: null }] },
      { user: "legacy-reports", arn: "u/legacy-reports", createdAt: "2023-09-14", passwordEnabled: false, passwordLastUsed: null, mfaActive: false, keys: [{ active: true, lastRotated: ago(412), lastUsed: ago(118) }, { active: false, lastRotated: null, lastUsed: null }] },
    ]),
    passwordPolicy: ok({ minimumLength: 14, maxPasswordAge: null, reusePrevention: 24 }),
    adminUsers: ok([]),
    accountBpa: ok({ blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: true, restrictPublicBuckets: true }),
    buckets: ok(
      ["northwind-app-uploads", "northwind-exports", "northwind-cloudtrail-logs"].map((name) => ({
        name, region: "eu-central-1", policyPublic: false, aclPublic: false, bucketBpa: null, tags: {},
      })),
    ),
    trails: ok([
      { arn: "trail", name: "northwind-trail", homeRegion: "eu-central-1", multiRegion: true, organization: true, logging: true, logValidation: true, s3Bucket: "northwind-cloudtrail-logs", retentionDays: 400, retentionSource: "S3 bucket northwind-cloudtrail-logs" },
    ]),
    regional: {
      "eu-central-1": region({
        securityGroups: ok([
          { id: "sg-0b4e1f2a9c3d", name: "bastion-ssh", vpcId: "vpc-0a1c", inUse: true, openAdminPorts: [22], openDbPorts: [], allPortsOpen: false, tags: {} },
          { id: "sg-07c2d8e1f4a6", name: "alb-public", vpcId: "vpc-0a1c", inUse: true, openAdminPorts: [], openDbPorts: [], allPortsOpen: false, tags: {} },
        ]),
        rds: ok([
          { id: "northwind-db", kind: "instance", engine: "postgres", engineVersion: "13.15", instanceClass: "db.m6g.xlarge", encrypted: true, publiclyAccessible: false, backupRetentionDays: 14, deletionProtection: true, lifecycleSupport: "open-source-rds-extended-support", clusterId: null, tags: {} },
        ]),
        engineSupport: ok([{ engine: "postgres", major: "13", standardEnd: "2026-02-28T00:00:00Z" }]),
        dynamo: ok([{ name: "events", pitr: true }, { name: "sessions", pitr: false }]),
        lambda: ok([
          { name: "report-export", runtime: "nodejs18.x", urlAuth: null },
          { name: "webhook-ingest", runtime: "nodejs22.x", urlAuth: "AWS_IAM" },
        ]),
        kms: ok([{ id: "5f2a8c1e-demo", alias: "alias/northwind-app", rotation: true }]),
        images: ok([{ repository: "northwind/api", scanned: true, critical: 0, high: 2, pushedAt: ago(2) }]),
        backup: ok({
          protected: [{ arn: `arn:aws:rds:eu-central-1:${DEMO_PROD}:db:northwind-db`, type: "RDS", lastBackup: ago(0.3) }],
          restores: [RESTORE],
          testingPlans: 1,
          // The finding the residency check is for: a backup copy rule nobody remembers.
          copies: [{ resourceArn: `arn:aws:rds:eu-central-1:${DEMO_PROD}:db:northwind-db`, region: "us-east-1", accountId: null }],
        }),
        inventory: { instances: 6, volumes: 8, databases: 1, functions: 2, tables: 2, clusters: 0 },
      }),
    },
    identityCenter: ok(null), // filled below, after the people are defined
    organization: ok({ managementAccountId: DEMO_PROD }),
    changes: null,
    nativeRestores: ok([]),
  };
}

function stagingPosture(): AccountPosture {
  return {
    accountId: DEMO_STAGING,
    alias: "northwind-staging",
    scannedAt: NOW.toISOString(),
    durationMs: 9_800,
    regions: { enabled: ENABLED, active: ["eu-central-1"], scanned: ["eu-central-1"], unscanned: [] },
    credentialReport: ok([
      { user: "<root_account>", arn: "root", createdAt: "2023-02-01", passwordEnabled: true, passwordLastUsed: ago(300), mfaActive: true, keys: [{ active: false, lastRotated: null, lastUsed: null }, { active: false, lastRotated: null, lastUsed: null }] },
    ]),
    passwordPolicy: ok({ minimumLength: 14, maxPasswordAge: null, reusePrevention: 24 }),
    adminUsers: ok([]),
    accountBpa: ok({ blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: true, restrictPublicBuckets: true }),
    buckets: ok([{ name: "northwind-staging-uploads", region: "eu-central-1", policyPublic: false, aclPublic: false, bucketBpa: null, tags: {} }]),
    trails: ok([
      { arn: "trail", name: "northwind-trail", homeRegion: "eu-central-1", multiRegion: true, organization: true, logging: true, logValidation: true, s3Bucket: "northwind-cloudtrail-logs", retentionDays: 400, retentionSource: "S3 bucket northwind-cloudtrail-logs" },
    ]),
    regional: {
      "eu-central-1": region({
        ebsDefaultEncryption: ok(false),
        guardduty: ok({ enabled: false, oldHighFindings: [] }),
        rds: ok([{ id: "staging-db", kind: "instance", engine: "postgres", engineVersion: "16.4", instanceClass: "db.t4g.medium", encrypted: true, publiclyAccessible: false, backupRetentionDays: 1, deletionProtection: false, lifecycleSupport: null, clusterId: null, tags: {} }]),
        engineSupport: ok([{ engine: "postgres", major: "16", standardEnd: "2029-02-28T00:00:00Z" }]),
        inventory: { instances: 2, volumes: 2, databases: 1, functions: 0, tables: 0, clusters: 0 },
      }),
    },
    identityCenter: ok(null),
    organization: ok({ managementAccountId: DEMO_PROD }),
    changes: null,
    nativeRestores: null,
  };
}

/** Identity Center users. Priya left in August and is still in the Platform group. */
function ssoUsers(): AwsIdentity[] {
  const g = (accountId: string, role: string, admin: boolean, via: string | null) => ({ accountId, role, admin, via });
  const u = (id: string, name: string, email: string, access: AwsIdentity["access"]): AwsIdentity => ({
    id: `sso:${id}`, kind: "sso", name, email, active: true, console: true, keys: 0, mfa: null, lastUsed: null, access,
  });
  return [
    u("u-sam", "Sam Okafor", "sam@northwind.test", [g(DEMO_PROD, "AdministratorAccess", true, "group Platform"), g(DEMO_STAGING, "AdministratorAccess", true, "group Platform")]),
    u("u-daniel", "Daniel Weber", "daniel@northwind.test", [g(DEMO_PROD, "AdministratorAccess", true, "group Platform")]),
    u("u-priya", "Priya Nair", "priya@northwind.test", [g(DEMO_PROD, "AdministratorAccess", true, "group Platform"), g(DEMO_STAGING, "AdministratorAccess", true, "group Platform")]),
    u("u-amara", "Amara Osei", "amara@northwind.test", [g(DEMO_PROD, "DeveloperAccess", false, "group Engineering"), g(DEMO_STAGING, "AdministratorAccess", true, "group Engineering")]),
    u("u-lukas", "Lukas Brandt", "lukas@northwind.test", [g(DEMO_PROD, "ReadOnlyAccess", false, "group Engineering"), g(DEMO_STAGING, "DeveloperAccess", false, "group Engineering")]),
    u("u-ravi", "Ravi Patel", "ravi@northwind.test", [g(DEMO_PROD, "DataEngineer", false, null)]),
    u("u-omar", "Omar Haddad", "omar@northwind.test", [g(DEMO_STAGING, "DeveloperAccess", false, "group Engineering")]),
    u("u-noah", "Noah Kim", "noah@northwind.test", [g(DEMO_STAGING, "DeveloperAccess", false, "group Engineering")]),
    u("u-alex", "Alex Moreau", "alex.moreau@contractor.test", [g(DEMO_PROD, "ReadOnlyAccess", false, null)]),
  ];
}

/** Console changes in production this month — the change-management sample. */
function changes(): ChangeEvent[] {
  const c = (id: string, days: number, principal: string, source: string, name: string, resources: string): ChangeEvent => ({
    eventId: `demo-${id}`, accountId: DEMO_PROD, region: "eu-central-1", at: ago(days), name, source, principal, via: "console", resources,
  });
  return [
    c("sg-open", 1.8, "sam@northwind.test (AdministratorAccess)", "ec2", "AuthorizeSecurityGroupIngress", "sg-0b4e1f2a9c3d"),
    c("db-storage", 4.2, "daniel@northwind.test (AdministratorAccess)", "rds", "ModifyDBInstance", "northwind-db"),
    c("exports-policy", 5.1, "ravi@northwind.test (DataEngineer)", "s3", "PutBucketPolicy", "northwind-exports"),
    c("lambda-env", 12.4, "amara@northwind.test (DeveloperAccess)", "lambda", "UpdateFunctionConfiguration", "report-export"),
    c("alarm", 19.7, "sam@northwind.test (AdministratorAccess)", "monitoring", "PutMetricAlarm", "northwind-db-cpu-high"),
  ];
}

type Real = {
  companyId: string;
  /** observed_at of the sample batch in check_history, removed on restore. */
  demoHistoryAt?: string | null;
  accounts: Record<string, unknown>[];
  umbrella: { id: string; status: string; metadata: Record<string, unknown> | null } | null;
  connect: Record<string, unknown> | null;
  exceptions: Record<string, unknown>[];
  changeEvents: Record<string, unknown>[];
};

async function admin(): Promise<SupabaseClient> {
  const { createAdminSupabase } = await import("@/lib/supabase/admin");
  return createAdminSupabase();
}

export async function stageAwsDemo() {
  if (existsSync(BACKUP)) throw new Error("A real AWS backup is already set aside — run `aws-demo.ts restore` first.");
  const db = await admin();
  const companyId = await recordingCompanyId(db);
  const { evaluateAccount, resourceId } = await import("@/lib/aws/evaluate");
  const { iamIdentities } = await import("@/lib/aws/people");
  const { mergePeople } = await import("@/lib/aws/roster");
  const { dataStores } = await import("@/lib/aws/stores");
  const { mergeInScope } = await import("@/lib/aws/scan");
  const { awsFacts, publishableFacts } = await import("@/lib/aws/facts");
  const { recordChecksForSyncAdmin } = await import("@/lib/checks");

  // 1. Set the real connection aside, whole.
  const [acc, umb, con, exc, chg] = await Promise.all([
    db.from("aws_accounts").select("*").eq("company_id", companyId),
    db.from("integrations").select("id, status, metadata").eq("company_id", companyId).eq("provider", "aws").maybeSingle(),
    db.from("aws_connect_requests").select("*").eq("company_id", companyId).maybeSingle(),
    db.from("check_exceptions").select("*").eq("company_id", companyId).like("check_key", "aws.%"),
    db.from("aws_change_events").select("*").eq("company_id", companyId),
  ]);
  if (!umb.data) throw new Error("AWS isn't connected in the recording workspace.");
  const real: Real = {
    companyId,
    accounts: acc.data ?? [],
    umbrella: umb.data as Real["umbrella"],
    connect: (con.data as Record<string, unknown> | null) ?? null,
    exceptions: exc.data ?? [],
    changeEvents: chg.data ?? [],
  };
  mkdirSync(path.dirname(BACKUP), { recursive: true });
  writeFileSync(BACKUP, JSON.stringify(real));

  await db.from("aws_accounts").delete().eq("company_id", companyId);
  await db.from("check_exceptions").delete().eq("company_id", companyId).like("check_key", "aws.%");
  await db.from("aws_change_events").delete().eq("company_id", companyId);
  await db.from("aws_connect_requests").upsert({ company_id: companyId, external_id: DEMO_EXTERNAL_ID }, { onConflict: "company_id" });

  // 2. The sample estate, through the real evaluators.
  const settings = { logRetentionDays: 365, restoreTestDays: 365, residency: "eu" as const, showOnTrustCenter: true };
  const events = changes();
  const exceptions = [
    { checkKey: "aws.dynamodb_pitr", resourceId: resourceId(DEMO_PROD, "eu-central-1", "table", "sessions"), reason: "Login sessions only — rebuilt on loss, nothing to recover.", expiresAt: null },
    { checkKey: "aws.manual_changes", resourceId: resourceId(DEMO_PROD, "eu-central-1", "change", "demo-db-storage"), reason: "Incident #212: storage raised during the outage; codified in PR #918.", expiresAt: null },
  ];
  const prod = prodPosture();
  const users = ssoUsers();
  prod.identityCenter = ok({ instanceArn: "arn:aws:sso:::instance/ssoins-demo", region: "eu-central-1", ownerAccountId: DEMO_PROD, users, truncated: false });

  const toScan = (p: AccountPosture, inScope: boolean): AccountScan => {
    const restores = inScope && p.accountId === DEMO_PROD ? [RESTORE] : [];
    const recent = inScope ? events.filter((e) => Date.parse(e.at) >= NOW.getTime() - 7 * 86_400_000) : undefined;
    const results = evaluateAccount(p, { now: NOW, exceptions, logRetentionDays: 365, restores, restoreTestDays: 365, residency: "eu", recentChanges: recent });
    const inv = { instances: 0, volumes: 0, databases: 0, functions: 0, tables: 0, clusters: 0 };
    const regionInventory: Record<string, RegionalPosture["inventory"]> = {};
    for (const [r, x] of Object.entries(p.regional)) {
      regionInventory[r] = x.inventory;
      for (const k of Object.keys(inv) as (keyof typeof inv)[]) inv[k] += x.inventory[k];
    }
    const ic = p.identityCenter.ok ? p.identityCenter.data : null;
    return {
      accountId: p.accountId,
      alias: p.alias,
      scannedAt: p.scannedAt,
      durationMs: p.durationMs,
      regions: p.regions,
      results,
      inventory: { ...inv, regions: p.regions.scanned, buckets: p.buckets.ok ? p.buckets.data.length : 0 },
      regionInventory,
      people: {
        identities: [...(ic?.users ?? []), ...(p.credentialReport.ok ? iamIdentities(p.accountId, p.credentialReport.data, []) : [])],
        identityCenter: ic ? { region: ic.region, instanceArn: ic.instanceArn } : null,
        organization: p.organization.ok ? p.organization.data : null,
        truncated: false,
        gaps: [],
      },
      restores,
      stores: dataStores(p),
      restoreTestingPlans: Object.values(p.regional).reduce((n, r) => n + (r.backup.ok ? r.backup.data.testingPlans : 0), 0),
      changesCoverage: inScope ? { from: ago(90), until: NOW.toISOString() } : null,
    };
  };
  const prodScan = toScan(prod, true);
  const stagingScan = toScan(stagingPosture(), false);

  const row = (accountId: string, alias: string, inScope: boolean, scan: AccountScan) => ({
    company_id: companyId,
    account_id: accountId,
    alias,
    auth_kind: "role",
    role_arn: `arn:aws:iam::${accountId}:role/ShieldFlowAudit`,
    external_id: DEMO_EXTERNAL_ID,
    in_scope: inScope,
    status: "connected",
    last_synced_at: NOW.toISOString(),
    last_scan: scan,
  });
  const { error: insErr } = await db.from("aws_accounts").insert([
    row(DEMO_PROD, "northwind-prod", true, prodScan),
    row(DEMO_STAGING, "northwind-staging", false, stagingScan),
  ]);
  if (insErr) throw new Error(`insert accounts: ${insErr.message}`);

  await db.from("aws_change_events").insert(
    events.map((e) => ({
      company_id: companyId, account_id: e.accountId, region: e.region, event_id: e.eventId, event_time: e.at,
      event_name: e.name, event_source: e.source, principal: e.principal, via: e.via, resources: e.resources,
    })),
  );
  await db.from("check_exceptions").insert(
    exceptions.map((x) => ({ company_id: companyId, check_key: x.checkKey, resource_id: x.resourceId, label: x.resourceId.split("/").pop(), reason: x.reason, expires_at: null })),
  );

  // 3. Through the checks engine, so the dashboard, controls and People verdicts agree.
  const people = mergePeople([{ scan: prodScan, inScope: true }, { scan: stagingScan, inScope: false }]);
  const workspace = {
    accounts: [],
    rawChecks: mergeInScope([prodScan]),
    people,
  };
  await recordChecksForSyncAdmin(db, companyId, "aws", workspace, null);
  // The sample's history batch, by the database's clock (this machine's may differ).
  const { data: batch } = await db
    .from("check_history").select("observed_at").eq("company_id", companyId).eq("provider", "aws")
    .order("observed_at", { ascending: false }).limit(1).maybeSingle();
  real.demoHistoryAt = (batch?.observed_at as string | undefined) ?? null;
  writeFileSync(BACKUP, JSON.stringify(real));

  const facts = awsFacts([prodScan], people, settings);
  await db
    .from("integrations")
    .update({ status: "connected", metadata: { ...(real.umbrella?.metadata ?? {}), settings, published_facts: publishableFacts(facts) } })
    .eq("id", real.umbrella!.id);

  const fails = prodScan.results.filter((r) => r.result === "fail").map((r) => r.key.replace("aws.", ""));
  console.log(`staged: northwind-prod (${fails.length} failing: ${fails.join(", ")}) + northwind-staging; ${events.length} console changes`);
}

export async function restoreAwsReal() {
  if (!existsSync(BACKUP)) throw new Error("Nothing set aside — the real AWS connection was never staged out.");
  const real = JSON.parse(readFileSync(BACKUP, "utf8")) as Real;
  const db = await admin();
  const { companyId } = real;

  await db.from("aws_accounts").delete().eq("company_id", companyId);
  await db.from("check_exceptions").delete().eq("company_id", companyId).like("check_key", "aws.%");
  await db.from("aws_change_events").delete().eq("company_id", companyId);

  const fail = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };
  if (real.accounts.length) fail("restore accounts", (await db.from("aws_accounts").insert(real.accounts)).error);
  if (real.exceptions.length) fail("restore exceptions", (await db.from("check_exceptions").insert(real.exceptions)).error);
  if (real.changeEvents.length) fail("restore change events", (await db.from("aws_change_events").insert(real.changeEvents)).error);
  if (real.connect) await db.from("aws_connect_requests").upsert(real.connect, { onConflict: "company_id" });
  else await db.from("aws_connect_requests").delete().eq("company_id", companyId);
  if (real.umbrella) {
    await db.from("integrations").update({ status: real.umbrella.status, metadata: real.umbrella.metadata }).eq("id", real.umbrella.id);
  }

  // The sample's verdicts don't belong in the real history (the weekly email diffs it).
  if (real.demoHistoryAt) {
    const at = Date.parse(real.demoHistoryAt);
    await db.from("check_history").delete().eq("company_id", companyId).eq("provider", "aws")
      .gte("observed_at", new Date(at - 1000).toISOString()).lte("observed_at", new Date(at + 1000).toISOString());
  }

  // Real verdicts back in control_checks: one scan of the real account.
  const { scanWorkspace } = await import("@/lib/aws/scan");
  const { recordChecksForSyncAdmin } = await import("@/lib/checks");
  const scan = await scanWorkspace(db, companyId);
  await recordChecksForSyncAdmin(db, companyId, "aws", scan, null);
  rmSync(BACKUP);
  console.log(`restored: ${real.accounts.length} real account(s), re-scanned (${scan.rawChecks.filter((c) => c.result === "fail").length} failing)`);
}

if (require.main === module) {
  const cmd = process.argv[2];
  (cmd === "stage" ? stageAwsDemo() : cmd === "restore" ? restoreAwsReal() : Promise.reject(new Error("stage | restore")))
    .catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
