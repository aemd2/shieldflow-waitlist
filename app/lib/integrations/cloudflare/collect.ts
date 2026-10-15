import { CloudflareError } from "@/lib/cloudflare";
import { ok, type Section } from "@/lib/checks-core";

/**
 * Read Cloudflare with a read-only API token: every zone's edge settings and
 * DNSSEC, and every account's members and 2FA. Anything the token can't read
 * is its own section, so it makes only its checks "can't tell".
 */

const API = "https://api.cloudflare.com/client/v4";
const MAX_ZONES = 500;

export interface CfZone {
  id: string;
  name: string;
  /** null = setting not readable. */
  ssl: string | null;
  minTls: string | null;
  alwaysHttps: string | null;
  hsts: boolean | null;
  dnssec: "active" | "pending" | "disabled" | null;
  plan: string | null;
}

export interface CfMember {
  email: string;
  name: string | null;
  twoFactor: boolean | null;
  status: string;
  roles: string[];
}

export interface CfAccount {
  id: string;
  name: string;
  enforceTwoFactor: boolean | null;
  members: Section<CfMember[]>;
}

export interface CloudflarePosture {
  scannedAt: string;
  durationMs: number;
  zones: Section<CfZone[]>;
  zonesTruncated: boolean;
  accounts: Section<CfAccount[]>;
}

class CfHttp extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function cf<T>(token: string, path: string): Promise<{ result: T; info?: { total_pages?: number } }> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }).catch(() => {
    throw new CloudflareError("unavailable", "Couldn't reach Cloudflare. Please try again.");
  });
  if (res.status === 401) throw new CloudflareError("auth", "Cloudflare rejected this token. Check it and reconnect.");
  if (!res.ok) throw new CfHttp(res.status);
  const j = (await res.json()) as { result: T; result_info?: { total_pages?: number } };
  return { result: j.result, info: j.result_info };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const denied = (action: string, what: string): Section<never> => ({ ok: false, reason: "denied", action, message: `the token needs ${action} to read ${what}` });

export async function collectCloudflare(token: string): Promise<CloudflarePosture> {
  const started = Date.now();

  // ------------------------------------------------------------------ zones
  let zones: Section<CfZone[]>;
  let zonesTruncated = false;
  try {
    const raw: { id: string; name: string; plan?: { name?: string } }[] = [];
    for (let page = 1; page <= 10; page++) {
      const { result, info } = await cf<{ id: string; name: string; plan?: { name?: string } }[]>(token, `/zones?per_page=50&page=${page}`);
      raw.push(...result);
      if (page >= (info?.total_pages ?? 1)) break;
      if (page === 10) zonesTruncated = true;
    }
    const slice = raw.slice(0, MAX_ZONES);
    if (raw.length > slice.length) zonesTruncated = true;
    zones = ok(
      await pool(slice, 6, async (z): Promise<CfZone> => {
        const zone: CfZone = { id: z.id, name: z.name, ssl: null, minTls: null, alwaysHttps: null, hsts: null, dnssec: null, plan: z.plan?.name ?? null };
        try {
          const { result } = await cf<{ id: string; value?: unknown }[]>(token, `/zones/${z.id}/settings`);
          const get = (id: string) => result.find((s) => s.id === id)?.value;
          const str = (v: unknown) => (v === undefined || v === null ? null : String(v));
          zone.ssl = str(get("ssl"));
          zone.minTls = str(get("min_tls_version"));
          zone.alwaysHttps = str(get("always_use_https"));
          const hsts = (get("security_header") as { strict_transport_security?: { enabled?: boolean } } | undefined)?.strict_transport_security;
          zone.hsts = hsts ? Boolean(hsts.enabled) : null;
        } catch (e) {
          if (e instanceof CloudflareError) throw e;
        }
        try {
          const { result } = await cf<{ status?: string }>(token, `/zones/${z.id}/dnssec`);
          const s = (result.status ?? "").toLowerCase();
          zone.dnssec = s === "active" ? "active" : s.startsWith("pending") ? "pending" : s ? "disabled" : null;
        } catch (e) {
          if (e instanceof CloudflareError) throw e;
        }
        return zone;
      }),
    );
  } catch (e) {
    if (e instanceof CloudflareError) throw e;
    zones = denied("Zone: Read", "zones");
  }

  // --------------------------------------------------------------- accounts
  let accounts: Section<CfAccount[]>;
  try {
    const { result } = await cf<{ id: string; name: string; settings?: { enforce_twofactor?: boolean } }[]>(token, "/accounts?per_page=50");
    accounts = ok(
      await pool(result, 4, async (a): Promise<CfAccount> => {
        let members: Section<CfMember[]>;
        try {
          const list: CfMember[] = [];
          for (let page = 1; page <= 10; page++) {
            const r = await cf<{ status?: string; user?: { email?: string; first_name?: string | null; last_name?: string | null; two_factor_authentication_enabled?: boolean }; roles?: { name?: string }[] }[]>(
              token,
              `/accounts/${a.id}/members?per_page=50&page=${page}`,
            );
            for (const m of r.result) {
              if (!m.user?.email) continue;
              list.push({
                email: m.user.email.toLowerCase(),
                name: [m.user.first_name, m.user.last_name].filter(Boolean).join(" ") || null,
                twoFactor: typeof m.user.two_factor_authentication_enabled === "boolean" ? m.user.two_factor_authentication_enabled : null,
                status: m.status ?? "accepted",
                roles: (m.roles ?? []).map((x) => x.name ?? "").filter(Boolean),
              });
            }
            if (page >= (r.info?.total_pages ?? 1)) break;
          }
          members = ok(list);
        } catch (e) {
          if (e instanceof CloudflareError) throw e;
          members = denied("Account Settings: Read (or Memberships: Read)", `the members of ${a.name}`);
        }
        return { id: a.id, name: a.name, enforceTwoFactor: typeof a.settings?.enforce_twofactor === "boolean" ? a.settings.enforce_twofactor : null, members };
      }),
    );
  } catch (e) {
    if (e instanceof CloudflareError) throw e;
    accounts = denied("Account Settings: Read", "accounts");
  }

  return { scannedAt: new Date(started).toISOString(), durationMs: Date.now() - started, zones, zonesTruncated, accounts };
}
