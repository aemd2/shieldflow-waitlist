// Server-side Okta helpers (plain fetch, no SDK). Reads identity security
// evidence — user status breakdown, MFA enrollment, password policy — via a
// read-only API token (SSWS). Host is allow-listed to *.okta.com to block SSRF.

const MAX_USERS = 200; // one page is plenty for an evidence snapshot
const MAX_MFA_CHECKS = 50; // factor lookups are 1 request each — cap them

export class OktaError extends Error {
  constructor(
    public kind: "auth" | "forbidden" | "rate_limited" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "OktaError";
  }
}

/** Normalize a pasted domain to a bare host and reject anything that isn't an Okta org (SSRF guard). */
export function normalizeOktaHost(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9][a-z0-9-]*\.okta(preview)?\.com$/.test(host) ? host : null;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `SSWS ${token}`,
    Accept: "application/json",
  };
}

async function oktaGet(host: string, path: string, token: string): Promise<Response> {
  try {
    return await fetch(`https://${host}${path}`, {
      headers: headers(token),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new OktaError("unavailable", "Couldn't reach Okta. Please try again.");
  }
}

function check(res: Response): void {
  if (res.status === 401) {
    throw new OktaError("auth", "Okta rejected this token. Check it and try again.");
  }
  if (res.status === 403) {
    throw new OktaError("forbidden", "This token lacks read access. Use a read-only admin token.");
  }
  if (res.status === 429) {
    throw new OktaError("rate_limited", "Okta rate limit reached. Try again in a minute.");
  }
  if (!res.ok) {
    throw new OktaError("unavailable", "Okta is unavailable right now. Try again shortly.");
  }
}

/** Validate the token via GET /api/v1/org. Returns the org's display name. */
export async function validateToken(host: string, token: string): Promise<string> {
  const res = await oktaGet(host, "/api/v1/org", token);
  check(res);
  const json = await res.json().catch(() => ({}));
  return (json.companyName as string) || (json.subdomain as string) || host;
}

export interface OktaSecurityReport {
  totalUsers: number;
  active: number;
  suspended: number;
  deprovisioned: number;
  mfaChecked: number;
  mfaEnrolled: number;
  passwordMinLength: number | null;
  passwordRequiresComplexity: boolean;
}

export interface OktaUser {
  email: string;
  status: string;
}

/** Raw per-user list (email + status) — for pre-filling an access review roster, not a full security report. */
export async function fetchUsersRaw(host: string, token: string): Promise<OktaUser[]> {
  const res = await oktaGet(host, `/api/v1/users?limit=${MAX_USERS}`, token);
  check(res);
  const users = (await res.json()) as Array<{ status: string; profile?: { email?: string } }>;
  return users
    .filter((u) => u.profile?.email)
    .map((u) => ({ email: u.profile!.email as string, status: u.status }));
}

export async function fetchUserSecurity(host: string, token: string): Promise<OktaSecurityReport> {
  // Users (single capped page).
  const usersRes = await oktaGet(host, `/api/v1/users?limit=${MAX_USERS}`, token);
  check(usersRes);
  const users = (await usersRes.json()) as Array<{ id: string; status: string }>;

  const counts = { active: 0, suspended: 0, deprovisioned: 0 };
  for (const u of users) {
    if (u.status === "ACTIVE") counts.active++;
    else if (u.status === "SUSPENDED") counts.suspended++;
    else if (u.status === "DEPROVISIONED") counts.deprovisioned++;
  }

  // MFA enrollment on a capped subset of active users.
  let mfaChecked = 0;
  let mfaEnrolled = 0;
  const toCheck = users.filter((u) => u.status === "ACTIVE").slice(0, MAX_MFA_CHECKS);
  for (const u of toCheck) {
    const fRes = await oktaGet(host, `/api/v1/users/${u.id}/factors`, token);
    if (fRes.status === 429) break; // keep what we have
    if (!fRes.ok) continue;
    const factors = (await fRes.json()) as Array<{ status: string }>;
    mfaChecked++;
    if (factors.some((f) => f.status === "ACTIVE")) mfaEnrolled++;
  }

  // Password policy (best-effort — older orgs may not expose it).
  let passwordMinLength: number | null = null;
  let passwordRequiresComplexity = false;
  const polRes = await oktaGet(host, "/api/v1/policies?type=PASSWORD", token);
  if (polRes.ok) {
    const policies = (await polRes.json()) as Array<{
      settings?: { password?: { complexity?: Record<string, number> } };
    }>;
    const complexity = policies[0]?.settings?.password?.complexity;
    if (complexity) {
      passwordMinLength = complexity.minLength ?? null;
      passwordRequiresComplexity = Boolean(
        complexity.minNumber || complexity.minSymbol || complexity.minUpperCase,
      );
    }
  }

  return {
    totalUsers: users.length,
    active: counts.active,
    suspended: counts.suspended,
    deprovisioned: counts.deprovisioned,
    mfaChecked,
    mfaEnrolled,
    passwordMinLength,
    passwordRequiresComplexity,
  };
}
