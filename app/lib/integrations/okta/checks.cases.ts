/**
 * Branch cases for lib/integrations/okta/evaluate.ts.
 * Run with:  npx tsx lib/integrations/okta/checks.cases.ts
 */
import { evaluateOkta } from "@/lib/integrations/okta/evaluate";
import type { OktaPosture, OktaUserView } from "@/lib/integrations/okta/collect";
import { ok, denied, type CheckOutcome } from "@/lib/checks-core";

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

const u = (email: string, over: Partial<OktaUserView> = {}): OktaUserView => ({ id: email, email, name: null, status: "ACTIVE", lastLogin: "2026-10-14T00:00:00Z", created: "2025-01-01T00:00:00Z", factors: ["push"], roles: [], ...over });
const posture = (users: OktaUserView[] = [u("sam@acme.com", { roles: ["SUPER_ADMIN"], factors: ["push", "webauthn"] }), u("amara@acme.com")], over: Partial<OktaPosture> = {}): OktaPosture => ({
  host: "acme.okta.com", scannedAt: NOW.toISOString(), durationMs: 1, users: ok(users), usersTruncated: false, factorsIncomplete: false,
  admins: ok([{ userId: "sam@acme.com", roles: ["SUPER_ADMIN"] }]), passwordMinLength: ok(12),
  apps: { total: 3, federated: 3, passwordVaulted: 0, passwordVaultedNames: [], truncated: false }, ...over,
});
const run = (p: OktaPosture) => evaluateOkta(p, { now: NOW, exceptions: [], dormantDays: 90 });

const all = ["okta.mfa", "okta.mfa_strong", "okta.password_policy", "okta.admins_mfa", "okta.super_admins", "okta.dormant", "okta.sso_coverage"];
expect("clean org: all pass", all.filter((k) => get(run(posture()), k).result !== "pass").join(",") || "all pass", "all pass");
expect("a user with no factor fails MFA", get(run(posture([u("a@acme.com", { factors: [] })])), "okta.mfa").result, "fail");
expect("factors not read (rate limit) → must NOT pass", get(run(posture([u("a@acme.com"), u("b@acme.com", { factors: null })])), "okta.mfa").result, "inconclusive");
expect("…but a real failure still fails", get(run(posture([u("a@acme.com", { factors: [] }), u("b@acme.com", { factors: null })])), "okta.mfa").result, "fail");
expect("deactivated users don't count", get(run(posture([u("a@acme.com"), u("old@acme.com", { status: "DEPROVISIONED", factors: [] })])), "okta.mfa").result, "pass");
expect("a locked-out user still counts (access comes back)", get(run(posture([u("a@acme.com", { status: "LOCKED_OUT", factors: [] })])), "okta.mfa").result, "fail");
expect("more users than read → must NOT pass", get(run(posture(undefined, { usersTruncated: true })), "okta.mfa").result, "inconclusive");
expect("SMS-only is flagged as weak", get(run(posture([u("a@acme.com", { factors: ["sms"] })])), "okta.mfa_strong").result, "fail");
expect("SMS plus push is fine", get(run(posture([u("a@acme.com", { factors: ["sms", "push"] })])), "okta.mfa_strong").result, "pass");
expect("an admin with SMS only fails", get(run(posture([u("boss@acme.com", { roles: ["ORG_ADMIN"], factors: ["sms"] })], { admins: ok([{ userId: "boss@acme.com", roles: ["ORG_ADMIN"] }]) })), "okta.admins_mfa").result, "fail");
expect("admin roles unreadable → must NOT pass", get(run(posture(undefined, { admins: denied("okta.roles.read") })), "okta.admins_mfa").result, "inconclusive");
const four = ["a", "b", "c", "d"].map((x) => u(`${x}@acme.com`, { roles: ["SUPER_ADMIN"], factors: ["push"] }));
expect("four Super Administrators fails", get(run(posture(four, { admins: ok(four.map((x) => ({ userId: x.id, roles: ["SUPER_ADMIN"] }))) })), "okta.super_admins").result, "fail");
expect("password minimum 6 fails", get(run(posture(undefined, { passwordMinLength: ok(6) })), "okta.password_policy").result, "fail");
expect("password policy unreadable → must NOT pass", get(run(posture(undefined, { passwordMinLength: denied("okta.policies.read") })), "okta.password_policy").result, "inconclusive");
expect("no minimum set → must NOT pass", get(run(posture(undefined, { passwordMinLength: ok(null) })), "okta.password_policy").result, "inconclusive");
expect("idle 200 days is dormant", get(run(posture([u("a@acme.com", { lastLogin: "2026-03-01T00:00:00Z" })])), "okta.dormant").result, "fail");
expect("a new user who hasn't signed in isn't dormant", get(run(posture([u("new@acme.com", { lastLogin: null, created: "2026-10-01T00:00:00Z" })])), "okta.dormant").result, "pass");
expect("a password-vaulted app fails SSO coverage", get(run(posture(undefined, { apps: { total: 2, federated: 1, passwordVaulted: 1, passwordVaultedNames: ["Legacy CRM"], truncated: false } })), "okta.sso_coverage").result, "fail");
expect("apps unreadable → must NOT pass", get(run(posture(undefined, { apps: null })), "okta.sso_coverage").result, "inconclusive");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
