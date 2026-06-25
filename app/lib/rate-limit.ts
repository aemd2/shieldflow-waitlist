/**
 * In-memory sliding-window rate limiter for the AI routes.
 *
 * The UI already enforces one in-flight request per user, but that's only a
 * courtesy — anyone can hit /api/copilot directly with curl. This is the real
 * guard: it caps how fast a single user can burn the shared Groq free-tier
 * quota, so one abusive (or scripted) user can't take AI down for everyone.
 *
 * In-memory is the right trade-off at this scale: a restart resets the
 * counters (harmless), and on a single Vercel/Node instance serving ~100
 * users it needs no external store.
 */

const windows = new Map<string, number[]>();

/** Returns true if the call is allowed; false if the user is over the limit. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (windows.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    windows.set(key, hits);
    return false;
  }
  hits.push(now);
  windows.set(key, hits);

  // Opportunistic cleanup so the map never grows unbounded.
  if (windows.size > 1000) {
    for (const [k, v] of windows) {
      if (v.every((t) => t <= cutoff)) windows.delete(k);
    }
  }
  return true;
}

export const RATE_LIMIT_MESSAGE =
  "You're sending requests too quickly. Please wait a moment and try again.";
