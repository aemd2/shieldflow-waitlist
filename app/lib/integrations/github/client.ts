import { createSign } from "node:crypto";
import type { Section } from "@/lib/checks-core";
import type { GitHubAuth } from "@/lib/integrations/github/types";

/**
 * GitHub over plain fetch. Two ways in:
 *  - the ShieldFlow GitHub App (recommended): read-only permissions the customer
 *    sees and approves at install; each scan mints a one-hour installation token;
 *  - a token (the older OAuth app's `repo` scope, or a PAT) — still works, with
 *    an "upgrade to the App" note, because `repo` can also write.
 */

const API = "https://api.github.com";

export class GitHubAccessError extends Error {
  constructor(
    public kind: "auth" | "not_configured" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "GitHubAccessError";
  }
}

export class GhHttpError extends Error {
  constructor(
    public status: number,
    public path: string,
    public rateLimited: boolean,
    message: string,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ the App

export function appConfig() {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  return {
    appId,
    slug,
    privateKey,
    clientId,
    clientSecret,
    configured: Boolean(appId && slug && privateKey && clientId && clientSecret),
  };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** A ten-minute JWT that identifies the App itself (RS256, signed with its private key). */
export function appJwt(): string {
  const cfg = appConfig();
  if (!cfg.appId || !cfg.privateKey) throw new GitHubAccessError("not_configured", "The ShieldFlow GitHub App isn't set up on this server yet.");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: cfg.appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${b64url(signer.sign(cfg.privateKey))}`;
}

async function appRequest(path: string, method = "GET") {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${appJwt()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new GitHubAccessError("auth", "The ShieldFlow GitHub App was uninstalled from this account — install it again.");
  if (!res.ok) throw new GitHubAccessError("unavailable", `GitHub didn't answer (${res.status}). Try again shortly.`);
  return res.json();
}

/** The account an installation belongs to. */
export async function installationAccount(installationId: number): Promise<{ login: string; type: "Organization" | "User" }> {
  const j = (await appRequest(`/app/installations/${installationId}`)) as { account?: { login?: string; type?: string } };
  return { login: j.account?.login ?? "unknown", type: j.account?.type === "Organization" ? "Organization" : "User" };
}

async function installationToken(installationId: number): Promise<string> {
  const j = (await appRequest(`/app/installations/${installationId}/access_tokens`, "POST")) as { token?: string };
  if (!j.token) throw new GitHubAccessError("unavailable", "GitHub didn't issue an installation token.");
  return j.token;
}

export async function tokenFor(auth: GitHubAuth): Promise<string> {
  return auth.kind === "app" ? installationToken(auth.installationId) : auth.token;
}

/** Stored credential → auth. App installs store `{kind:"app",installationId}`; tokens are stored raw. */
export function parseStoredAuth(decrypted: string): GitHubAuth {
  try {
    const j = JSON.parse(decrypted) as { kind?: string; installationId?: number };
    if (j && j.kind === "app" && typeof j.installationId === "number") return { kind: "app", installationId: j.installationId };
  } catch {
    // a raw token
  }
  return { kind: "token", token: decrypted };
}

// --------------------------------------------------------------- requests

export interface GhCtx {
  token: string;
  /** Epoch ms after which no new request starts. */
  deadline: number;
}

export const timeLeft = (ctx: GhCtx) => ctx.deadline - Date.now();

export async function ghGet(ctx: GhCtx, path: string): Promise<{ status: number; json: unknown; next: string | null }> {
  let res: Response;
  try {
    res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
      headers: { Authorization: `Bearer ${ctx.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GhHttpError(0, path, false, "GitHub didn't answer in time.");
  }
  if (res.status === 401) throw new GitHubAccessError("auth", "GitHub rejected ShieldFlow's access — reconnect GitHub.");
  const rateLimited = (res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0";
  const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok && res.status !== 204) {
    const msg = (json as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    throw new GhHttpError(res.status, path, rateLimited, msg);
  }
  return { status: res.status, json, next };
}

/** Follow `Link: rel="next"` up to `cap` items (or the deadline). */
export async function ghPages<T>(ctx: GhCtx, path: string, cap: number, pick: (j: unknown) => T[] = (j) => j as T[]): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let url: string | null = path;
  while (url && items.length < cap && timeLeft(ctx) > 0) {
    const page: { json: unknown; next: string | null } = await ghGet(ctx, url);
    items.push(...pick(page.json));
    url = page.next;
  }
  return { items: items.slice(0, cap), truncated: Boolean(url) };
}

export async function ghGraphql<T>(ctx: GhCtx, query: string, variables: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GhHttpError(0, "graphql", false, "GitHub didn't answer in time.");
  }
  if (res.status === 401) throw new GitHubAccessError("auth", "GitHub rejected ShieldFlow's access — reconnect GitHub.");
  const j = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || !j.data) throw new GhHttpError(res.status, "graphql", false, j.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return j.data;
}

/** Run one collector: never throws except for a revoked connection. */
export async function ghSection<T>(action: string, ctx: GhCtx, fn: () => Promise<T>): Promise<Section<T>> {
  if (timeLeft(ctx) <= 0) return { ok: false, reason: "timeout", action, message: "Scan time ran out before this was read." };
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof GitHubAccessError) throw err;
    if (err instanceof GhHttpError) {
      if (err.rateLimited) return { ok: false, reason: "timeout", action, message: "GitHub's rate limit was reached." };
      if (err.status === 403 || err.status === 404) {
        return { ok: false, reason: "denied", action, message: `ShieldFlow can't read ${action} (${err.message.slice(0, 80)}).` };
      }
      return { ok: false, reason: "error", action, message: err.message.slice(0, 160) };
    }
    return { ok: false, reason: "error", action, message: ((err as Error)?.message ?? String(err)).slice(0, 160) };
  }
}

/** Map with at most `limit` in flight, stopping new work at the deadline. */
export async function pool<T, R>(items: T[], limit: number, ctx: GhCtx, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length && timeLeft(ctx) > 0) {
      const item = items[i++];
      out.push(await fn(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
