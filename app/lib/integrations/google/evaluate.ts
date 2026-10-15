import { daysSince, exceptionMap, listNames, resourceKey, Verdict, type CheckOutcome, type CheckResource, type ExceptionRow } from "@/lib/checks-core";
import { riskyScopes } from "@/lib/integrations/google/catalog";
import type { GooglePosture, GUser } from "@/lib/integrations/google/types";

/**
 * Google Workspace posture → checks. Pure. The leaver / unknown-account checks
 * come from the shared roster engine (lib/checks.ts), not from here.
 */

export interface GoogleEvaluateOptions {
  now: Date;
  exceptions: ExceptionRow[];
  dormantDays: number;
}

export const userResource = (domain: string, u: Pick<GUser, "email">, label = u.email): CheckResource => ({
  id: resourceKey(domain, null, "user", u.email),
  label,
  region: null,
});
export const appResource = (domain: string, clientId: string, label: string): CheckResource => ({
  id: resourceKey(domain, null, "oauth-app", clientId),
  label,
  region: null,
});

/** Can sign in: not suspended, not archived. */
export const isLive = (u: GUser) => !u.suspended && !u.archived;

export function evaluateGoogle(p: GooglePosture, opts: GoogleEvaluateOptions): CheckOutcome[] {
  const ex = exceptionMap(opts.exceptions, opts.now);
  const V = (key: string) => new Verdict(key, ex);
  const domain = p.domain ?? "workspace";
  const out: CheckOutcome[] = [];
  const truncatedNote = "more accounts than one scan reads";

  const users = p.users.ok ? p.users.data : null;
  const live = (users ?? []).filter(isLive);

  // --------------------------------------------------------------- sign-in
  {
    const v = V("google.2sv_enforced");
    v.read(p.users, "accounts");
    if (p.truncated) v.gap(truncatedNote);
    for (const u of live) if (!u.enforced2sv) v.flag(userResource(domain, u, `${u.email} (${u.orgUnit})`));
    out.push(
      v.settle(`2-step verification is enforced for all ${live.length} active accounts.`, (n) => {
        const ous = [...new Set(live.filter((u) => !u.enforced2sv).map((u) => u.orgUnit))];
        return `${n} of ${live.length} active accounts can sign in without 2-step verification being enforced — in ${listNames(ous, 3)}.`;
      }),
    );
  }
  {
    const v = V("google.2fa");
    v.read(p.users, "accounts");
    if (p.truncated) v.gap(truncatedNote);
    for (const u of live) if (!u.enrolled2sv) v.flag(userResource(domain, u));
    const enrolled = live.filter((u) => u.enrolled2sv).length;
    out.push(
      v.settle(`All ${live.length} active accounts have 2-step verification.`, (n) => `${n} of ${live.length} active accounts have no 2-step verification (${enrolled} do).`),
    );
  }

  // ---------------------------------------------------------------- admins
  {
    const v = V("google.admins_2sv");
    v.read(p.users, "accounts");
    if (p.truncated) v.gap(truncatedNote);
    const admins = live.filter((u) => u.superAdmin || u.delegatedAdmin);
    for (const u of admins) if (!u.enrolled2sv) v.flag(userResource(domain, u, `${u.email} (${u.superAdmin ? "super admin" : "admin"})`));
    out.push(
      v.settle(
        admins.length ? `All ${admins.length} administrators have 2-step verification.` : "No active administrators found.",
        (n) => `${n} ${n === 1 ? "administrator has" : "administrators have"} no 2-step verification.`,
      ),
    );
  }
  {
    const v = V("google.super_admins");
    v.read(p.users, "accounts");
    if (p.truncated) v.gap(truncatedNote);
    const supers = live.filter((u) => u.superAdmin);
    if (supers.length > 3) v.flag({ id: resourceKey(domain, null, "domain", domain), label: `${supers.length} super admins: ${listNames(supers.map((u) => u.email))}`, region: null });
    out.push(v.settle(`${supers.length} super ${supers.length === 1 ? "admin" : "admins"} — within the usual three.`, () => `${supers.length} super admins — more than three.`));
  }

  // ---------------------------------------------------------------- people
  {
    const v = V("google.dormant");
    v.read(p.users, "accounts");
    if (p.truncated) v.gap(truncatedNote);
    for (const u of live) {
      const since = daysSince(u.lastLogin, opts.now);
      const age = daysSince(u.created, opts.now);
      // Never signed in: only dormant once the account is older than the window (not a new joiner).
      if (since > opts.dormantDays && age > opts.dormantDays) {
        const when = u.lastLogin ? `last signed in ${Math.floor(since)} days ago` : "never signed in";
        v.flag(userResource(domain, u, `${u.email} (${when})`));
      }
    }
    out.push(
      v.settle(`Every active account has signed in within ${opts.dormantDays} days.`, (n) => `${n} active ${n === 1 ? "account hasn't" : "accounts haven't"} signed in for ${opts.dormantDays}+ days.`),
    );
  }

  // ------------------------------------------------------------------ apps
  if (p.apps !== null) {
    const v = V("google.oauth_apps");
    const apps = v.read(p.apps, "third-party app grants") ?? [];
    for (const a of apps) {
      const r = riskyScopes(a.scopes);
      if (!r.length) continue;
      v.flag(appResource(domain, a.clientId, `${a.name} — ${r.join(", ")} (${a.users.length} ${a.users.length === 1 ? "person" : "people"})`));
    }
    out.push(
      v.settle(
        apps.length
          ? `${apps.length} third-party apps were granted access in the last ${p.appsWindowDays} days; none can read mail or all of Drive, or every one that can is approved.`
          : `No third-party app grants in the last ${p.appsWindowDays} days.`,
        (n) => `${n} ${n === 1 ? "app can" : "apps can"} read mail, all of Drive or admin settings and ${n === 1 ? "isn't" : "aren't"} approved yet.`,
      ),
    );
  }

  return out;
}
