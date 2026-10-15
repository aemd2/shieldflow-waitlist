import { exceptionMap, resourceKey, Verdict, type ExceptionRow } from "@/lib/checks-core";
import { runtimeStatus } from "@/lib/aws/runtimes";
import { majorVersion } from "@/lib/aws/majors";
import { allowedRegion, dataStores, RESIDENCY_LABEL, STORE_LABEL, type Residency } from "@/lib/aws/stores";
import type {
  AccountPosture,
  AwsCheckResult,
  AwsResource,
  ChangeEvent,
  RegionalPosture,
  RestoreRecord,
  Section,
  Tags,
} from "@/lib/aws/types";

/**
 * Posture → verdicts. Pure: no AWS calls, no database — so every path can be
 * pinned down in lib/aws/checks.cases.ts.
 *
 * Rules that hold for every check:
 *  - a failure names the exact resources (capped, count kept);
 *  - resources tagged `shieldflow:scope=out` or excepted by a person are reported
 *    as accepted with the reason, and never fail the check;
 *  - anything we couldn't read (permission missing, region not scanned in time)
 *    makes the check inconclusive and says what — never a silent pass;
 *  - a real failure still fails even if some other region couldn't be read.
 */

export type { ExceptionRow } from "@/lib/checks-core";
export { SCOPE_TAG } from "@/lib/checks-core";

export interface EvaluateOptions {
  now: Date;
  exceptions: ExceptionRow[];
  /** Minimum days audit logs must be kept (workspace policy). */
  logRetentionDays: number;
  /** Restores known for this account: carried forward from earlier scans plus this one. */
  restores?: RestoreRecord[];
  /** How recent a restore test must be (workspace policy). */
  restoreTestDays?: number;
  /** Where the workspace has committed to keep data; unset = no residency check. */
  residency?: Residency | null;
  /** Console/root changes in this account in the last 7 days; null = couldn't be read; undefined = not tracked (out of scope). */
  recentChanges?: ChangeEvent[] | null;
}

const DAY = 86_400_000;

export function resourceId(account: string, region: string | null, type: string, id: string): string {
  return resourceKey(account, region, type, id);
}

const daysAgo = (iso: string | null, now: Date) => (iso ? (now.getTime() - Date.parse(iso)) / DAY : Infinity);

/** The regions a regional check covers, with gaps recorded for ones not scanned. */
function eachRegion(p: AccountPosture, v: Verdict, fn: (region: string, r: RegionalPosture) => void) {
  for (const u of p.regions.unscanned) v.gap(`${u.region} not scanned (${u.reason})`);
  for (const [region, r] of Object.entries(p.regional)) fn(region, r);
}

// Rough vCPU count from an RDS instance class, for the Extended Support estimate.
const SIZE_VCPU: Record<string, number> = {
  micro: 2, small: 2, medium: 2, large: 2, xlarge: 4, "2xlarge": 8, "4xlarge": 16, "8xlarge": 32,
  "12xlarge": 48, "16xlarge": 64, "24xlarge": 96, "32xlarge": 128, "48xlarge": 192,
};
export function vcpusOf(instanceClass: string | null): number {
  const size = instanceClass?.split(".").pop() ?? "";
  return SIZE_VCPU[size] ?? 2;
}

export function evaluateAccount(p: AccountPosture, opts: EvaluateOptions): AwsCheckResult[] {
  const { now } = opts;
  const acct = p.accountId;
  const exceptions = exceptionMap(opts.exceptions, now);
  const V = (key: string) => new Verdict<AwsResource>(key, exceptions);
  // An account with nothing running anywhere passes the regional checks on
  // nothing — say so plainly instead of "every database is encrypted".
  const nothing = !Object.keys(p.regional).length && !p.regions.unscanned.length;
  const regional = (text: string) => (nothing ? "Nothing to check yet: there are no resources in any region." : text);
  const out: AwsCheckResult[] = [];
  const user = (name: string, label = name): AwsResource => ({ id: resourceId(acct, null, "user", name), label, region: null, accountId: acct });
  const at = (region: string | null, type: string, id: string, label = id): AwsResource => ({ id: resourceId(acct, region, type, id), label, region, accountId: acct });

  // ------------------------------------------------------------ identity
  const report = p.credentialReport.ok ? p.credentialReport.data : null;
  const root = report?.find((r) => r.user === "<root_account>") ?? null;
  const users = report?.filter((r) => r.user !== "<root_account>") ?? [];

  {
    const v = V("aws.root_mfa");
    const rows = v.read(p.credentialReport, "IAM credential report");
    if (rows && !root) v.gap("the credential report had no root row");
    if (root && !root.mfaActive) v.flag(user("<root_account>", "root account"));
    out.push(v.settle("The root account has MFA.", () => "The root account has no MFA — anyone with its password owns the account."));
  }
  {
    const v = V("aws.root_access_keys");
    v.read(p.credentialReport, "IAM credential report");
    if (root?.keys.some((k) => k.active)) v.flag(user("<root_account>", "root account"));
    out.push(v.settle("The root account has no access keys.", () => "The root account has an active access key. Delete it — use roles for automation."));
  }
  {
    const v = V("aws.root_recent_use");
    v.read(p.credentialReport, "IAM credential report");
    if (root) {
      const last = [root.passwordLastUsed, ...root.keys.map((k) => k.lastUsed)].filter(Boolean) as string[];
      const recent = last.map((d) => daysAgo(d, now)).filter((d) => d <= 30);
      if (recent.length) v.flag(user("<root_account>", `root account (used ${Math.round(Math.min(...recent))} days ago)`));
    }
    out.push(v.settle("The root account hasn't been used in the last 30 days.", () => "The root account was used in the last 30 days. Check CloudTrail for what it did, and move that work to a normal role."));
  }
  {
    const v = V("aws.iam_user_mfa");
    v.read(p.credentialReport, "IAM credential report");
    for (const u of users) if (u.passwordEnabled && !u.mfaActive) v.flag(user(u.user));
    const consoleUsers = users.filter((u) => u.passwordEnabled).length;
    out.push(
      v.settle(
        consoleUsers ? `All ${consoleUsers} IAM users with a console password have MFA.` : "No IAM users can sign in to the console (access is through roles or Identity Center).",
        (n) => `${n} IAM ${n === 1 ? "user signs" : "users sign"} in to the console without MFA.`,
      ),
    );
  }
  {
    const v = V("aws.access_key_age");
    v.read(p.credentialReport, "IAM credential report");
    for (const u of users) {
      u.keys.forEach((k, i) => {
        const age = daysAgo(k.lastRotated, now);
        if (k.active && age > 90) v.flag(at(null, "access-key", `${u.user}#${i + 1}`, `${u.user} (key ${i + 1}, ${Math.round(age)} days old)`));
      });
    }
    out.push(v.settle("Every active access key is under 90 days old.", (n) => `${n} active access ${n === 1 ? "key is" : "keys are"} older than 90 days.`));
  }
  {
    const v = V("aws.unused_credentials");
    v.read(p.credentialReport, "IAM credential report");
    for (const u of users) {
      const created = daysAgo(u.createdAt, now);
      if (u.passwordEnabled) {
        const idle = u.passwordLastUsed ? daysAgo(u.passwordLastUsed, now) : created;
        if (idle > 90) v.flag(at(null, "password", u.user, `${u.user} (console password, ${u.passwordLastUsed ? `unused ${Math.round(idle)} days` : "never used"})`));
      }
      u.keys.forEach((k, i) => {
        if (!k.active) return;
        const idle = k.lastUsed ? daysAgo(k.lastUsed, now) : daysAgo(k.lastRotated, now);
        if (idle > 90) v.flag(at(null, "access-key", `${u.user}#${i + 1}`, `${u.user} (key ${i + 1}, ${k.lastUsed ? `unused ${Math.round(idle)} days` : "never used"})`));
      });
    }
    out.push(v.settle("No passwords or access keys have sat unused for 90+ days.", (n) => `${n} ${n === 1 ? "credential has" : "credentials have"} gone unused for 90+ days.`));
  }
  {
    const v = V("aws.password_policy");
    const pol = v.read(p.passwordPolicy, "password policy");
    if (p.passwordPolicy.ok && (pol === null || (pol.minimumLength ?? 0) < 8)) v.flag(at(null, "account", acct, "account password policy"));
    out.push(
      v.settle(
        `IAM password policy is set (minimum length ${pol?.minimumLength ?? "?"}).`,
        () => (pol === null ? "No IAM password policy is set." : `The IAM password policy allows passwords shorter than 8 characters (${pol?.minimumLength}).`),
      ),
    );
  }
  {
    const v = V("aws.admin_users");
    const admins = v.read(p.adminUsers, "IAM users");
    for (const a of admins ?? []) v.flag(at(null, "user", a.user, `${a.user} (${a.via})`));
    out.push(v.settle("No IAM user holds AdministratorAccess directly — admins assume a role.", (n) => `${n} IAM ${n === 1 ? "user has" : "users have"} standing admin access.`));
  }

  // ------------------------------------------------------------- logging
  const trailList = p.trails.ok ? p.trails.data : null;
  const live = (trailList ?? []).filter((t) => t.multiRegion && t.logging === true);
  {
    const v = V("aws.cloudtrail_enabled");
    const list = v.read(p.trails, "CloudTrail");
    if (list) {
      if (!live.length) {
        if (list.some((t) => t.multiRegion && t.logging === null)) v.gap("a multi-region trail's status couldn't be read");
        else {
          const stopped = list.filter((t) => t.multiRegion && t.logging === false);
          if (stopped.length) stopped.forEach((t) => v.flag(at(t.homeRegion, "trail", t.name)));
          else v.flag(at(null, "account", acct, "no multi-region trail"));
        }
      }
    }
    out.push(
      v.settle(
        `CloudTrail is recording every region (${live.map((t) => t.name).join(", ")}${live.some((t) => t.organization) ? ", organisation trail" : ""}).`,
        () => (list?.length ? "No trail is recording every region — a trail exists but is stopped or single-region." : "There is no CloudTrail trail: nothing records who does what in this account."),
      ),
    );
  }
  {
    const v = V("aws.cloudtrail_log_validation");
    const list = v.read(p.trails, "CloudTrail");
    if (list) {
      const relevant = live.length ? live : list;
      if (!relevant.length) v.flag(at(null, "account", acct, "no trail"));
      for (const t of relevant) if (!t.logValidation) v.flag(at(t.homeRegion, "trail", t.name));
    }
    const noTrail = Boolean(list && !list.length);
    out.push(v.settle("Log file validation is on, so the logs are tamper-evident.", (n) => (noTrail ? "There is no trail, so there are no logs to validate." : `${n} ${n === 1 ? "trail doesn't" : "trails don't"} validate log files.`)));
  }
  {
    const v = V("aws.log_retention");
    const list = v.read(p.trails, "CloudTrail");
    const want = opts.logRetentionDays;
    if (list) {
      const relevant = live.length ? live : list;
      if (!relevant.length) v.flag(at(null, "account", acct, "no audit log"));
      for (const t of relevant) {
        if (t.retentionDays === undefined) v.gap(`retention of ${t.name} unknown — ${t.retentionSource}`);
        else if (t.retentionDays !== null && t.retentionDays < want) {
          v.flag(at(t.homeRegion, "trail", t.name, `${t.name} (kept ${t.retentionDays} days in ${t.retentionSource})`));
        }
      }
    }
    const noLog = Boolean(list && !list.length);
    out.push(v.settle(`Audit logs are kept at least ${want} days.`, (n) => (noLog ? "There is no audit log to keep." : `${n} audit ${n === 1 ? "log is" : "logs are"} deleted sooner than your ${want}-day policy.`)));
  }

  // ----------------------------------------------------------- detection
  {
    const v = V("aws.guardduty_enabled");
    eachRegion(p, v, (region, r) => {
      const gd = v.read(r.guardduty, region);
      if (gd && !gd.enabled) v.flag(at(region, "region", region, `GuardDuty off in ${region}`));
    });
    const n = Object.keys(p.regional).length;
    out.push(v.settle(n ? `GuardDuty is on in all ${n} regions you use.` : regional("GuardDuty is on wherever you run anything."), (k) => `GuardDuty is off in ${k} ${k === 1 ? "region" : "regions"} you use.`));
  }
  {
    const v = V("aws.guardduty_findings");
    eachRegion(p, v, (region, r) => {
      const gd = v.read(r.guardduty, region);
      for (const f of gd?.oldHighFindings ?? []) v.flag(at(region, "finding", f.id, `${f.title} (severity ${f.severity})`));
    });
    out.push(v.settle(regional("No high-severity GuardDuty finding has been left open for over a week."), (n) => `${n} high-severity GuardDuty ${n === 1 ? "finding has" : "findings have"} been open for over a week.`));
  }

  // ------------------------------------------------------------ exposure
  const accountBpa = p.accountBpa.ok ? p.accountBpa.data : undefined;
  {
    const v = V("aws.s3_account_public_access_block");
    const b = v.read(p.accountBpa, "account Block Public Access");
    if (p.accountBpa.ok && (!b || !b.blockPublicAcls || !b.ignorePublicAcls || !b.blockPublicPolicy || !b.restrictPublicBuckets)) {
      v.flag(at(null, "account", acct, b ? "account Block Public Access (partly off)" : "account Block Public Access (off)"));
    }
    out.push(v.settle("S3 Block Public Access is on for the whole account.", () => "S3 Block Public Access isn't fully on for the account, so a bucket can still be made public by mistake."));
  }
  {
    const v = V("aws.s3_public_buckets");
    const list = v.read(p.buckets, "S3");
    for (const b of list ?? []) {
      const restrict = Boolean(accountBpa?.restrictPublicBuckets || b.bucketBpa?.restrictPublicBuckets);
      const ignoreAcls = Boolean(accountBpa?.ignorePublicAcls || b.bucketBpa?.ignorePublicAcls);
      if (b.policyPublic === null && b.aclPublic === null) {
        v.gap(`bucket ${b.name} couldn't be read`);
        continue;
      }
      const publicByPolicy = Boolean(b.policyPublic) && !restrict;
      const publicByAcl = Boolean(b.aclPublic) && !ignoreAcls;
      if ((publicByPolicy || publicByAcl) && accountBpa === undefined) {
        v.gap(`bucket ${b.name} may be public (the account's Block Public Access couldn't be read)`);
        continue;
      }
      if (publicByPolicy || publicByAcl) v.flag(at(b.region, "bucket", b.name, `${b.name} (public by ${publicByPolicy ? "bucket policy" : "ACL"})`), b.tags);
    }
    out.push(v.settle(`None of your ${list?.length ?? 0} buckets is public.`, (n) => `${n} S3 ${n === 1 ? "bucket is" : "buckets are"} public.`));
  }
  {
    const v = V("aws.public_snapshots");
    eachRegion(p, v, (region, r) => {
      for (const id of v.read(r.publicEbsSnapshots, region) ?? []) v.flag(at(region, "snapshot", id, `EBS snapshot ${id}`));
      for (const img of v.read(r.publicAmis, region) ?? []) v.flag(at(region, "ami", img.id, `machine image ${img.name}`));
      for (const id of v.read(r.publicRdsSnapshots, region) ?? []) v.flag(at(region, "db-snapshot", id, `database snapshot ${id}`));
    });
    out.push(v.settle(regional("No snapshots or machine images are shared publicly."), (n) => `${n} ${n === 1 ? "snapshot or image is" : "snapshots or images are"} public — anyone can restore them.`));
  }
  {
    const v = V("aws.rds_public");
    eachRegion(p, v, (region, r) => {
      for (const d of v.read(r.rds, region) ?? []) {
        if (d.kind === "instance" && d.publiclyAccessible) v.flag(at(region, "db", d.id, `${d.id} (${d.engine})`), d.tags);
      }
    });
    out.push(v.settle(regional("No database is publicly accessible."), (n) => `${n} ${n === 1 ? "database is" : "databases are"} reachable from the internet.`));
  }
  for (const [key, field, ports, noun] of [
    ["aws.open_admin_ports", "openAdminPorts", "SSH/RDP", "admin ports"],
    ["aws.open_database_ports", "openDbPorts", "database", "database ports"],
  ] as const) {
    const v = V(key);
    eachRegion(p, v, (region, r) => {
      for (const sg of v.read(r.securityGroups, region) ?? []) {
        const open = sg[field];
        if (!open.length) continue;
        const res = at(region, "security-group", sg.id, `${sg.name} (${sg.id}) — ${sg.allPortsOpen ? "all ports" : open.join(", ")} open to the internet`);
        if (!sg.inUse) v.accept(res, "not attached to anything");
        else v.flag(res, sg.tags);
      }
    });
    out.push(v.settle(regional(`No security group in use opens ${ports} ports to the internet.`), (n) => `${n} security ${n === 1 ? "group in use opens" : "groups in use open"} ${noun} to the whole internet.`));
  }
  {
    const v = V("aws.lambda_public_urls");
    eachRegion(p, v, (region, r) => {
      for (const f of v.read(r.lambda, region) ?? []) if (f.urlAuth === "NONE") v.flag(at(region, "function", f.name));
    });
    out.push(v.settle(regional("No Lambda function URL is open without authentication."), (n) => `${n} Lambda function ${n === 1 ? "URL is" : "URLs are"} callable by anyone, with no authentication.`));
  }

  // ---------------------------------------------------------- encryption
  {
    const v = V("aws.rds_encrypted");
    eachRegion(p, v, (region, r) => {
      for (const d of v.read(r.rds, region) ?? []) {
        if (d.clusterId) continue; // the cluster carries the setting
        if (!d.encrypted) v.flag(at(region, "db", d.id, `${d.id} (${d.engine})`), d.tags);
      }
    });
    out.push(v.settle(regional("Every database is encrypted at rest."), (n) => `${n} ${n === 1 ? "database isn't" : "databases aren't"} encrypted at rest.`));
  }
  {
    const v = V("aws.ebs_default_encryption");
    eachRegion(p, v, (region, r) => {
      const on = v.read(r.ebsDefaultEncryption, region);
      if (on === false) v.flag(at(region, "region", region, `EBS default encryption off in ${region}`));
    });
    out.push(v.settle(regional("New EBS volumes are encrypted by default in every region you use."), (n) => `EBS default encryption is off in ${n} ${n === 1 ? "region" : "regions"}.`));
  }
  {
    const v = V("aws.ebs_unencrypted_volumes");
    eachRegion(p, v, (region, r) => {
      for (const vol of v.read(r.unencryptedVolumes, region) ?? []) {
        v.flag(at(region, "volume", vol.id, `${vol.id}${vol.attached ? "" : " (unattached)"}`), vol.tags);
      }
    });
    out.push(v.settle(regional("No unencrypted EBS volumes."), (n) => `${n} EBS ${n === 1 ? "volume isn't" : "volumes aren't"} encrypted.`));
  }
  {
    const v = V("aws.kms_rotation");
    let keys = 0;
    eachRegion(p, v, (region, r) => {
      for (const k of v.read(r.kms, region) ?? []) {
        keys++;
        if (!k.rotation) v.flag(at(region, "key", k.id, k.alias ?? k.id));
      }
    });
    out.push(v.settle(keys ? `All ${keys} customer-managed keys rotate yearly.` : "No customer-managed KMS keys — AWS-managed keys rotate automatically.", (n) => `${n} customer-managed ${n === 1 ? "key doesn't" : "keys don't"} rotate.`));
  }

  // ------------------------------------------------------------ patching
  {
    const v = V("aws.lambda_runtimes");
    const soon: string[] = [];
    eachRegion(p, v, (region, r) => {
      for (const f of v.read(r.lambda, region) ?? []) {
        const s = runtimeStatus(f.runtime, now);
        if (s.status === "deprecated") v.flag(at(region, "function", f.name, `${f.name} (${f.runtime}, unsupported since ${s.date})`));
        else if (s.status === "soon") soon.push(`${f.name} (${f.runtime}, ${s.date})`);
      }
    });
    const soonNote = soon.length ? ` Coming up: ${soon.slice(0, 3).join(", ")}${soon.length > 3 ? ` and ${soon.length - 3} more` : ""}.` : "";
    out.push(v.settle(regional(`Every Lambda function is on a supported runtime.${soonNote}`), (n) => `${n} Lambda ${n === 1 ? "function runs" : "functions run"} on a runtime AWS no longer patches.${soonNote}`));
  }
  {
    const v = V("aws.rds_engine_support");
    eachRegion(p, v, (region, r) => {
      const dbs = v.read(r.rds, region) ?? [];
      const support = r.engineSupport.ok ? r.engineSupport.data : [];
      for (const d of dbs) {
        if (d.clusterId) continue;
        const major = majorVersion(d.engine, d.engineVersion);
        const end = support.find((s) => s.engine === d.engine && s.major === major)?.standardEnd ?? null;
        if (!end || Date.parse(end) > now.getTime()) continue;
        const vcpus =
          d.kind === "cluster"
            ? dbs.filter((x) => x.clusterId === d.id).reduce((n, x) => n + vcpusOf(x.instanceClass), 0) || 2
            : vcpusOf(d.instanceClass);
        const yearsPast = (now.getTime() - Date.parse(end)) / (365 * DAY);
        const paying = d.lifecycleSupport !== "open-source-rds-extended-support-disabled";
        if (paying) v.costPerMonth += vcpus * (yearsPast < 2 ? 0.1 : 0.2) * 730;
        v.flag(at(region, "db", d.id, `${d.id} (${d.engine} ${d.engineVersion}, standard support ended ${end.slice(0, 10)})`), d.tags);
      }
    });
    const cost = v.costPerMonth ? ` Estimated Extended Support charge: about $${Math.round(v.costPerMonth)}/month.` : "";
    out.push(v.settle(regional("Every database engine is within AWS standard support."), (n) => `${n} ${n === 1 ? "database runs" : "databases run"} a version past standard support.${cost}`));
  }
  {
    const v = V("aws.eks_version_support");
    eachRegion(p, v, (region, r) => {
      for (const c of v.read(r.eks, region) ?? []) {
        const extended = c.versionStatus === "EXTENDED_SUPPORT" || (!c.versionStatus && c.standardEnd !== null && Date.parse(c.standardEnd) < now.getTime());
        if (extended) {
          v.costPerMonth += 0.5 * 730;
          v.flag(at(region, "cluster", c.name, `${c.name} (Kubernetes ${c.version}, extended support)`));
        } else if (!c.versionStatus && !c.standardEnd) {
          v.gap(`support status of cluster ${c.name} unknown`);
        }
      }
    });
    const cost = v.costPerMonth ? ` Extended support is adding about $${Math.round(v.costPerMonth)}/month.` : "";
    out.push(v.settle(regional("Every Kubernetes cluster is on a version in standard support."), (n) => `${n} EKS ${n === 1 ? "cluster is" : "clusters are"} in extended support.${cost}`));
  }

  // ------------------------------------------------------- vulnerabilities
  {
    const v = V("aws.image_vulnerabilities");
    let sources = 0;
    eachRegion(p, v, (region, r) => {
      for (const img of v.read(r.images, region) ?? []) {
        sources++;
        if (!img.scanned) v.gap(`latest image in ${img.repository} (${region}) has no scan results — turn on scan-on-push`);
        else if (img.critical > 0) v.flag(at(region, "repository", img.repository, `${img.repository} (${img.critical} critical, ${img.high} high in the latest image)`));
      }
      const insp = r.inspector.ok ? r.inspector.data : null;
      if (insp?.enabled) {
        sources++;
        if (insp.critical > 0) v.flag(at(region, "inspector", region, `Inspector in ${region}: ${insp.critical} critical, ${insp.high} high findings`));
      }
    });
    if (!sources) v.gap("no container images in ECR and Inspector isn't on — vulnerability scanning isn't visible from AWS");
    out.push(v.settle("No critical vulnerabilities in your latest container images.", (n) => `${n} ${n === 1 ? "source reports" : "sources report"} critical vulnerabilities.`));
  }

  // ------------------------------------------------------------- backups
  {
    const v = V("aws.rds_backups");
    eachRegion(p, v, (region, r) => {
      for (const d of v.read(r.rds, region) ?? []) {
        if (d.clusterId) continue;
        if (d.backupRetentionDays < 7) v.flag(at(region, "db", d.id, `${d.id} (${d.backupRetentionDays === 0 ? "backups off" : `${d.backupRetentionDays} days`})`), d.tags);
      }
    });
    out.push(v.settle(regional("Every database keeps at least 7 days of automated backups."), (n) => `${n} ${n === 1 ? "database keeps" : "databases keep"} less than 7 days of backups.`));
  }
  {
    const v = V("aws.dynamodb_pitr");
    eachRegion(p, v, (region, r) => {
      for (const t of v.read(r.dynamo, region) ?? []) if (!t.pitr) v.flag(at(region, "table", t.name));
    });
    out.push(v.settle(regional("Every DynamoDB table has point-in-time recovery."), (n) => `${n} DynamoDB ${n === 1 ? "table has" : "tables have"} no point-in-time recovery.`));
  }
  {
    // A backup nobody has restored is a hope, not a control — this is the
    // evidence auditors most often find missing.
    const v = V("aws.restore_tested");
    const days = opts.restoreTestDays ?? 365;
    let stores = 0;
    let readable = p.nativeRestores?.ok === true;
    eachRegion(p, v, (region, r) => {
      const dbs = (v.read(r.rds, region) ?? []).filter((d) => !d.clusterId).length;
      const tables = (v.read(r.dynamo, region) ?? []).length;
      stores += dbs + tables;
      if (dbs + tables && r.backup.ok) readable = true;
    });
    const recent = (opts.restores ?? [])
      .filter((x) => x.accountId === acct && daysAgo(x.at, now) <= days)
      .sort((a, b) => b.at.localeCompare(a.at));
    const last = recent[0];
    if (stores && !last) {
      if (readable) v.flag(at(null, "restore-test", acct, `no restore in the last ${days} days`));
      else v.gap("neither AWS Backup's restore jobs nor CloudTrail's restore events could be read");
    }
    const lastText = last
      ? `${last.at.slice(0, 10)} — ${last.via}${last.automated ? " restore testing plan" : ""}, ${last.resourceType}${last.source ? ` from ${last.source}` : ""}`
      : "";
    out.push(
      v.settle(
        stores ? `Restores are being tested: the last was ${lastText}.` : regional("No databases or tables here to restore-test."),
        () =>
          `No database or table has been restored in the last ${days} days, so nothing shows the backups work. We see AWS Backup restore jobs and RDS/DynamoDB restores in CloudTrail's last 90 days; if you tested another way, mark it out of scope with the date and attach the report.`,
      ),
    );
  }

  // ----------------------------------------------------------- residency
  if (opts.residency) {
    const v = V("aws.data_residency");
    const where = RESIDENCY_LABEL[opts.residency];
    for (const u of p.regions.unscanned) v.gap(`${u.region} not scanned (${u.reason})`);
    if (!p.buckets.ok) v.gap(`S3: ${p.buckets.message}`);
    for (const [region, r] of Object.entries(p.regional)) {
      if (!r.rds.ok) v.gap(`${region}: ${r.rds.message}`);
      if (!r.dynamo.ok) v.gap(`${region}: ${r.dynamo.message}`);
    }
    const stores = dataStores(p);
    for (const s of stores) {
      if (allowedRegion(s.region, opts.residency)) continue;
      v.flag(at(s.region, s.kind, s.id, `${STORE_LABEL[s.kind]} ${s.id} in ${s.region}`));
    }
    const regions = [...new Set(stores.map((s) => s.region))].sort();
    out.push(
      v.settle(
        stores.length ? `All ${stores.length} data stores and copies are in ${where} (${regions.join(", ")}).` : `No data stores found; nothing is stored outside ${where}.`,
        (n) => `${n} data ${n === 1 ? "store or copy is" : "stores or copies are"} outside ${where}, against your residency commitment.`,
      ),
    );
  }

  // ------------------------------------------------------------- changes
  if (opts.recentChanges !== undefined) {
    const v = V("aws.manual_changes");
    if (opts.recentChanges === null) v.gap("CloudTrail event history couldn't be read");
    for (const c of opts.recentChanges ?? []) {
      v.flag(
        at(c.region, "change", c.eventId, `${c.at.slice(0, 16).replace("T", " ")} · ${c.principal ?? "unknown"} · ${c.name}${c.resources ? ` (${c.resources})` : ""}`),
      );
    }
    out.push(
      v.settle(
        "No changes were made by hand in the console, or by root, in the last 7 days.",
        (n) => `${n} ${n === 1 ? "change was" : "changes were"} made by hand in the console (or by root) in the last 7 days. Codify ${n === 1 ? "it" : "them"} in Terraform, or record why.`,
      ),
    );
  }

  // -------------------------------------------------------- informational
  {
    const v = V("aws.vpc_flow_logs");
    eachRegion(p, v, (region, r) => {
      for (const vpc of v.read(r.vpcsWithoutFlowLogs, region) ?? []) v.flag(at(region, "vpc", vpc));
    });
    out.push(v.settle(regional("Every VPC in use has flow logs."), (n) => `${n} ${n === 1 ? "VPC in use has" : "VPCs in use have"} no flow logs.`));
  }
  {
    const v = V("aws.config_recorder");
    eachRegion(p, v, (region, r) => {
      if (v.read(r.configRecording, region) === false) v.flag(at(region, "region", region, `AWS Config off in ${region}`));
    });
    out.push(v.settle(regional("AWS Config is recording in every region you use."), (n) => `AWS Config isn't recording in ${n} ${n === 1 ? "region" : "regions"}.`));
  }
  {
    const v = V("aws.security_hub");
    eachRegion(p, v, (region, r) => {
      if (v.read(r.securityHub, region) === false) v.flag(at(region, "region", region, `Security Hub off in ${region}`));
    });
    out.push(v.settle(regional("Security Hub is on in every region you use."), (n) => `Security Hub is off in ${n} ${n === 1 ? "region" : "regions"}.`));
  }
  {
    const v = V("aws.rds_deletion_protection");
    eachRegion(p, v, (region, r) => {
      for (const d of v.read(r.rds, region) ?? []) {
        if (d.clusterId) continue;
        if (!d.deletionProtection) v.flag(at(region, "db", d.id), d.tags);
      }
    });
    out.push(v.settle(regional("Every database has deletion protection."), (n) => `${n} ${n === 1 ? "database has" : "databases have"} no deletion protection.`));
  }

  return out;
}
