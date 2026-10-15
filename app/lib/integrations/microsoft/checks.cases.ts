/**
 * Branch cases for lib/integrations/microsoft/evaluate.ts and the shared device
 * checks (lib/integrations/devices.ts). Run with:
 *   npx tsx lib/integrations/microsoft/checks.cases.ts
 * Every "must NOT pass" case is a partial read that must stay "can't tell".
 */
import { evaluateMicrosoft, msUserResource, type MicrosoftEvaluateOptions } from "@/lib/integrations/microsoft/evaluate";
import type { MicrosoftPosture, MsUser } from "@/lib/integrations/microsoft/collect";
import { evaluateDevices, personResource, type Device } from "@/lib/integrations/devices";
import { ok, denied, type CheckOutcome, type SectionFailure } from "@/lib/checks-core";

const NOW = new Date("2026-10-15T12:00:00Z");
let failures = 0;
function expect(label: string, got: unknown, want: unknown) {
  const pass = got === want;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  -> ${String(got)}${pass ? "" : ` (wanted ${String(want)})`}`);
}
const get = (rs: CheckOutcome[], key: string) => {
  const r = rs.find((x) => x.key === key);
  if (!r) throw new Error(`no result for ${key}`);
  return r;
};
const has = (rs: CheckOutcome[], key: string) => (rs.some((x) => x.key === key) ? "present" : "absent");

const u = (upn: string, over: Partial<MsUser> = {}): MsUser => ({ id: upn, upn, mail: upn, name: null, enabled: true, guest: false, created: "2025-01-01T00:00:00Z", ...over });
const P1: SectionFailure = { ok: false, reason: "unavailable", action: "AuditLog.Read.All", message: "MFA registration needs Microsoft Entra ID P1" };
const posture = (over: Partial<MicrosoftPosture> = {}): MicrosoftPosture => ({
  tenant: "acme.onmicrosoft.com",
  scannedAt: NOW.toISOString(),
  durationMs: 800,
  users: ok([u("sam@acme.com"), u("amara@acme.com"), u("partner_ext.com#EXT#@acme.onmicrosoft.com", { guest: true, mail: "jo@partner.com" })]),
  usersTruncated: false,
  registration: ok([
    { upn: "sam@acme.com", mfaRegistered: true, methods: ["microsoftAuthenticatorPush"] },
    { upn: "amara@acme.com", mfaRegistered: true, methods: ["fido2"] },
  ]),
  securityDefaults: ok(true),
  conditionalAccess: ok([]),
  roles: ok([{ role: "Global Administrator", global: true, member: "sam@acme.com", kind: "user" }]),
  consents: ok([]),
  devices: null,
  devicesTruncated: false,
  ...over,
});
const opts: MicrosoftEvaluateOptions = { now: NOW, exceptions: [], staleDays: 14, people: null };
const run = (p: MicrosoftPosture, o: Partial<MicrosoftEvaluateOptions> = {}) => evaluateMicrosoft(p, { ...opts, ...o });

// ---------------------------------------------------------------- baseline
const clean = run(posture());
const gating = ["microsoft.mfa_enforced", "microsoft.mfa_registered", "microsoft.admins_mfa", "microsoft.global_admins"];
expect("clean tenant: every gating check passes", gating.filter((k) => get(clean, k).result !== "pass").join(",") || "all pass", "all pass");
expect("guests are listed (informational)", get(clean, "microsoft.guests").failingCount, 1);
expect("…with their real address", get(clean, "microsoft.guests").resources[0]?.label, "jo@partner.com");
expect("no Intune → no device checks", has(clean, "microsoft.device_encryption"), "absent");

// ---------------------------------------------------------- MFA enforced
const sdOffNoCa = run(posture({ securityDefaults: ok(false), conditionalAccess: ok([]) }));
expect("security defaults off, no CA → fails", get(sdOffNoCa, "microsoft.mfa_enforced").result, "fail");
const caGood = run(posture({ securityDefaults: ok(false), conditionalAccess: ok([{ name: "Require MFA", state: "enabled", mfaForAll: true, excludedUsers: 1 }]) }));
expect("a CA policy for all users and apps passes", get(caGood, "microsoft.mfa_enforced").result, "pass");
const reportOnly = run(posture({ securityDefaults: ok(false), conditionalAccess: ok([{ name: "Require MFA", state: "enabledForReportingButNotEnforced", mfaForAll: true, excludedUsers: 0 }]) }));
expect("report-only CA policy fails", get(reportOnly, "microsoft.mfa_enforced").result, "fail");
expect("…and says report-only", get(reportOnly, "microsoft.mfa_enforced").resources[0]?.label.includes("report-only") ? "yes" : "no", "yes");
const caUnread = run(posture({ securityDefaults: ok(false), conditionalAccess: denied("Policy.Read.All") }));
expect("SD off but CA unreadable → must NOT pass (or fail)", get(caUnread, "microsoft.mfa_enforced").result, "inconclusive");
const sdUnreadCaNone = run(posture({ securityDefaults: denied("Policy.Read.All"), conditionalAccess: ok([]) }));
expect("SD unreadable and no CA → must NOT pass", get(sdUnreadCaNone, "microsoft.mfa_enforced").result, "inconclusive");
const sdOnCaUnread = run(posture({ securityDefaults: ok(true), conditionalAccess: denied("Policy.Read.All") }));
expect("SD on is enough even if CA is unreadable", get(sdOnCaUnread, "microsoft.mfa_enforced").result, "pass");

// --------------------------------------------------------- MFA registered
const notReg = run(posture({ registration: ok([{ upn: "sam@acme.com", mfaRegistered: true, methods: [] }, { upn: "amara@acme.com", mfaRegistered: false, methods: [] }]) }));
expect("a member without MFA registered fails", get(notReg, "microsoft.mfa_registered").result, "fail");
const noP1 = run(posture({ registration: P1 }));
expect("no Entra P1 → must NOT pass", get(noP1, "microsoft.mfa_registered").result, "inconclusive");
expect("…and says P1", get(noP1, "microsoft.mfa_registered").detail.includes("P1") ? "yes" : "no", "yes");
const missingRecord = run(posture({ registration: ok([{ upn: "sam@acme.com", mfaRegistered: true, methods: [] }]) }));
expect("a member with no registration record → must NOT pass", get(missingRecord, "microsoft.mfa_registered").result, "inconclusive");
const truncated = run(posture({ usersTruncated: true }));
expect("more accounts than read → must NOT pass", get(truncated, "microsoft.mfa_registered").result, "inconclusive");
const blocked = run(posture({ users: ok([u("sam@acme.com"), u("old@acme.com", { enabled: false })]), registration: ok([{ upn: "sam@acme.com", mfaRegistered: true, methods: [] }]) }));
expect("blocked accounts don't count", get(blocked, "microsoft.mfa_registered").result, "pass");
const excepted = run(posture({ registration: ok([{ upn: "sam@acme.com", mfaRegistered: true, methods: [] }, { upn: "amara@acme.com", mfaRegistered: false, methods: [] }]) }), {
  exceptions: [{ checkKey: "microsoft.mfa_registered", resourceId: msUserResource("acme.onmicrosoft.com", "amara@acme.com").id, reason: "room mailbox, sign-in blocked by CA", expiresAt: null }],
});
expect("a recorded exception accepts the account", get(excepted, "microsoft.mfa_registered").result, "pass");

// ------------------------------------------------------------------ admins
const adminNoMfa = run(posture({
  roles: ok([{ role: "Global Administrator", global: true, member: "sam@acme.com", kind: "user" }, { role: "User Administrator", global: false, member: "amara@acme.com", kind: "user" }]),
  registration: ok([{ upn: "sam@acme.com", mfaRegistered: true, methods: [] }, { upn: "amara@acme.com", mfaRegistered: false, methods: [] }]),
}));
expect("an admin without MFA fails", get(adminNoMfa, "microsoft.admins_mfa").result, "fail");
expect("…named with the role", get(adminNoMfa, "microsoft.admins_mfa").resources[0]?.label, "amara@acme.com (User Administrator)");
const rolesDenied = run(posture({ roles: denied("RoleManagement.Read.Directory") }));
expect("roles unreadable → admins check must NOT pass", get(rolesDenied, "microsoft.admins_mfa").result, "inconclusive");
expect("roles unreadable → GA count must NOT pass", get(rolesDenied, "microsoft.global_admins").result, "inconclusive");
const groupRole = run(posture({ roles: ok([{ role: "Global Administrator", global: true, member: "sam@acme.com", kind: "user" }, { role: "Security Administrator", global: false, member: "secops", kind: "group" }]) }));
expect("a role held by a group (members unseen) → must NOT pass", get(groupRole, "microsoft.admins_mfa").result, "inconclusive");
const fiveGA = run(posture({ roles: ok(["a", "b", "c", "d", "e"].map((x) => ({ role: "Global Administrator", global: true, member: `${x}@acme.com`, kind: "user" as const }))), registration: ok(["a", "b", "c", "d", "e", "sam", "amara"].map((x) => ({ upn: `${x}@acme.com`, mfaRegistered: true, methods: [] }))) }));
expect("five Global Administrators fails", get(fiveGA, "microsoft.global_admins").result, "fail");

// ------------------------------------------------------------- app consents
const consents = run(posture({ consents: ok([{ app: "MailSync", clientId: "c1", tenantWide: true, scopes: ["Mail.Read", "offline_access"], microsoft: false }]) }));
expect("an app with Mail.Read is flagged", get(consents, "microsoft.app_consents").result, "fail");
expect("…as whole-organisation", get(consents, "microsoft.app_consents").resources[0]?.label.includes("whole organisation") ? "yes" : "no", "yes");
const consentsDenied = run(posture({ consents: denied("Directory.Read.All") }));
expect("consents unreadable → must NOT pass", get(consentsDenied, "microsoft.app_consents").result, "inconclusive");

// ----------------------------------------------------------------- devices
const dev = (name: string, over: Partial<Device> = {}): Device => ({ id: name, name, os: "macOS", osVersion: "15.1", encrypted: true, lastSeen: "2026-10-14T00:00:00Z", owner: `${name}@acme.com`, ownerName: null, corporate: true, ...over });
const people = [{ name: "Sam", email: "sam@acme.com", status: "active" }, { name: "Amara", email: "amara@acme.com", status: "active" }, { name: "Old", email: "old@acme.com", status: "offboarded" }];
const D = (devices: Device[], over: Partial<{ people: typeof people | null }> = {}, truncatedD = false) =>
  evaluateDevices("kandji", ok(devices), { now: NOW, exceptions: [], staleDays: 14, people: over.people === undefined ? people : over.people }, truncatedD);
const allGood = D([dev("sam"), dev("amara")]);
expect("every device encrypted, seen, covered: all pass", ["kandji.device_encryption", "kandji.device_checkin", "kandji.device_coverage", "kandji.device_leavers"].filter((k) => get(allGood, k).result !== "pass").join(",") || "all pass", "all pass");
expect("an unencrypted laptop fails", get(D([dev("sam", { encrypted: false }), dev("amara")]), "kandji.device_encryption").result, "fail");
expect("encryption not reported → must NOT pass", get(D([dev("sam", { encrypted: null }), dev("amara")]), "kandji.device_encryption").result, "inconclusive");
expect("encrypted but stale → must NOT pass", get(D([dev("sam", { lastSeen: "2026-08-01T00:00:00Z" }), dev("amara")]), "kandji.device_encryption").result, "inconclusive");
expect("stale device fails check-in", get(D([dev("sam", { lastSeen: "2026-08-01T00:00:00Z" }), dev("amara")]), "kandji.device_checkin").result, "fail");
expect("never checked in fails check-in", get(D([dev("sam", { lastSeen: null }), dev("amara")]), "kandji.device_checkin").result, "fail");
expect("someone without a device fails coverage", get(D([dev("sam")]), "kandji.device_coverage").resources[0]?.label, "Amara (amara@acme.com)");
expect("a username owner (no @) matches the email's local part", get(D([dev("sam"), dev("x", { owner: "amara" })]), "kandji.device_coverage").result, "pass");
expect("empty Personnel → coverage must NOT pass", get(D([dev("sam")], { people: [] }), "kandji.device_coverage").result, "inconclusive");
expect("leavers don't need a device", get(D([dev("sam"), dev("amara")]), "kandji.device_coverage").failingCount, 0);
expect("a leaver's laptop still checking in is flagged", get(D([dev("sam"), dev("amara"), dev("old")]), "kandji.device_leavers").result, "fail");
expect("more devices than read → must NOT pass", get(D([dev("sam"), dev("amara")], {}, true), "kandji.device_encryption").result, "inconclusive");
const coverageExcepted = evaluateDevices("kandji", ok([dev("sam")]), {
  now: NOW,
  staleDays: 14,
  people,
  exceptions: [{ checkKey: "kandji.device_coverage", resourceId: personResource("kandji", "amara@acme.com", "").id, reason: "contractor, own managed laptop", expiresAt: null }],
});
expect("a person can be accepted out of scope", get(coverageExcepted, "kandji.device_coverage").result, "pass");
const intune = run(posture({ devices: ok([dev("sam", { owner: "sam@acme.com", encrypted: false })]) }), { people });
expect("Intune devices run the same checks", get(intune, "microsoft.device_encryption").result, "fail");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
