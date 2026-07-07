// Server-side Cloudflare helpers (plain fetch). Scoped read-only API token
// (Bearer). Fixed endpoint api.cloudflare.com — no SSRF. Reads per-zone edge
// security posture (SSL/TLS mode, min TLS version, always-use-HTTPS).

const API = "https://api.cloudflare.com/client/v4";
const MAX_ZONES = 25;

export class CloudflareError extends Error {
  constructor(
    public kind: "auth" | "forbidden" | "rate_limited" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "CloudflareError";
  }
}

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

async function cfGet(path: string, token: string): Promise<Response> {
  try {
    return await fetch(`${API}${path}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new CloudflareError("unavailable", "Couldn't reach Cloudflare. Please try again.");
  }
}

function check(res: Response): void {
  if (res.status === 401) throw new CloudflareError("auth", "Cloudflare rejected this token. Check it and try again.");
  if (res.status === 403) throw new CloudflareError("forbidden", "This token lacks read access to your zones.");
  if (res.status === 429) throw new CloudflareError("rate_limited", "Cloudflare rate limit reached. Try again in a minute.");
  if (!res.ok) throw new CloudflareError("unavailable", "Cloudflare is unavailable right now. Try again shortly.");
}

// Validated via /zones, not /user/tokens/verify: that endpoint is scoped to the
// "user" resource, which a least-privilege Zone-only token (what we ask for) has
// no permission to call — it 401s even though the token is perfectly valid.
export async function validateToken(token: string): Promise<string> {
  const res = await cfGet("/zones?per_page=1", token);
  check(res);
  return "Cloudflare";
}

async function zoneSetting(token: string, zoneId: string, setting: string): Promise<string> {
  try {
    const res = await cfGet(`/zones/${zoneId}/settings/${setting}`, token);
    if (!res.ok) return "unknown";
    const json = (await res.json()) as { result?: { value?: unknown } };
    return String(json.result?.value ?? "unknown");
  } catch {
    return "unknown";
  }
}

export interface CloudflareZone {
  name: string;
  ssl: string; // off | flexible | full | strict
  minTls: string; // 1.0 | 1.1 | 1.2 | 1.3
  alwaysHttps: string; // on | off
}

export interface CloudflareReport {
  totalZones: number;
  zones: CloudflareZone[];
  truncated: boolean;
}

export async function fetchZoneSecurity(token: string): Promise<CloudflareReport> {
  const res = await cfGet("/zones?per_page=50", token);
  check(res);
  const json = (await res.json()) as { result?: Array<{ id: string; name: string }> };
  const all = json.result ?? [];
  const slice = all.slice(0, MAX_ZONES);

  const zones: CloudflareZone[] = [];
  for (const z of slice) {
    zones.push({
      name: z.name,
      ssl: await zoneSetting(token, z.id, "ssl"),
      minTls: await zoneSetting(token, z.id, "min_tls_version"),
      alwaysHttps: await zoneSetting(token, z.id, "always_use_https"),
    });
  }

  return { totalZones: all.length, zones, truncated: all.length > slice.length };
}
