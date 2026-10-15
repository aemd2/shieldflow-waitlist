import { exceptionMap, listNames, resourceKey, Verdict, type CheckOutcome, type ExceptionRow } from "@/lib/checks-core";
import { evaluateDevices, type DevicePerson } from "@/lib/integrations/devices";
import type { MicrosoftPosture, MsUser } from "@/lib/integrations/microsoft/collect";

/**
 * Microsoft 365 / Entra posture → checks. Pure. Leavers and unknown accounts
 * come from the shared roster engine (lib/checks.ts).
 */

export interface MicrosoftEvaluateOptions {
  now: Date;
  exceptions: ExceptionRow[];
  staleDays: number;
  people: DevicePerson[] | null;
}

export const msUserResource = (tenant: string, upn: string, label = upn) => ({ id: resourceKey(tenant, null, "user", upn), label, region: null });
export const msAppResource = (tenant: string, clientId: string, label: string) => ({ id: resourceKey(tenant, null, "app", clientId), label, region: null });

export function evaluateMicrosoft(p: MicrosoftPosture, opts: MicrosoftEvaluateOptions): CheckOutcome[] {
  const ex = exceptionMap(opts.exceptions, opts.now);
  const V = (key: string) => new Verdict(key, ex);
  const t = p.tenant;
  const out: CheckOutcome[] = [];
  const users = p.users.ok ? p.users.data : [];
  const members = users.filter((u) => u.enabled && !u.guest);
  const truncated = "more accounts than one scan reads";

  // --------------------------------------------------------------- enforced
  {
    const v = V("microsoft.mfa_enforced");
    const sd = p.securityDefaults.ok ? p.securityDefaults.data : null;
    const ca = p.conditionalAccess.ok ? p.conditionalAccess.data : null;
    const enforcing = (ca ?? []).filter((x) => x.state === "enabled" && x.mfaForAll);
    const reportOnly = (ca ?? []).filter((x) => x.state === "enabledForReportingButNotEnforced" && x.mfaForAll);
    let pass: string | null = null;
    if (sd) pass = "Security Defaults are on: everyone is asked for MFA.";
    else if (enforcing.length) {
      const ex = enforcing[0].excludedUsers;
      pass = `Conditional Access policy “${enforcing[0].name}” requires MFA for all users on all apps${ex ? ` (${ex} excluded — keep that to break-glass accounts)` : ""}.`;
    }
    if (!pass) {
      if (sd === null && !p.securityDefaults.ok) v.gap(`security defaults: ${p.securityDefaults.message}`);
      if (ca === null && !p.conditionalAccess.ok) v.gap(`Conditional Access: ${p.conditionalAccess.message}`);
      // Both read, neither enforces: a real failure.
      if (sd === false && ca !== null) {
        v.flag({
          id: resourceKey(t, null, "tenant", t),
          label: reportOnly.length ? `“${reportOnly[0].name}” is in report-only mode — nothing is enforced` : "Security Defaults off and no Conditional Access policy requires MFA for everyone",
          region: null,
        });
      }
    }
    out.push(pass ? { key: "microsoft.mfa_enforced", result: "pass", detail: pass, resources: [], failingCount: 0, accepted: [] } : v.settle("", () => "Nothing requires MFA for everyone: Security Defaults are off and no Conditional Access policy covers all users and apps."));
  }
  {
    const v = V("microsoft.mfa_registered");
    v.read(p.users, "accounts");
    if (p.usersTruncated) v.gap(truncated);
    const reg = v.read(p.registration, "MFA registration");
    if (reg) {
      const byUpn = new Map(reg.map((r) => [r.upn, r]));
      for (const u of members) {
        const r = byUpn.get(u.upn);
        if (!r) v.gap(`no registration record for ${u.upn}`);
        else if (!r.mfaRegistered) v.flag(msUserResource(t, u.upn, `${u.upn}${u.name ? ` (${u.name})` : ""}`));
      }
    }
    out.push(v.settle(`All ${members.length} enabled member accounts have registered for MFA.`, (n) => `${n} of ${members.length} enabled accounts haven't registered for MFA.`));
  }

  // ----------------------------------------------------------------- admins
  {
    const v = V("microsoft.admins_mfa");
    const roles = v.read(p.roles, "admin roles");
    const reg = v.read(p.registration, "MFA registration");
    if (roles && reg) {
      const byUpn = new Map(reg.map((r) => [r.upn, r]));
      const admins = new Map<string, string[]>();
      for (const m of roles) if (m.kind === "user") admins.set(m.member, [...(admins.get(m.member) ?? []), m.role]);
      for (const [upn, rs] of admins) {
        const r = byUpn.get(upn);
        if (!r) v.gap(`no registration record for ${upn}`);
        else if (!r.mfaRegistered) v.flag(msUserResource(t, upn, `${upn} (${listNames(rs, 2)})`));
      }
      if (roles.some((m) => m.kind === "group")) v.gap("an admin role is assigned to a group, whose members aren't expanded");
      out.push(v.settle(`All ${admins.size} administrators have registered for MFA.`, (n) => `${n} ${n === 1 ? "administrator hasn't" : "administrators haven't"} registered for MFA.`));
    } else {
      out.push(v.settle("", () => ""));
    }
  }
  {
    const v = V("microsoft.global_admins");
    const roles = v.read(p.roles, "admin roles");
    const globals = [...new Set((roles ?? []).filter((m) => m.global).map((m) => m.member))];
    if (roles && globals.length > 4) v.flag({ id: resourceKey(t, null, "role", "global-admin"), label: `${globals.length} Global Administrators: ${listNames(globals)}`, region: null });
    out.push(v.settle(`${globals.length} Global ${globals.length === 1 ? "Administrator" : "Administrators"} — within Microsoft's guidance.`, () => `${globals.length} Global Administrators — Microsoft recommends fewer than five.`));
  }

  // ----------------------------------------------------------------- people
  {
    const v = V("microsoft.guests");
    v.read(p.users, "accounts");
    for (const u of users.filter((x) => x.guest && x.enabled)) v.flag(msUserResource(t, u.upn, guestLabel(u)));
    out.push(v.settle("No guest accounts.", (n) => `${n} guest ${n === 1 ? "account" : "accounts"} from other organisations can sign in.`));
  }

  // ------------------------------------------------------------------- apps
  {
    const v = V("microsoft.app_consents");
    const consents = v.read(p.consents, "app consents") ?? [];
    for (const c of consents) {
      const what = [...new Set(c.scopes.filter((s) => /Mail\.|Files\.|Sites\.|ReadWrite\.All/.test(s)))].slice(0, 4).join(", ");
      v.flag(msAppResource(t, c.clientId, `${c.app} — ${what}${c.tenantWide ? " (whole organisation)" : ""}`));
    }
    out.push(v.settle("No third-party app can read everyone's mail or files, or every one that can is approved.", (n) => `${n} ${n === 1 ? "app has" : "apps have"} consent to read mail or files and ${n === 1 ? "isn't" : "aren't"} approved yet.`));
  }

  // ---------------------------------------------------------------- devices
  if (p.devices !== null) out.push(...evaluateDevices("microsoft", p.devices, { now: opts.now, exceptions: opts.exceptions, staleDays: opts.staleDays, people: opts.people }, p.devicesTruncated));

  return out;
}

function guestLabel(u: MsUser): string {
  // Guest UPNs look like jane_partner.com#EXT#@acme.onmicrosoft.com — show the real address.
  return u.mail ?? u.upn.replace(/#ext#.*$/i, "").replace(/_([^_]+)$/, "@$1");
}
