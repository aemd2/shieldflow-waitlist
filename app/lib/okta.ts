// Server-side Okta helpers (plain fetch, no SDK). Reads identity security
// evidence — user status breakdown, MFA enrollment, password policy — via a
// read-only API token (SSWS). Host is allow-listed to *.okta.com to block SSRF.

const MAX_USERS_PER_PAGE = 200; // Okta's own per-page maximum
// 5 x 200 = 1000 users. The old code read a single page and reported no more, so
// an org past 200 people silently lost the rest — fine for a count, fatal for the
// roster checks, which would confidently pass while an offboarded person sat on
// an unread page.
const MAX_USER_PAGES = 5;
const MAX_MFA_CHECKS = 50; // factor lookups are 1 request each — cap them
const MAX_APP_PAGES = 2; // 2 x 200 apps is far more than the target market runs

/**
 * Okta's sign-on modes, split by whether the app is genuinely federated.
 *
 * This distinction is the whole point of the SSO check. SAML/OIDC/WS-Fed mean
 * Okta is the only way in. BASIC_AUTH, BROWSER_PLUGIN and SECURE_PASSWORD_STORE
 * are Secure Web Authentication — Okta VAULTS a password and types it into the
 * app's own login form. That password still exists and still works if you go to
 * the app directly, so SSO is not actually enforced for it.
 *
 * BOOKMARK is just a link with no credential at all, so it belongs in neither
 * set and is excluded from the denominator.
 */
const FEDERATED_MODES = new Set(["SAML_2_0", "OPENID_CONNECT", "WS_FEDERATION"]);
const PASSWORD_MODES = new Set(["BASIC_AUTH", "BROWSER_PLUGIN", "SECURE_PASSWORD_STORE", "AUTO_LOGIN"]);

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
  /** Every user we read — the roster the identity checks reconcile against. */
  roster: OktaUser[];
  /** Null when the app list couldn't be read (token lacks app scope, or it failed). */
  apps: OktaAppSummary | null;
  /** True when the page budget ran out before Okta stopped returning pages. */
  truncated: boolean;
}

export interface OktaUser {
  email: string;
  name?: string;
  status: string;
}

export interface OktaAppSummary {
  /** Active apps that carry a credential (bookmarks excluded). */
  total: number;
  federated: number;
  /** Apps where Okta stores a password that also works without Okta. */
  passwordVaulted: number;
  /** Names of the password-vaulted apps, so the finding can be acted on. */
  passwordVaultedNames: string[];
  truncated: boolean;
}

interface OktaRawApp {
  label?: string;
  name?: string;
  status?: string;
  signOnMode?: string;
}

interface OktaRawUser {
  id: string;
  status: string;
  profile?: { email?: string; firstName?: string; lastName?: string };
}

/**
 * The path of the next page, from Okta's RFC 5988 Link header.
 *
 * Returns null unless the URL points at the SAME already-allow-listed Okta host
 * over https. The Link header is server-controlled data, and following it blindly
 * would turn our own pagination into an SSRF primitive — the exact thing
 * normalizeOktaHost exists to prevent.
 */
function nextPagePath(res: Response, host: string): string | null {
  const link = res.headers.get("link");
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (!match) continue;
    try {
      const url = new URL(match[1]);
      if (url.protocol !== "https:" || url.host !== host) return null;
      return `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  return null;
}

/** Walk the user list, bounded by MAX_USER_PAGES, reporting whether we saw it all. */
async function fetchAllUsers(
  host: string,
  token: string,
): Promise<{ users: OktaRawUser[]; truncated: boolean }> {
  const users: OktaRawUser[] = [];
  let path: string | null = `/api/v1/users?limit=${MAX_USERS_PER_PAGE}`;
  let pages = 0;

  while (path && pages < MAX_USER_PAGES) {
    const res = await oktaGet(host, path, token);
    check(res);
    users.push(...((await res.json()) as OktaRawUser[]));
    path = nextPagePath(res, host);
    pages++;
  }

  // A path still in hand means we stopped on the budget, not on the data.
  return { users, truncated: path !== null };
}

/**
 * Which apps are genuinely behind SSO, and which keep a bypassable password.
 *
 * Best-effort by design: a read-only token that can list users may not be
 * allowed to list apps, and a 403 here must not cost us the user checks that
 * already succeeded. Returns null on any failure, which the evaluator turns into
 * `inconclusive` rather than a verdict.
 */
async function fetchApps(host: string, token: string): Promise<OktaAppSummary | null> {
  try {
    const apps: OktaRawApp[] = [];
    let path: string | null = "/api/v1/apps?limit=200";
    let pages = 0;

    while (path && pages < MAX_APP_PAGES) {
      const res = await oktaGet(host, path, token);
      if (!res.ok) return null;
      apps.push(...((await res.json()) as OktaRawApp[]));
      path = nextPagePath(res, host);
      pages++;
    }

    const active = apps.filter((a) => a.status === "ACTIVE");
    const federated = active.filter((a) => FEDERATED_MODES.has(a.signOnMode ?? ""));
    const vaulted = active.filter((a) => PASSWORD_MODES.has(a.signOnMode ?? ""));

    return {
      total: federated.length + vaulted.length,
      federated: federated.length,
      passwordVaulted: vaulted.length,
      passwordVaultedNames: vaulted.map((a) => a.label || a.name || "unnamed app"),
      truncated: path !== null,
    };
  } catch {
    return null;
  }
}

function toOktaUser(u: OktaRawUser): OktaUser {
  const name = [u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(" ");
  return { email: u.profile!.email as string, name: name || undefined, status: u.status };
}

/** Raw per-user list (email + name + status) — for pre-filling an access
 * review roster or the personnel list, not a full security report. */
export async function fetchUsersRaw(host: string, token: string): Promise<OktaUser[]> {
  const { users } = await fetchAllUsers(host, token);
  return users.filter((u) => u.profile?.email).map(toOktaUser);
}

export async function fetchUserSecurity(host: string, token: string): Promise<OktaSecurityReport> {
  const { users, truncated } = await fetchAllUsers(host, token);

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
    roster: users.filter((u) => u.profile?.email).map(toOktaUser),
    truncated,
    apps: await fetchApps(host, token),
  };
}
