/** Shared secret check. The scheduler (Vercel cron, Supabase pg_cron via pg_net, or
 * the sync dispatcher calling its per-company workers) must present CRON_SECRET;
 * without it, or without the env set, we refuse. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}
