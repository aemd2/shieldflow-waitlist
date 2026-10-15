import type { IdentityAccount } from "@/lib/identity-checks";

/**
 * Match an account in some system (a GitHub login, a Cloudflare member, a
 * laptop's user) to the Personnel register. In order:
 *   1. a link someone recorded ("octocat is jane@acme.com") — identity_links;
 *   2. an email the system gives us that is in Personnel;
 *   3. a display name equal to one person's name;
 *   4. a handle equal to one person's email local part or squashed name
 *      ("jane.doe" → Jane Doe) — only if exactly one person fits, so a guess
 *      never pins one person's access on someone else;
 *   5. otherwise the system's own email, so a leaver recorded under it still matches.
 */

export interface PersonLite {
  name: string;
  email: string | null;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const squash = (s: string | null | undefined) => norm(s).replace(/[\s._-]+/g, "");

export function matchAddresses(
  c: { emails?: (string | null | undefined)[]; names?: (string | null | undefined)[]; handles?: (string | null | undefined)[] },
  people: PersonLite[],
  links?: Map<string, string>,
): string[] {
  for (const h of c.handles ?? []) {
    const linked = h ? links?.get(norm(h)) : undefined;
    if (linked) return [norm(linked)];
  }
  const direct = [...new Set((c.emails ?? []).map(norm).filter((e) => e.includes("@")))];
  const known = new Set(people.map((p) => norm(p.email)).filter(Boolean));
  if (direct.some((e) => known.has(e))) return direct;
  const unique = (pred: (p: PersonLite) => boolean) => {
    const hits = people.filter((p) => p.email && pred(p));
    return hits.length === 1 ? [norm(hits[0].email)] : [];
  };
  for (const n of c.names ?? []) {
    if (!squash(n)) continue;
    const m = unique((p) => squash(p.name) === squash(n));
    if (m.length) return m;
  }
  for (const h of c.handles ?? []) {
    const key = squash(h);
    if (!key) continue;
    const m = unique((p) => squash(norm(p.email).split("@")[0]) === key || squash(p.name) === key);
    if (m.length) return m;
  }
  return direct;
}

/** An IdentityAccount for the leaver / unknown-login engine. */
export function toIdentityAccount(label: string, active: boolean, addresses: string[]): IdentityAccount {
  return { email: addresses[0] ?? label, active, aliases: addresses };
}

/** identity_links rows for one provider → account (lower-case) → email. */
export function linkMap(rows: { account: string; email: string }[] | null | undefined): Map<string, string> {
  return new Map((rows ?? []).map((r) => [norm(r.account), norm(r.email)]));
}
