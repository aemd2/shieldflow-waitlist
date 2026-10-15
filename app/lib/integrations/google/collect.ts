import { GoogleError } from "@/lib/google";
import { ok, type Section } from "@/lib/checks-core";
import type { GApp, GooglePosture, GUser } from "@/lib/integrations/google/types";

/**
 * Read a Google Workspace with the admin's read-only token: every account from
 * the Directory API, and the third-party apps people granted access to, from
 * the token audit log (Reports API). Both scopes are read-only — the token API
 * (users.tokens) would list grants too, but its scope can also revoke them.
 */

const USERS_URL =
  "https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults=500&projection=basic" +
  "&fields=nextPageToken,users(primaryEmail,aliases,name/fullName,isEnrolledIn2Sv,isEnforcedIn2Sv,isAdmin,isDelegatedAdmin,suspended,archived,lastLoginTime,creationTime,orgUnitPath)";
const TOKEN_EVENTS_URL = "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/token";

/** 10 × 500 accounts — well past the 11–200-person companies we sell to. */
const MAX_USER_PAGES = 10;
const MAX_EVENT_PAGES = 10;
export const APPS_WINDOW_DAYS = 180;
const NEVER = "1970-01-01T00:00:00.000Z";

async function gget(token: string, url: string): Promise<Response> {
  return fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
}

export async function readUsers(token: string): Promise<{ users: GUser[]; truncated: boolean }> {
  const users: GUser[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_USER_PAGES; page++) {
    const res = await gget(token, pageToken ? `${USERS_URL}&pageToken=${encodeURIComponent(pageToken)}` : USERS_URL);
    if (res.status === 401) throw new GoogleError("auth", "Google session expired. Please reconnect the integration.");
    if (res.status === 403) throw new GoogleError("forbidden", "This Google account isn't a Workspace admin — connect with an admin account.");
    if (!res.ok) throw new GoogleError("unavailable", "Google is unavailable right now. Try again shortly.");
    const json = (await res.json()) as { users?: Record<string, unknown>[]; nextPageToken?: string };
    for (const u of json.users ?? []) {
      const last = (u.lastLoginTime as string | undefined) ?? null;
      users.push({
        email: String(u.primaryEmail).toLowerCase(),
        aliases: Array.isArray(u.aliases) ? (u.aliases as string[]).map((a) => a.toLowerCase()) : [],
        name: (u.name as { fullName?: string } | undefined)?.fullName ?? null,
        enrolled2sv: Boolean(u.isEnrolledIn2Sv),
        enforced2sv: Boolean(u.isEnforcedIn2Sv),
        superAdmin: Boolean(u.isAdmin),
        delegatedAdmin: Boolean(u.isDelegatedAdmin),
        suspended: Boolean(u.suspended),
        archived: Boolean(u.archived),
        lastLogin: last && last !== NEVER ? last : null,
        created: (u.creationTime as string | undefined) ?? null,
        orgUnit: (u.orgUnitPath as string | undefined) ?? "/",
      });
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return { users, truncated: Boolean(pageToken) };
}

interface TokenEvent {
  time: string;
  user: string;
  name: "authorize" | "revoke";
  clientId: string;
  app: string;
  scopes: string[];
}

class ScopeMissing extends Error {}

async function tokenEvents(token: string, eventName: "authorize" | "revoke", since: Date): Promise<{ events: TokenEvent[]; complete: boolean }> {
  const out: TokenEvent[] = [];
  let pageToken: string | undefined;
  const base = `${TOKEN_EVENTS_URL}?eventName=${eventName}&maxResults=1000&startTime=${encodeURIComponent(since.toISOString())}`;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const res = await gget(token, pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base);
    if (res.status === 403) {
      const body = await res.text();
      if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(body)) throw new ScopeMissing();
      throw new GoogleError("forbidden", "This admin can't read the audit log (Reports) — use a super admin, or an admin role with Reports.");
    }
    if (res.status === 401) throw new GoogleError("auth", "Google session expired. Please reconnect the integration.");
    if (!res.ok) throw new GoogleError("unavailable", "Google's audit log is unavailable right now.");
    const json = (await res.json()) as {
      items?: { id?: { time?: string }; actor?: { email?: string }; events?: { name?: string; parameters?: { name: string; value?: string; multiValue?: string[] }[] }[] }[];
      nextPageToken?: string;
    };
    for (const item of json.items ?? []) {
      for (const ev of item.events ?? []) {
        if (ev.name !== eventName) continue;
        const p = new Map((ev.parameters ?? []).map((x) => [x.name, x]));
        const clientId = p.get("client_id")?.value;
        if (!clientId || !item.actor?.email || !item.id?.time) continue;
        out.push({
          time: item.id.time,
          user: item.actor.email.toLowerCase(),
          name: eventName,
          clientId,
          app: p.get("app_name")?.value ?? clientId,
          scopes: p.get("scope")?.multiValue ?? [],
        });
      }
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return { events: out, complete: !pageToken };
}

/** Who still holds a grant: replay authorise / revoke in order, per person and app. */
export function appsFrom(events: TokenEvent[]): GApp[] {
  const holding = new Map<string, TokenEvent>();
  for (const e of [...events].sort((a, b) => a.time.localeCompare(b.time))) {
    const k = `${e.user}|${e.clientId}`;
    if (e.name === "authorize") holding.set(k, e);
    else holding.delete(k);
  }
  const apps = new Map<string, GApp>();
  for (const e of holding.values()) {
    const a = apps.get(e.clientId) ?? { clientId: e.clientId, name: e.app, scopes: [], users: [], lastAuthorized: e.time };
    a.users.push(e.user);
    a.scopes = [...new Set([...a.scopes, ...e.scopes])];
    if (e.time > a.lastAuthorized) {
      a.lastAuthorized = e.time;
      a.name = e.app;
    }
    apps.set(e.clientId, a);
  }
  return [...apps.values()].sort((a, b) => b.users.length - a.users.length || a.name.localeCompare(b.name));
}

async function readApps(token: string, now: Date): Promise<Section<GApp[]> | null> {
  const since = new Date(now.getTime() - APPS_WINDOW_DAYS * 86_400_000);
  try {
    const [auth, rev] = await Promise.all([tokenEvents(token, "authorize", since), tokenEvents(token, "revoke", since)]);
    if (!auth.complete || !rev.complete) {
      return { ok: false, reason: "timeout", action: "Reports API token activity", message: "more app grants than one scan reads" };
    }
    return ok(appsFrom([...auth.events, ...rev.events]));
  } catch (err) {
    if (err instanceof ScopeMissing) return null;
    if (err instanceof GoogleError && err.kind === "auth") throw err;
    const message = err instanceof GoogleError ? err.userMessage : "the audit log couldn't be read";
    return { ok: false, reason: err instanceof GoogleError && err.kind === "forbidden" ? "denied" : "error", action: "Reports API token activity", message };
  }
}

export async function collectGoogle(token: string): Promise<GooglePosture> {
  const started = Date.now();
  const now = new Date(started);
  const [{ users, truncated }, apps] = await Promise.all([readUsers(token), readApps(token, now)]);
  return {
    domain: users[0]?.email.split("@")[1] ?? null,
    scannedAt: now.toISOString(),
    durationMs: Date.now() - started,
    users: ok(users),
    truncated,
    apps,
    appsWindowDays: APPS_WINDOW_DAYS,
  };
}
