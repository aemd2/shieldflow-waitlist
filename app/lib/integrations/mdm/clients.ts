import type { Device } from "@/lib/integrations/devices";

/**
 * Laptops from a device manager, read-only, normalised to the shared Device
 * shape. Kandji (Iru) and Jamf Pro are the two Mac MDMs our customers use;
 * Intune comes through the Microsoft integration.
 */

export type MdmProvider = "kandji" | "jamf";

export interface MdmRead {
  devices: Device[];
  truncated: boolean;
  /** Devices whose encryption details couldn't be read in this scan. */
  detailsSkipped: number;
}

export class MdmError extends Error {
  constructor(
    public kind: "auth" | "forbidden" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "MdmError";
  }
}

async function call(url: string, init: RequestInit, label: string): Promise<Response> {
  const res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) }).catch(() => {
    throw new MdmError("unavailable", `Couldn't reach ${label}. Check the address and try again.`);
  });
  if (res.status === 401) throw new MdmError("auth", `${label} rejected the credentials — check them and reconnect.`);
  if (res.status === 403) throw new MdmError("forbidden", `These ${label} credentials can't read devices — give them device read permission.`);
  if (!res.ok) throw new MdmError("unavailable", `${label} answered HTTP ${res.status}.`);
  return res;
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

// -------------------------------------------------------------------- Kandji

/** "https://acme.api.kandji.io" or "acme.api.eu.kandji.io" → the API host, or null. */
export function normalizeKandjiHost(input: string): string | null {
  const h = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9][a-z0-9-]{0,62}\.api(\.eu)?\.kandji\.io$/.test(h) ? h : null;
}

export interface KandjiCreds {
  host: string;
  token: string;
}

const MAX_DEVICES = 1000;
const MAX_DETAILS = 400;

export async function readKandji(c: KandjiCreds): Promise<MdmRead> {
  const host = normalizeKandjiHost(c.host);
  if (!host) throw new MdmError("auth", "That isn't a Kandji API address — copy it from Kandji → Settings → Access → API URL.");
  const headers = { Authorization: `Bearer ${c.token}`, Accept: "application/json" };
  const raw: Record<string, unknown>[] = [];
  let truncated = false;
  for (let offset = 0; ; offset += 300) {
    const res = await call(`https://${host}/api/v1/devices?limit=300&offset=${offset}`, { headers }, "Kandji");
    const page = (await res.json()) as Record<string, unknown>[];
    raw.push(...page);
    if (page.length < 300) break;
    if (raw.length >= MAX_DEVICES) {
      truncated = true;
      break;
    }
  }
  const devices = raw.filter((d) => !d.is_removed && String(d.platform ?? "").toLowerCase() !== "appletv");
  let skipped = 0;
  const filevault = await pool(devices.slice(0, MAX_DETAILS), 6, async (d) => {
    const plat = String(d.platform ?? "").toLowerCase();
    // iPhone and iPad storage is always hardware-encrypted; FileVault is the Mac's question.
    if (plat !== "mac") return true;
    try {
      const r = await call(`https://${host}/api/v1/devices/${encodeURIComponent(String(d.device_id))}/details`, { headers }, "Kandji");
      const j = (await r.json()) as { filevault?: { filevault_enabled?: boolean | string } };
      const v = j.filevault?.filevault_enabled;
      return typeof v === "boolean" ? v : typeof v === "string" ? v.toLowerCase() === "true" || v.toLowerCase() === "on" : null;
    } catch (err) {
      if (err instanceof MdmError && err.kind === "auth") throw err;
      skipped++;
      return null;
    }
  });
  if (devices.length > MAX_DETAILS) skipped += devices.length - MAX_DETAILS;
  return {
    devices: devices.map((d, i): Device => {
      const user = (d.user && typeof d.user === "object" ? d.user : {}) as { email?: string; name?: string };
      return {
        id: String(d.device_id),
        name: String(d.device_name ?? d.serial_number ?? d.device_id),
        os: String(d.platform ?? "unknown"),
        osVersion: (d.os_version as string | undefined) ?? null,
        encrypted: i < MAX_DETAILS ? (filevault[i] ?? null) : null,
        lastSeen: (d.last_check_in as string | undefined) ?? null,
        owner: user.email?.toLowerCase() || null,
        ownerName: user.name ?? null,
        corporate: true,
      };
    }),
    truncated,
    detailsSkipped: skipped,
  };
}

// ---------------------------------------------------------------------- Jamf

/**
 * A Jamf Pro server address. Jamf Cloud (*.jamfcloud.com) or a customer's own
 * server — a public hostname over https only: no IP literals, no localhost, no
 * internal names, so the address can't be used to reach our own network.
 */
export function normalizeJamfUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== "https:") return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || /^\d+(\.\d+)*$/.test(h)) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(h)) return null;
  return `https://${h}${u.port && u.port !== "443" ? `:${u.port}` : ""}`;
}

export interface JamfCreds {
  url: string;
  clientId: string;
  clientSecret: string;
}

/** FileVault state from Jamf's inventory → encrypted / not / unknown. */
export function jamfEncrypted(state: string | null | undefined): boolean | null {
  const s = (state ?? "").toUpperCase();
  if (s === "ENCRYPTED") return true;
  if (s === "UNENCRYPTED" || s === "NOT_ENCRYPTED" || s === "DECRYPTED" || s === "DECRYPTING") return false;
  return null; // ENCRYPTING, UNKNOWN, missing
}

export async function readJamf(c: JamfCreds): Promise<MdmRead> {
  const base = normalizeJamfUrl(c.url);
  if (!base) throw new MdmError("auth", "That isn't a Jamf Pro address — use https://yourco.jamfcloud.com (or your server's public address).");
  const tok = await call(
    `${base}/api/oauth/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "client_credentials" }) },
    "Jamf Pro",
  );
  const { access_token } = (await tok.json()) as { access_token?: string };
  if (!access_token) throw new MdmError("auth", "Jamf Pro didn't return a token — check the API client ID and secret.");
  const headers = { Authorization: `Bearer ${access_token}`, Accept: "application/json" };

  const devices: Device[] = [];
  let total = Infinity;
  for (let page = 0; devices.length < total && devices.length < MAX_DEVICES; page++) {
    const res = await call(
      `${base}/api/v1/computers-inventory?section=GENERAL&section=DISK_ENCRYPTION&section=OPERATING_SYSTEM&section=USER_AND_LOCATION&page=${page}&page-size=200`,
      { headers },
      "Jamf Pro",
    );
    const j = (await res.json()) as {
      totalCount?: number;
      results?: {
        id: string;
        general?: { name?: string; lastContactTime?: string; managementId?: string; remoteManagement?: { managed?: boolean } };
        diskEncryption?: { bootPartitionEncryptionDetails?: { partitionFileVault2State?: string } };
        operatingSystem?: { name?: string; version?: string };
        userAndLocation?: { email?: string; username?: string; realname?: string };
      }[];
    };
    if (typeof j.totalCount === "number") total = j.totalCount;
    const rows = j.results ?? [];
    for (const d of rows) {
      if (d.general?.remoteManagement?.managed === false) continue;
      devices.push({
        id: String(d.id),
        name: d.general?.name ?? String(d.id),
        os: d.operatingSystem?.name ?? "macOS",
        osVersion: d.operatingSystem?.version ?? null,
        encrypted: jamfEncrypted(d.diskEncryption?.bootPartitionEncryptionDetails?.partitionFileVault2State),
        lastSeen: d.general?.lastContactTime ?? null,
        owner: (d.userAndLocation?.email || d.userAndLocation?.username || "").toLowerCase() || null,
        ownerName: d.userAndLocation?.realname ?? null,
        corporate: true,
      });
    }
    if (!rows.length) break;
  }
  return { devices, truncated: Number.isFinite(total) && devices.length < total && devices.length >= MAX_DEVICES, detailsSkipped: 0 };
}

export async function readMdm(provider: MdmProvider, creds: unknown): Promise<MdmRead> {
  return provider === "kandji" ? readKandji(creds as KandjiCreds) : readJamf(creds as JamfCreds);
}
