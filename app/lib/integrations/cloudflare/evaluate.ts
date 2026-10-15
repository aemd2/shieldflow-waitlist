import { exceptionMap, listNames, resourceKey, Verdict, type CheckOutcome, type ExceptionRow } from "@/lib/checks-core";
import type { CloudflarePosture, CfZone } from "@/lib/integrations/cloudflare/collect";

export interface CloudflareEvaluateOptions {
  now: Date;
  exceptions: ExceptionRow[];
}

export const zoneResource = (z: Pick<CfZone, "name">, label = z.name) => ({ id: resourceKey("cloudflare", null, "zone", z.name), label, region: null });

/** Why a zone fails the TLS check, or null; "unknown" when a setting couldn't be read. */
export function tlsProblem(z: CfZone): string | null | "unknown" {
  const why: string[] = [];
  if (z.ssl === null || z.minTls === null || z.alwaysHttps === null) return "unknown";
  if (z.ssl !== "strict") why.push(z.ssl === "full" ? "SSL Full, not Full (strict) — the origin certificate isn't verified" : `SSL ${z.ssl}`);
  if (!["1.2", "1.3"].includes(z.minTls)) why.push(`TLS ${z.minTls} allowed`);
  if (z.alwaysHttps !== "on") why.push("plain HTTP allowed");
  return why.length ? why.join("; ") : null;
}

export function evaluateCloudflare(p: CloudflarePosture, opts: CloudflareEvaluateOptions): CheckOutcome[] {
  const ex = exceptionMap(opts.exceptions, opts.now);
  const V = (key: string) => new Verdict(key, ex);
  const out: CheckOutcome[] = [];
  const zones = p.zones.ok ? p.zones.data : [];
  const more = "more zones than one scan reads";

  {
    const v = V("cloudflare.tls");
    v.read(p.zones, "zones");
    if (p.zonesTruncated) v.gap(more);
    const unread: string[] = [];
    for (const z of zones) {
      const why = tlsProblem(z);
      if (why === "unknown") unread.push(z.name);
      else if (why) v.flag(zoneResource(z, `${z.name} — ${why}`));
    }
    if (unread.length) v.gap(`settings not readable for ${listNames(unread, 3)}`);
    out.push(v.settle(`All ${zones.length} zones: SSL Full (strict), TLS 1.2+, HTTPS only.`, (n) => `${n} of ${zones.length} zones allow weak or unencrypted connections.`));
  }
  {
    const v = V("cloudflare.hsts");
    v.read(p.zones, "zones");
    if (p.zonesTruncated) v.gap(more);
    const unread = zones.filter((z) => z.hsts === null).map((z) => z.name);
    for (const z of zones) if (z.hsts === false) v.flag(zoneResource(z));
    if (unread.length) v.gap(`HSTS not readable for ${listNames(unread, 3)}`);
    out.push(v.settle(`HSTS is on for all ${zones.length} zones.`, (n) => `HSTS is off for ${n} of ${zones.length} zones.`));
  }
  {
    const v = V("cloudflare.dnssec");
    v.read(p.zones, "zones");
    if (p.zonesTruncated) v.gap(more);
    const unread = zones.filter((z) => z.dnssec === null).map((z) => z.name);
    for (const z of zones) if (z.dnssec === "disabled") v.flag(zoneResource(z));
    if (unread.length) v.gap(`DNSSEC not readable for ${listNames(unread, 3)} (the token needs DNS: Read)`);
    const pending = zones.filter((z) => z.dnssec === "pending").map((z) => z.name);
    if (pending.length) v.gap(`DNSSEC pending the registrar's DS record for ${listNames(pending, 3)}`);
    out.push(v.settle(`DNSSEC is active on all ${zones.length} zones.`, (n) => `DNSSEC is off for ${n} of ${zones.length} zones.`));
  }
  {
    const v = V("cloudflare.members_2fa");
    const accounts = v.read(p.accounts, "accounts") ?? [];
    let count = 0;
    for (const a of accounts) {
      const members = v.read(a.members, `members of ${a.name}`);
      if (!members) continue;
      for (const m of members.filter((x) => x.status !== "rejected")) {
        count++;
        if (m.twoFactor === false && a.enforceTwoFactor !== true) v.flag({ id: resourceKey("cloudflare", null, "member", `${a.id}:${m.email}`), label: `${m.email} (${a.name})`, region: null });
        else if (m.twoFactor === null && a.enforceTwoFactor !== true) v.gap(`2FA status not shown for ${m.email}`);
      }
    }
    const enforced = accounts.filter((a) => a.enforceTwoFactor).length;
    out.push(
      v.settle(
        enforced === accounts.length && accounts.length ? `2FA is enforced on ${accounts.length === 1 ? "the account" : `all ${accounts.length} accounts`}.` : `All ${count} members use 2FA.`,
        (n) => `${n} ${n === 1 ? "member doesn't" : "members don't"} use 2FA, and the account doesn't enforce it.`,
      ),
    );
  }
  return out;
}
