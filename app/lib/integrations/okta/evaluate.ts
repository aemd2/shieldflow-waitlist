import { daysSince, exceptionMap, listNames, resourceKey, Verdict, type CheckOutcome, type ExceptionRow } from "@/lib/checks-core";
import { evaluateSsoCoverage } from "@/lib/identity-checks";
import type { OktaPosture, OktaUserView } from "@/lib/integrations/okta/collect";

export interface OktaEvaluateOptions {
  now: Date;
  exceptions: ExceptionRow[];
  dormantDays: number;
}

const WEAK = new Set(["sms", "call", "email", "question"]);
/** Can sign in (or will again): everything but deactivated, suspended and never-activated. */
export const canSignIn = (u: Pick<OktaUserView, "status">) => !["DEPROVISIONED", "SUSPENDED", "STAGED", "PROVISIONED"].includes(u.status);
export const oktaUserResource = (host: string, u: Pick<OktaUserView, "email">, label = u.email) => ({ id: resourceKey(host, null, "user", u.email), label, region: null });

export function evaluateOkta(p: OktaPosture, opts: OktaEvaluateOptions): CheckOutcome[] {
  const ex = exceptionMap(opts.exceptions, opts.now);
  const V = (key: string) => new Verdict(key, ex);
  const out: CheckOutcome[] = [];
  const users = p.users.ok ? p.users.data : [];
  const live = users.filter(canSignIn);
  const truncated = "more users than one scan reads";

  {
    const v = V("okta.mfa");
    v.read(p.users, "users");
    if (p.usersTruncated) v.gap(truncated);
    const unread = live.filter((u) => u.factors === null);
    if (unread.length) v.gap(`factors not read for ${unread.length} ${unread.length === 1 ? "person" : "people"} (Okta rate limit)`);
    for (const u of live) if (u.factors && !u.factors.length) v.flag(oktaUserResource(p.host, u));
    out.push(v.settle(`All ${live.length} active users have a second factor.`, (n) => `${n} of ${live.length} active users have only a password.`));
  }
  {
    const v = V("okta.mfa_strong");
    v.read(p.users, "users");
    if (p.usersTruncated) v.gap(truncated);
    if (live.some((u) => u.factors === null)) v.gap("factors not read for everyone");
    for (const u of live) if (u.factors?.length && u.factors.every((f) => WEAK.has(f))) v.flag(oktaUserResource(p.host, u, `${u.email} (${[...new Set(u.factors)].join(", ")} only)`));
    out.push(v.settle("Everyone with MFA has Okta Verify, a security key or another strong factor.", (n) => `${n} ${n === 1 ? "person relies" : "people rely"} on SMS, voice or email codes only.`));
  }
  {
    const v = V("okta.password_policy");
    const min = v.read(p.passwordMinLength, "password policy");
    if (min === null && p.passwordMinLength.ok) v.gap("the default password policy has no minimum length");
    if (typeof min === "number" && min < 8) v.flag({ id: resourceKey(p.host, null, "policy", "password"), label: `minimum length ${min}`, region: null });
    out.push(v.settle(`Password minimum length is ${min}.`, () => `Password minimum length is ${min} — below 8.`));
  }
  {
    const v = V("okta.admins_mfa");
    v.read(p.users, "users");
    const admins = v.read(p.admins, "admin roles");
    if (admins) {
      for (const u of live.filter((x) => x.roles?.length)) {
        if (u.factors === null) v.gap(`factors not read for admin ${u.email}`);
        else if (!u.factors.some((f) => !WEAK.has(f))) v.flag(oktaUserResource(p.host, u, `${u.email} (${listNames(u.roles ?? [], 2)}) — ${u.factors.length ? "only SMS/voice/email" : "no second factor"}`));
      }
    }
    const n = live.filter((x) => x.roles?.length).length;
    out.push(v.settle(`All ${n} administrators have a strong second factor.`, (k) => `${k} ${k === 1 ? "administrator has" : "administrators have"} no strong second factor.`));
  }
  {
    const v = V("okta.super_admins");
    v.read(p.users, "users");
    const admins = v.read(p.admins, "admin roles");
    const supers = live.filter((u) => u.roles?.includes("SUPER_ADMIN"));
    if (admins && supers.length > 3) v.flag({ id: resourceKey(p.host, null, "role", "SUPER_ADMIN"), label: `${supers.length} Super Administrators: ${listNames(supers.map((u) => u.email))}`, region: null });
    out.push(v.settle(`${supers.length} Super ${supers.length === 1 ? "Administrator" : "Administrators"} — within the usual three.`, () => `${supers.length} Super Administrators — more than three.`));
  }
  {
    const v = V("okta.dormant");
    v.read(p.users, "users");
    if (p.usersTruncated) v.gap(truncated);
    for (const u of users.filter((x) => x.status === "ACTIVE")) {
      const since = daysSince(u.lastLogin, opts.now);
      if (since > opts.dormantDays && daysSince(u.created, opts.now) > opts.dormantDays) {
        v.flag(oktaUserResource(p.host, u, `${u.email} (${u.lastLogin ? `last signed in ${Math.floor(since)} days ago` : "never signed in"})`));
      }
    }
    out.push(v.settle(`Every active user has signed in within ${opts.dormantDays} days.`, (n) => `${n} active ${n === 1 ? "account hasn't" : "accounts haven't"} signed in for ${opts.dormantDays}+ days.`));
  }
  {
    const s = evaluateSsoCoverage(p.apps);
    const v = V("okta.sso_coverage");
    if (s.result === "fail") for (const name of s.subjects ?? []) v.flag({ id: resourceKey(p.host, null, "app", name), label: name, region: null });
    if (s.result === "inconclusive") v.gap(s.detail.replace(/\.$/, ""));
    out.push(s.result === "pass" ? { key: "okta.sso_coverage", result: "pass", detail: s.detail, resources: [], failingCount: 0, accepted: [] } : v.settle(s.detail, () => s.detail));
  }
  return out;
}
