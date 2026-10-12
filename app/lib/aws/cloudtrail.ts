import { CloudTrailClient, LookupEventsCommand, type Event } from "@aws-sdk/client-cloudtrail";
import { client, errorName, pool, sleep, timeLeft, type ScanCtx } from "@/lib/aws/sdk";
import type { ChangeEvent, RestoreRecord, Section } from "@/lib/aws/types";

/**
 * Two populations an auditor samples, read from CloudTrail's free 90-day event
 * history (no trail needed):
 *
 *  - changes made by hand: write events from a console session, and anything
 *    root did. Pipelines and Terraform never sign in to the console, so they
 *    drop out without a list of "known automation" to maintain;
 *  - restores that actually ran natively in RDS and DynamoDB (AWS Backup's
 *    restore jobs are read separately).
 *
 * We keep who, what, when, where and the resource name. Request contents are
 * discarded unread — the same promise as everywhere else: configuration, never
 * data.
 *
 * LookupEvents allows 2 calls per second per region, so each region's calls run
 * one after another with a pause; regions run side by side.
 */

const SKIP_SOURCES = new Set([
  "signin.amazonaws.com",
  "sts.amazonaws.com",
  "cloudshell.amazonaws.com",
  "health.amazonaws.com",
  "notifications.amazonaws.com",
  "support.amazonaws.com",
  "uxc.amazonaws.com",
  "q.amazonaws.com",
  "resource-explorer-2.amazonaws.com",
  "billingconsole.amazonaws.com",
  "ce.amazonaws.com",
  "freetier.amazonaws.com",
]);

// Signing in, switching roles and opening sessions are access, not changes.
const SKIP_NAMES =
  /^(ConsoleLogin|CheckMfa|SwitchRole|ExitRole|RenewRole|GetSigninToken|AssumeRole\w*|Federate|Authenticate|CredentialChallenge|CredentialVerification|UserAuthentication|GetRoleCredentials|Logout|StartSession|ResumeSession|TerminateSession|SendSSHPublicKey|CreateToken|RegisterClient|StartDeviceAuthorization)$/;

const PAUSE_MS = 550;

type Identity = { type?: string; arn?: string; userName?: string };

/**
 * Access key IDs (AKIA…/ASIA…) appear as resource names on key events. They're
 * not secrets, but they are the handle an attacker searches leaked secrets by,
 * so we keep only enough to recognise one: "AKIA…I2O".
 */
export function maskKeyIds(s: string): string {
  return s.replace(/\b(AKIA|ASIA)[A-Z0-9]{12}([A-Z0-9]{4})\b/g, "$1…$2");
}

/** "jane@acme.com (AdministratorAccess)" from an Identity Center session; the user or role otherwise. */
export function principalOf(u: Identity | undefined): string | null {
  if (!u) return null;
  if (u.type === "Root") return "root";
  const arn = u.arn ?? "";
  const m = arn.match(/:assumed-role\/([^/]+)\/(.+)$/);
  if (m) {
    const sso = m[1].match(/^AWSReservedSSO_(.+)_[0-9a-f]{16}$/);
    return sso ? `${m[2]} (${sso[1]})` : `${m[2]} (role ${m[1]})`;
  }
  return u.userName ?? (arn || null);
}

/** A manual change, or null when the event isn't one. */
export function toChange(ev: Pick<Event, "CloudTrailEvent" | "Resources">, accountId: string, region: string): ChangeEvent | null {
  let rec: {
    eventID?: string;
    eventTime?: string;
    eventName?: string;
    eventSource?: string;
    errorCode?: string;
    readOnly?: boolean;
    sessionCredentialFromConsole?: string | boolean;
    userIdentity?: Identity;
  };
  try {
    rec = JSON.parse(ev.CloudTrailEvent ?? "{}");
  } catch {
    return null;
  }
  if (!rec.eventID || !rec.eventTime || !rec.eventName || !rec.eventSource) return null;
  if (rec.errorCode || rec.readOnly === true) return null; // a failed call changed nothing
  const type = rec.userIdentity?.type;
  if (type === "AWSService") return null;
  const root = type === "Root";
  const console = rec.sessionCredentialFromConsole === "true" || rec.sessionCredentialFromConsole === true;
  if (!root && !console) return null;
  if (SKIP_SOURCES.has(rec.eventSource) || SKIP_NAMES.test(rec.eventName)) return null;
  const names = [...new Set((ev.Resources ?? []).map((r) => r.ResourceName).filter(Boolean).map((n) => maskKeyIds(n!)))];
  return {
    eventId: rec.eventID,
    accountId,
    region,
    at: rec.eventTime,
    name: rec.eventName,
    source: rec.eventSource.replace(/\.amazonaws\.com$/, ""),
    principal: principalOf(rec.userIdentity),
    via: root ? "root" : "console",
    resources: names.length ? names.slice(0, 5).join(", ").slice(0, 300) : null,
  };
}

const RESTORE_EVENTS: { name: string; kind: "rds" | "dynamodb"; type: string }[] = [
  { name: "RestoreDBInstanceFromDBSnapshot", kind: "rds", type: "RDS database" },
  { name: "RestoreDBInstanceToPointInTime", kind: "rds", type: "RDS database" },
  { name: "RestoreDBClusterFromSnapshot", kind: "rds", type: "Aurora cluster" },
  { name: "RestoreDBClusterToPointInTime", kind: "rds", type: "Aurora cluster" },
  { name: "RestoreTableToPointInTime", kind: "dynamodb", type: "DynamoDB table" },
  { name: "RestoreTableFromBackup", kind: "dynamodb", type: "DynamoDB table" },
];

/** A native restore that AWS accepted, or null. Only the source's name is kept. */
export function toRestore(
  ev: Pick<Event, "CloudTrailEvent">,
  accountId: string,
  region: string,
  type: string,
): RestoreRecord | null {
  let rec: { eventID?: string; eventTime?: string; errorCode?: string; eventSource?: string; requestParameters?: Record<string, unknown> };
  try {
    rec = JSON.parse(ev.CloudTrailEvent ?? "{}");
  } catch {
    return null;
  }
  if (!rec.eventID || !rec.eventTime || rec.errorCode) return null;
  const p = rec.requestParameters ?? {};
  const pick = (...keys: string[]) => keys.map((k) => p[k]).find((v) => typeof v === "string") as string | undefined;
  const source = pick(
    "dBSnapshotIdentifier",
    "dBClusterSnapshotIdentifier",
    "snapshotIdentifier",
    "sourceDBInstanceIdentifier",
    "sourceDBClusterIdentifier",
    "sourceTableArn",
    "sourceTableName",
    "backupArn",
  );
  return {
    id: rec.eventID,
    accountId,
    region,
    via: rec.eventSource?.startsWith("dynamodb") ? "DynamoDB" : "RDS",
    resourceType: type,
    source: source ?? null,
    at: rec.eventTime,
    automated: false,
  };
}

export interface CloudTrailPlan {
  /** Regions to read changes from (always include us-east-1: IAM and other global changes land there). */
  changeRegions: string[];
  /** Read changes after this time; null = don't read changes. */
  since: Date | null;
  /** Regions holding databases or tables, to look for native restores in (last 90 days). */
  restoreRegions: { region: string; rds: boolean; dynamodb: boolean }[];
  maxPagesPerRegion: number;
}

export interface CloudTrailResult {
  changes: Section<{ events: ChangeEvent[]; readFrom: string; until: string }> | null;
  restores: Section<RestoreRecord[]> | null;
}

export async function collectCloudTrail(ctx: ScanCtx, plan: CloudTrailPlan): Promise<CloudTrailResult> {
  const now = new Date();
  const regions = [...new Set([...(plan.since ? plan.changeRegions : []), ...plan.restoreRegions.map((r) => r.region)])];
  const events: ChangeEvent[] = [];
  const restores: RestoreRecord[] = [];
  const readFrom: Date[] = [];
  let denied: string | null = null;
  let failed: string | null = null;

  await pool(regions, 4, ctx, async (region) => {
    const ct = client(CloudTrailClient, region, ctx);
    try {
      // Restores first: a handful of single-page calls.
      const want = plan.restoreRegions.find((r) => r.region === region);
      for (const e of RESTORE_EVENTS) {
        if (!want || (e.kind === "rds" ? !want.rds : !want.dynamodb)) continue;
        if (timeLeft(ctx) < 3_000) break;
        const r = await ct.send(
          new LookupEventsCommand({
            LookupAttributes: [{ AttributeKey: "EventName", AttributeValue: e.name }],
            StartTime: new Date(now.getTime() - 90 * 86_400_000),
            EndTime: now,
            MaxResults: 50,
          }),
        );
        for (const ev of r.Events ?? []) {
          const rec = toRestore(ev, ctx.accountId, region, e.type);
          if (rec) restores.push(rec);
        }
        await sleep(PAUSE_MS);
      }

      if (!plan.since || !plan.changeRegions.includes(region)) return;
      let token: string | undefined;
      let pages = 0;
      let oldest: Date | null = null;
      do {
        const r = await ct.send(
          new LookupEventsCommand({
            LookupAttributes: [{ AttributeKey: "ReadOnly", AttributeValue: "false" }],
            StartTime: plan.since,
            EndTime: now,
            MaxResults: 50,
            NextToken: token,
          }),
        );
        for (const ev of r.Events ?? []) {
          const c = toChange(ev, ctx.accountId, region);
          if (c) events.push(c);
          if (ev.EventTime && (!oldest || ev.EventTime < oldest)) oldest = ev.EventTime;
        }
        token = r.NextToken;
        pages++;
        if (token) await sleep(PAUSE_MS);
      } while (token && pages < plan.maxPagesPerRegion && timeLeft(ctx) > 3_000);
      // Stopped early: only the newest part of the window was read in this region.
      readFrom.push(token && oldest ? oldest : plan.since);
    } catch (err) {
      if (/AccessDenied|Unauthorized/i.test(errorName(err))) denied = "cloudtrail:LookupEvents";
      else failed = (err as Error)?.message?.slice(0, 200) ?? "CloudTrail didn't answer.";
    }
  });

  const fail = (): Section<never> =>
    denied
      ? { ok: false, reason: "denied", action: denied, message: `ShieldFlow's role isn't allowed ${denied}.` }
      : { ok: false, reason: "error", action: "cloudtrail:LookupEvents", message: failed ?? "CloudTrail didn't answer." };

  const changesRead = plan.since ? plan.changeRegions.filter((r) => regions.includes(r)).length : 0;
  const changes: CloudTrailResult["changes"] = !plan.since
    ? null
    : (denied || failed) && readFrom.length < changesRead
      ? fail()
      : {
          ok: true,
          data: {
            events: events.sort((a, b) => b.at.localeCompare(a.at)),
            // The window every region covered: the latest of their starts.
            readFrom: new Date(Math.max(...readFrom.map((d) => d.getTime()), plan.since.getTime())).toISOString(),
            until: now.toISOString(),
          },
        };
  const restoreSection: CloudTrailResult["restores"] = !plan.restoreRegions.length
    ? null
    : denied || failed
      ? fail()
      : { ok: true, data: restores };
  return { changes, restores: restoreSection };
}

