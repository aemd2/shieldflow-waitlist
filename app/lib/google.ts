// Server-side Google OAuth + Admin Directory helpers (plain fetch, no SDK).
// Used by the Google Workspace integration: connect via OAuth, then pull a
// user-security report (2FA enrollment etc.) as audit evidence.

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptIfConfigured } from "@/lib/crypto";

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

/**
 * Refresh the token if it is close to expiry, persisting the new one, and return
 * a token that is safe to call the Directory API with.
 *
 * This was copy-pasted in three places (the sync action, the access-review roster
 * pull and the personnel import) and each copy had to get the encryption, the
 * expiry margin and the write-back right. One copy means the identity checks can
 * reuse it rather than adding a fourth.
 *
 * Throws GoogleError rather than returning an error string, so callers keep using
 * the `catch (err) { if (err instanceof GoogleError) ... }` shape they already have.
 */
export interface GoogleTokenRow {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
}

export async function ensureGoogleAccessToken(
  db: SupabaseClient,
  integ: GoogleTokenRow,
): Promise<string> {
  let accessToken: string;
  try {
    accessToken = decryptSecret(integ.access_token ?? "");
  } catch {
    throw new GoogleError("auth", "Stored Google credentials are unreadable — please reconnect.");
  }

  // Refresh if the token expires within the next minute.
  const expiresAt = integ.token_expires_at ? new Date(integ.token_expires_at).getTime() : 0;
  if (expiresAt >= Date.now() + 60_000) return accessToken;

  if (!integ.refresh_token) {
    throw new GoogleError("auth", "Google access expired. Please reconnect the integration.");
  }
  const fresh = await refreshAccessToken(decryptSecret(integ.refresh_token));
  // Google occasionally omits expires_in — fall back to its standard 1h.
  const ttl = Number.isFinite(fresh.expires_in) ? fresh.expires_in : 3600;
  await db
    .from("integrations")
    .update({
      access_token: encryptIfConfigured(fresh.access_token),
      token_expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      status: "connected",
    })
    .eq("id", integ.id);

  return fresh.access_token;
}

export interface WorkspaceSecurityReport {
  total: number;
  with2fa: number;
  admins: number;
  suspended: number;
  /** Every user the API returned — the roster the identity checks reconcile against. */
  roster: WorkspaceUser[];
  /** True when the page budget ran out before Google stopped returning pages. */
  truncated: boolean;
}

/**
 * The whole posture in one call: the counts the checks consume plus the roster
 * they reconcile against, and whether we saw all of it.
 *
 * `truncated` matters more than it looks. A roster check that silently reads only
 * part of the directory can confidently PASS while an offboarded person sits on
 * an unread page — the worst possible failure for a compliance tool. Callers must
 * downgrade a pass to inconclusive when this is set.
 */
export async function fetchWorkspaceSecurity(accessToken: string): Promise<WorkspaceSecurityReport> {
  const { users, truncated } = await fetchWorkspaceUsersPaged(accessToken);
  return {
    total: users.length,
    with2fa: users.filter((u) => u.isEnrolledIn2Sv).length,
    admins: users.filter((u) => u.isAdmin).length,
    suspended: users.filter((u) => u.suspended).length,
    roster: users,
    truncated,
  };
}

export async function fetchWorkspaceUsers(accessToken: string): Promise<WorkspaceUser[]> {
  return (await fetchWorkspaceUsersPaged(accessToken)).users;
}

async function fetchWorkspaceUsersPaged(
  accessToken: string,
): Promise<{ users: WorkspaceUser[]; truncated: boolean }> {
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

  // A pageToken still in hand means we stopped on the budget, not on the data.
  return { users: all, truncated: Boolean(pageToken) };
}
