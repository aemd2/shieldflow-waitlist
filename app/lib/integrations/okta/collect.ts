import { OktaError, normalizeOktaHost } from "@/lib/okta";
import { ok, type Section } from "@/lib/checks-core";
import type { SsoAppSummary } from "@/lib/identity-checks";

/**
 * Read Okta with a read-only admin token: every user (with last sign-in),
 * every active user's factors, who holds admin roles, the password policy and
 * the app list. Factor reads are one call per person; if Okta rate-limits us
 * part-way, the rest are "not read" — never counted as enrolled.
 */

const MAX_USER_PAGES = 10; // 10 × 200
const MAX_FACTOR_READS = 1500;
const FEDERATED = new Set(["SAML_2_0", "OPENID_CONNECT", "WS_FEDERATION"]);
const PASSWORD = new Set(["BASIC_AUTH", "BROWSER_PLUGIN", "SECURE_PASSWORD_STORE", "AUTO_LOGIN"]);

export interface OktaUserView {
  id: string;
  email: string;
  name: string | null;
  status: string;
  lastLogin: string | null;
  created: string | null;
  /** Active factor types; null = not read. */
  factors: string[] | null;
  /** Admin role types (SUPER_ADMIN, ORG_ADMIN…); null = roles not read. */
  roles: string[] | null;
}

export interface OktaPosture {
  host: string;
  scannedAt: string;
  durationMs: number;
  users: Section<OktaUserView[]>;
  usersTruncated: boolean;
  /** Factor reads stopped early (rate limit / budget). */
  factorsIncomplete: boolean;
  admins: Section<{ userId: string; roles: string[] }[]>;
  passwordMinLength: Section<number | null>;
  apps: SsoAppSummary | null;
}

class Http extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

function nextPath(res: Response, host: string): string | null {
  for (const part of (res.headers.get("link") ?? "").split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (!m) continue;
    try {
      const u = new URL(m[1]);
      return u.protocol === "https:" && u.host === host ? `${u.pathname}${u.search}` : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function get(host: string, token: string, path: string): Promise<Response> {
  const res = await fetch(`https://${host}${path}`, { headers: { Authorization: `SSWS ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }).catch(() => {
    throw new OktaError("unavailable", "Couldn't reach Okta. Please try again.");
  });
  if (res.status === 401) throw new OktaError("auth", "Okta rejected this token. Check it and reconnect.");
  if (!res.ok) throw new Http(res.status);
  return res;
}

async function pages<T>(host: string, token: string, first: string, max: number): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let path: string | null = first;
  let n = 0;
  while (path && n < max) {
    const res = await get(host, token, path);
    items.push(...((await res.json()) as T[]));
    path = nextPath(res, host);
    n++;
  }
  return { items, truncated: path !== null };
}

const fail = (action: string, what: string, e: unknown): Section<never> => {
  if (e instanceof OktaError) throw e;
  const status = e instanceof Http ? e.status : 0;
  return { ok: false, reason: status === 403 ? "denied" : "error", action, message: status === 403 ? `the token can't read ${what} — use a Read-Only Administrator's token` : `${what} couldn't be read` };
};

export async function collectOkta(hostInput: string, token: string): Promise<OktaPosture> {
  const started = Date.now();
  const host = normalizeOktaHost(hostInput);
  if (!host) throw new OktaError("auth", "That isn't an Okta address — reconnect with your-org.okta.com.");

  type RawUser = { id: string; status: string; created?: string; lastLogin?: string | null; profile?: { email?: string; firstName?: string; lastName?: string } };
  let users: Section<OktaUserView[]>;
  let usersTruncated = false;
  let factorsIncomplete = false;
  try {
    const r = await pages<RawUser>(host, token, "/api/v1/users?limit=200", MAX_USER_PAGES);
    usersTruncated = r.truncated;
    const list: OktaUserView[] = r.items
      .filter((u) => u.profile?.email)
      .map((u) => ({
        id: u.id,
        email: u.profile!.email!.toLowerCase(),
        name: [u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(" ") || null,
        status: u.status,
        lastLogin: u.lastLogin ?? null,
        created: u.created ?? null,
        factors: null,
        roles: null,
      }));
    // Factors for every active user, five at a time, stopping cleanly on a rate limit.
    const active = list.filter((u) => u.status === "ACTIVE" || u.status === "PASSWORD_EXPIRED" || u.status === "LOCKED_OUT" || u.status === "RECOVERY");
    if (active.length > MAX_FACTOR_READS) factorsIncomplete = true;
    let next = 0;
    let stop = false;
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        while (!stop && next < Math.min(active.length, MAX_FACTOR_READS)) {
          const u = active[next++];
          try {
            const res = await get(host, token, `/api/v1/users/${u.id}/factors`);
            u.factors = ((await res.json()) as { status?: string; factorType?: string }[]).filter((f) => f.status === "ACTIVE").map((f) => f.factorType ?? "unknown");
          } catch (e) {
            if (e instanceof OktaError) throw e;
            if (e instanceof Http && e.status === 429) stop = true;
            factorsIncomplete = true;
          }
        }
      }),
    );
    users = ok(list);
  } catch (e) {
    users = fail("okta.users.read", "users", e);
  }

  // Who holds an admin role: the role-assignees list, then each person's roles.
  let admins: Section<{ userId: string; roles: string[] }[]>;
  try {
    const r = await get(host, token, "/api/v1/iam/assignees/users?limit=200");
    const j = (await r.json()) as { value?: { id: string }[] } | { id: string }[];
    const ids = (Array.isArray(j) ? j : (j.value ?? [])).map((x) => x.id).slice(0, 200);
    const out: { userId: string; roles: string[] }[] = [];
    for (const id of ids) {
      const rr = await get(host, token, `/api/v1/users/${id}/roles`);
      out.push({ userId: id, roles: ((await rr.json()) as { type?: string }[]).map((x) => x.type ?? "ADMIN") });
    }
    admins = ok(out);
  } catch (e) {
    admins = fail("okta.roles.read", "admin role assignments", e);
  }
  if (users.ok && admins.ok) {
    const byId = new Map(admins.data.map((a) => [a.userId, a.roles]));
    for (const u of users.data) u.roles = byId.get(u.id) ?? [];
  }

  let passwordMinLength: Section<number | null>;
  try {
    const r = await get(host, token, "/api/v1/policies?type=PASSWORD");
    const pols = (await r.json()) as { system?: boolean; priority?: number; settings?: { password?: { complexity?: { minLength?: number } } } }[];
    // The default policy is the floor everyone falls back to.
    const def = pols.find((p) => p.system) ?? pols.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
    passwordMinLength = ok(def?.settings?.password?.complexity?.minLength ?? null);
  } catch (e) {
    passwordMinLength = fail("okta.policies.read", "the password policy", e);
  }

  let apps: SsoAppSummary | null = null;
  try {
    const r = await pages<{ label?: string; name?: string; status?: string; signOnMode?: string }>(host, token, "/api/v1/apps?limit=200", 3);
    const active = r.items.filter((a) => a.status === "ACTIVE");
    const fed = active.filter((a) => FEDERATED.has(a.signOnMode ?? ""));
    const vault = active.filter((a) => PASSWORD.has(a.signOnMode ?? ""));
    apps = { total: fed.length + vault.length, federated: fed.length, passwordVaulted: vault.length, passwordVaultedNames: vault.map((a) => a.label || a.name || "unnamed app"), truncated: r.truncated };
  } catch (e) {
    if (e instanceof OktaError) throw e;
  }

  return { host, scannedAt: new Date(started).toISOString(), durationMs: Date.now() - started, users, usersTruncated, factorsIncomplete, admins, passwordMinLength, apps };
}
