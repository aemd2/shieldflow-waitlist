import type { AwsCreds } from "@/lib/aws/credentials";
import type { Section } from "@/lib/aws/types";

/**
 * Plumbing for the scanner: one deadline per scan, clients with tight timeouts,
 * a small concurrency pool, and error classification that names the missing
 * permission instead of failing the whole scan.
 */

export interface ScanCtx {
  creds: AwsCreds;
  accountId: string;
  /** Epoch ms after which no new AWS call starts. */
  deadline: number;
}

type ClientCtor<C> = new (config: Record<string, unknown>) => C;

/** One client per (service, region), sharing the scan's credentials. */
export function client<C>(Ctor: ClientCtor<C>, region: string, ctx: ScanCtx, extra: Record<string, unknown> = {}): C {
  return new Ctor({
    region,
    credentials: ctx.creds,
    maxAttempts: 3,
    requestHandler: { requestTimeout: 10_000, connectionTimeout: 4_000 },
    ...extra,
  });
}

export function timeLeft(ctx: ScanCtx): number {
  return ctx.deadline - Date.now();
}

const DENIED = /AccessDenied|UnauthorizedOperation|AuthorizationError|Unauthorized|NotAuthorized|AccessDeniedException/i;

export function errorName(err: unknown): string {
  return (err as { name?: string; Code?: string })?.name ?? (err as { Code?: string })?.Code ?? "";
}

/**
 * Run one collector. Never throws: a missing permission becomes `denied` (naming
 * the action, so the UI can say exactly what to add to the role), an expired
 * budget `timeout`, anything else `error`.
 */
export async function section<T>(action: string, ctx: ScanCtx, fn: () => Promise<T>): Promise<Section<T>> {
  if (timeLeft(ctx) <= 0) {
    return { ok: false, reason: "timeout", action, message: "Scan time ran out before this was read." };
  }
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    const name = errorName(err);
    const message = (err as Error)?.message ?? String(err);
    if (DENIED.test(name) || DENIED.test(message)) {
      return { ok: false, reason: "denied", action, message: `ShieldFlow's role isn't allowed ${action}.` };
    }
    if (/Timeout|TimedOut|AbortError/i.test(name)) {
      return { ok: false, reason: "timeout", action, message: "AWS didn't answer in time." };
    }
    return { ok: false, reason: "error", action, message: message.slice(0, 200) };
  }
}

/** Map with at most `limit` in flight, stopping new work once the deadline passes. */
export async function pool<T, R>(items: T[], limit: number, ctx: ScanCtx, fn: (item: T) => Promise<R>): Promise<R[]> {
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

/** Follow a nextToken-style paginator up to `cap` items. */
export async function collectPages<P, I>(
  first: () => Promise<P>,
  next: (token: string) => Promise<P>,
  items: (page: P) => I[] | undefined,
  token: (page: P) => string | undefined,
  cap: number,
  ctx: ScanCtx,
): Promise<I[]> {
  const out: I[] = [];
  let page = await first();
  out.push(...(items(page) ?? []));
  let t = token(page);
  while (t && out.length < cap && timeLeft(ctx) > 0) {
    page = await next(t);
    out.push(...(items(page) ?? []));
    t = token(page);
  }
  return out.slice(0, cap);
}

export function tagsOf(list: { Key?: string; Value?: string }[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of list ?? []) if (t.Key) out[t.Key] = t.Value ?? "";
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
