// Server-side Google OAuth + Admin Directory helpers (plain fetch, no SDK).
// Used by the Google Workspace integration: connect via OAuth, then pull a
// user-security report (2FA enrollment etc.) as audit evidence.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const USERS_URL =
  "https://admin.googleapis.com/admin/directory/v1/users" +
  "?customer=my_customer&maxResults=500" +
  "&fields=nextPageToken,users(primaryEmail,name.fullName,isEnrolledIn2Sv,isAdmin,suspended,orgUnitPath)";

// Pagination bound: 4 pages × 500 = 2000 users max per sync — plenty for the
// 11–200 employee target market, and keeps memory/time bounded for outliers.
const MAX_USER_PAGES = 4;

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/admin.directory.user.readonly";

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export class GoogleError extends Error {
  constructor(
    public kind: "auth" | "forbidden" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "GoogleError";
  }
}

export function buildConsentUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline", // we need a refresh_token for background syncs
    prompt: "consent", // force refresh_token issuance on reconnect
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new GoogleError("auth", "Google sign-in failed. Please try connecting again.");
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    // invalid_grant = access revoked at Google → user must reconnect.
    throw new GoogleError("auth", "Google access was revoked. Please reconnect the integration.");
  }
  return res.json();
}

export interface WorkspaceUser {
  primaryEmail: string;
  fullName?: string;
  isEnrolledIn2Sv: boolean;
  isAdmin: boolean;
  suspended: boolean;
  orgUnitPath?: string;
}

interface RawWorkspaceUser {
  primaryEmail: string;
  name?: { fullName?: string };
  isEnrolledIn2Sv: boolean;
  isAdmin: boolean;
  suspended: boolean;
  orgUnitPath?: string;
}

export async function fetchWorkspaceUsers(accessToken: string): Promise<WorkspaceUser[]> {
  const all: WorkspaceUser[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_USER_PAGES; page++) {
    const url = pageToken ? `${USERS_URL}&pageToken=${encodeURIComponent(pageToken)}` : USERS_URL;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401) {
      throw new GoogleError("auth", "Google session expired. Please reconnect the integration.");
    }
    if (res.status === 403) {
      throw new GoogleError(
        "forbidden",
        "This Google account isn't a Workspace admin — connect with an admin account.",
      );
    }
    if (!res.ok) {
      throw new GoogleError("unavailable", "Google is unavailable right now. Try again shortly.");
    }
    const json = await res.json();
    const rawUsers = (json.users ?? []) as RawWorkspaceUser[];
    all.push(
      ...rawUsers.map((u) => ({
        primaryEmail: u.primaryEmail,
        fullName: u.name?.fullName,
        isEnrolledIn2Sv: u.isEnrolledIn2Sv,
        isAdmin: u.isAdmin,
        suspended: u.suspended,
        orgUnitPath: u.orgUnitPath,
      })),
    );
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }

  return all;
}
