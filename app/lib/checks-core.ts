/**
 * The shared engine every deep integration is built on (AWS first, then GitHub,
 * Google, Microsoft, Okta, Cloudflare, Google Cloud, GitLab, the HRIS and MDM
 * sources). Pure — no network, no database — so every verdict path can be pinned
 * down in a `.cases.ts` file.
 *
 * The rules it enforces, for every provider:
 *  - a failure names the exact resources (capped at 50, the count kept);
 *  - a resource someone marked out of scope (check_exceptions, with a reason and
 *    an optional expiry) or tagged `shieldflow:scope=out` is reported as accepted,
 *    never failed and never hidden;
 *  - anything we couldn't read makes the check "can't tell" and says what — a
 *    partial read never passes;
 *  - a real failure still fails even if something else couldn't be read.
 */

// ------------------------------------------------------------------ sections

export type SectionFailure = {
  ok: false;
  reason: "denied" | "timeout" | "error" | "unavailable";
  /** The API action or permission that failed, e.g. "ec2:DescribeSecurityGroups". */
  action: string;
  message: string;
};
/** Every piece of collected data is either the data, or why we couldn't get it. */
export type Section<T> = { ok: true; data: T } | SectionFailure;

export const ok = <T,>(data: T): Section<T> => ({ ok: true, data });
export const denied = (action: string, message?: string): SectionFailure => ({
  ok: false,
  reason: "denied",
  action,
  message: message ?? `ShieldFlow isn't allowed ${action}.`,
});

// -------------------------------------------------------------------- checks

export type Severity = "high" | "medium" | "low";
export type CheckResultValue = "pass" | "fail" | "inconclusive";

export interface CheckFix {
  terraform?: string;
  cli?: string;
  console: string;
  /** What the fix itself costs, when it isn't free. */
  cost?: string;
}

/** One check, as the catalogue, the provider page and the public list describe it. */
export interface CheckDef<A extends string = string> {
  key: string;
  title: string;
  area: A;
  severity: Severity;
  /** Shown, never gates a measure or raises an alert. */
  informational?: boolean;
  why: string;
  controlCodes: string[];
  apiCalls: string[];
  fix: CheckFix;
}

/** A thing a check is about. `id` is stable: `<scope>:<region|global>:<type>/<native id>`. */
export interface CheckResource {
  id: string;
  label: string;
  region: string | null;
}

export interface CheckOutcome<R extends CheckResource = CheckResource> {
  key: string;
  result: CheckResultValue;
  detail: string;
  /** Failing resources not accepted as out of scope (capped). */
  resources: R[];
  failingCount: number;
  /** Resources excluded by a tag or a recorded exception, with the reason. */
  accepted: (R & { reason: string })[];
  /** Extra spend the finding is costing per month (estimate), if any. */
  costPerMonth?: number;
}

export function resourceKey(scope: string, region: string | null, type: string, id: string): string {
  return `${scope}:${region ?? "global"}:${type}/${id}`;
}

/** The resource's own id inside an account-qualified one: "acct:region:type/ID" → "ID". */
export function nativeId(id: string): string {
  return id.slice(id.indexOf("/") + 1).replace(/#\d+$/, "");
}

// ---------------------------------------------------------------- exceptions

export interface ExceptionRow {
  checkKey: string;
  resourceId: string;
  reason: string;
  expiresAt: string | null;
}

export const SCOPE_TAG = "shieldflow:scope";

export function outOfScopeTag(tags: Record<string, string> | undefined): boolean {
  const v = (tags?.[SCOPE_TAG] ?? "").toLowerCase();
  return v === "out" || v === "out-of-scope";
}

/** Live exceptions as "checkKey|resourceId" → reason (expired ones dropped). */
export function exceptionMap(rows: ExceptionRow[], now: Date): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of rows) {
    if (e.expiresAt && Date.parse(e.expiresAt) < now.getTime()) continue;
    m.set(`${e.checkKey}|${e.resourceId}`, e.reason);
  }
  return m;
}

// ------------------------------------------------------------------ verdicts

const MAX_RESOURCES = 50;

/** Collects one check's candidates, then settles them into a verdict. */
export class Verdict<R extends CheckResource = CheckResource> {
  failing: R[] = [];
  accepted: (R & { reason: string })[] = [];
  gaps: string[] = [];
  costPerMonth = 0;

  constructor(
    private key: string,
    private exceptions: Map<string, string>,
  ) {}

  /** A resource that fails the check — unless tagged out of scope or excepted. */
  flag(res: R, tags?: Record<string, string>) {
    const excepted = this.exceptions.get(`${this.key}|${res.id}`);
    if (excepted) this.accepted.push({ ...res, reason: excepted });
    else if (outOfScopeTag(tags)) this.accepted.push({ ...res, reason: `tagged ${SCOPE_TAG}=out` });
    else this.failing.push(res);
  }

  accept(res: R, reason: string) {
    this.accepted.push({ ...res, reason });
  }

  gap(text: string) {
    this.gaps.push(text.replace(/\.$/, ""));
  }

  /** Read a section, or record why it couldn't be. */
  read<T>(s: Section<T>, where: string): T | null {
    if (s.ok) return s.data;
    this.gap(`${where}: ${s.message}`);
    return null;
  }

  settle(pass: string, fail: (n: number) => string): CheckOutcome<R> {
    const acceptedNote = this.accepted.length ? ` ${this.accepted.length} accepted as out of scope.` : "";
    if (this.failing.length) {
      return {
        key: this.key,
        result: "fail",
        detail: fail(this.failing.length) + acceptedNote,
        resources: this.failing.slice(0, MAX_RESOURCES),
        failingCount: this.failing.length,
        accepted: this.accepted.slice(0, MAX_RESOURCES),
        ...(this.costPerMonth ? { costPerMonth: Math.round(this.costPerMonth) } : {}),
      };
    }
    if (this.gaps.length) {
      return {
        key: this.key,
        result: "inconclusive",
        detail: `Couldn't check everything — ${this.gaps.slice(0, 3).join("; ")}${this.gaps.length > 3 ? ` (+${this.gaps.length - 3} more)` : ""}.`,
        resources: [],
        failingCount: 0,
        accepted: this.accepted.slice(0, MAX_RESOURCES),
      };
    }
    return {
      key: this.key,
      result: "pass",
      detail: pass + acceptedNote,
      resources: [],
      failingCount: 0,
      accepted: this.accepted.slice(0, MAX_RESOURCES),
    };
  }
}

/** Fill a fix template for one resource: {id}, {region}, {account}, {org}, {repo}, {project}, {zone}. */
export function fillFix(template: string, vars: Record<string, string | null | undefined>): string {
  const fallback: Record<string, string> = {
    id: "<RESOURCE>",
    region: "<REGION>",
    account: "<ACCOUNT_ID>",
    org: "<ORG>",
    repo: "<REPO>",
    project: "<PROJECT>",
    zone: "<ZONE>",
  };
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? fallback[k] ?? m);
}

/** Days between an ISO date and now (Infinity when missing). */
export function daysSince(iso: string | null | undefined, now: Date): number {
  return iso ? (now.getTime() - Date.parse(iso)) / 86_400_000 : Infinity;
}

/** "a, b, c and 4 more" */
export function listNames(names: string[], max = 5): string {
  return names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}
