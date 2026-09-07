// Server-side Microsoft 365 / Entra ID helpers (plain fetch, no SDK).
//
// Reads the directory to answer the two identity questions: has a leaver kept
// their access, and does every working account belong to someone. Uses the
// client-credentials (app-only) flow, so unlike Google there is no user OAuth
// dance and no refresh token to keep alive — every sync mints a short-lived
// token from credentials the customer registered in their own tenant.
//
// Deliberately NOT reading MFA state. Per-user MFA lives behind
// /reports/authenticationMethods, which needs a further consent grant
// (Reports.Read.All). The roster checks only need the user list and whether the
// account is enabled, so we ask for the least we can do the job with.

const LOGIN_HOST = "login.microsoftonline.com";
const GRAPH_HOST = "graph.microsoft.com";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

// $top=999 is Graph's maximum for users. 5 pages ≈ 5,000 people, far beyond the
// 11–200 employee target market, and keeps one sync bounded for outliers.
const PAGE_SIZE = 999;
const MAX_USER_PAGES = 5;

const USER_FIELDS = "id,displayName,userPrincipalName,mail,accountEnabled";

export class MicrosoftError extends Error {
  constructor(
    public kind: "auth" | "forbidden" | "rate_limited" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "MicrosoftError";
  }
}

/**
 * Accept either the tenant GUID or a domain like `contoso.onmicrosoft.com`, and
 * reject anything else. This value is interpolated into the token URL, so it is
 * validated rather than trusted — a tenant of "../../evil" would otherwise walk
 * the path.
 */
export function normalizeTenantId(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const domain = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
  return guid.test(raw) || domain.test(raw) ? raw : null;
}

export interface MicrosoftCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** Mint an app-only access token. Short-lived, so this runs on every sync. */
async function getAppToken(creds: MicrosoftCredentials): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`https://${LOGIN_HOST}/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        scope: GRAPH_SCOPE,
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new MicrosoftError("unavailable", "Couldn't reach Microsoft. Please try again.");
  }

  if (!res.ok) {
    // Entra returns 400/401 with an error code for bad or revoked credentials.
    throw new MicrosoftError(
      "auth",
      "Microsoft rejected these credentials. Check the tenant ID, client ID and secret, " +
        "and that the client secret hasn't expired.",
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new MicrosoftError("auth", "Microsoft didn't return an access token. Please reconnect.");
  }
  return json.access_token;
}

function check(res: Response): void {
  if (res.status === 401) {
    throw new MicrosoftError("auth", "Microsoft rejected the token. Please reconnect the integration.");
  }
  if (res.status === 403) {
    throw new MicrosoftError(
      "forbidden",
      "This app registration lacks directory access. Grant the User.Read.All application " +
        "permission and click “Grant admin consent” in Entra ID.",
    );
  }
  if (res.status === 429) {
    throw new MicrosoftError("rate_limited", "Microsoft rate limit reached. Try again in a minute.");
  }
  if (!res.ok) {
    throw new MicrosoftError("unavailable", "Microsoft is unavailable right now. Try again shortly.");
  }
}

export interface MicrosoftUser {
  /** Primary address for matching: `mail` when set, otherwise the UPN. */
  email: string;
  /** The other address, when they differ — Entra commonly has both. */
  aliases: string[];
  name?: string;
  enabled: boolean;
}

export interface MicrosoftSecurityReport {
  totalUsers: number;
  enabled: number;
  disabled: number;
  /** The roster the identity checks reconcile against. */
  roster: MicrosoftUser[];
  /** True when the page budget ran out before Graph stopped returning pages. */
  truncated: boolean;
}

interface RawGraphUser {
  displayName?: string;
  userPrincipalName?: string;
  mail?: string | null;
  accountEnabled?: boolean;
}

/**
 * The next page URL from Graph's `@odata.nextLink`, but only when it points at
 * Graph itself over https. The link is server-supplied, and following it blindly
 * would make our own pagination an SSRF primitive.
 */
function nextPage(link: unknown): string | null {
  if (typeof link !== "string" || !link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.host === GRAPH_HOST ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Validate credentials by reading the tenant. Returns its display name. */
export async function validateCredentials(creds: MicrosoftCredentials): Promise<string> {
  const token = await getAppToken(creds);
  const res = await fetch(`https://${GRAPH_HOST}/v1.0/organization?$select=displayName`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new MicrosoftError("unavailable", "Couldn't reach Microsoft. Please try again.");
  });
  check(res);
  const json = (await res.json()) as { value?: { displayName?: string }[] };
  return json.value?.[0]?.displayName || creds.tenantId;
}

export async function fetchDirectorySecurity(
  creds: MicrosoftCredentials,
): Promise<MicrosoftSecurityReport> {
  const token = await getAppToken(creds);

  const roster: MicrosoftUser[] = [];
  let url: string | null =
    `https://${GRAPH_HOST}/v1.0/users?$select=${USER_FIELDS}&$top=${PAGE_SIZE}`;
  let pages = 0;

  while (url && pages < MAX_USER_PAGES) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new MicrosoftError("unavailable", "Couldn't reach Microsoft. Please try again.");
    });
    check(res);

    const json = (await res.json()) as { value?: RawGraphUser[]; "@odata.nextLink"?: string };
    for (const u of json.value ?? []) {
      // `mail` is the address people actually use; UPN is the sign-in identity,
      // and in many tenants they differ (user@company.com vs
      // user@company.onmicrosoft.com). Keep both so matching a personnel record
      // works whichever one was recorded.
      const mail = u.mail?.trim();
      const upn = u.userPrincipalName?.trim();
      const email = mail || upn;
      if (!email) continue;
      const aliases = mail && upn && mail.toLowerCase() !== upn.toLowerCase() ? [upn] : [];
      roster.push({
        email,
        aliases,
        name: u.displayName || undefined,
        enabled: u.accountEnabled !== false,
      });
    }

    url = nextPage(json["@odata.nextLink"]);
    pages++;
  }

  const enabled = roster.filter((u) => u.enabled).length;
  return {
    totalUsers: roster.length,
    enabled,
    disabled: roster.length - enabled,
    roster,
    // A URL still in hand means we stopped on the budget, not on the data.
    truncated: url !== null,
  };
}
