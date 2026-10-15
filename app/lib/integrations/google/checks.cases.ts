/**
 * Branch cases for lib/integrations/google/evaluate.ts and the app-grant replay
 * in collect.ts. Run with:  npx tsx lib/integrations/google/checks.cases.ts
 * Every "must NOT pass" case is a partial read that must stay "can't tell".
 */
import { evaluateGoogle, userResource, appResource, type GoogleEvaluateOptions } from "@/lib/integrations/google/evaluate";
import { appsFrom } from "@/lib/integrations/google/collect";
import { riskyScopes } from "@/lib/integrations/google/catalog";
import { ok, type CheckOutcome } from "@/lib/checks-core";
import type { GApp, GooglePosture, GUser } from "@/lib/integrations/google/types";

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

const user = (email: string, over: Partial<GUser> = {}): GUser => ({
  email, aliases: [], name: null, enrolled2sv: true, enforced2sv: true, superAdmin: false, delegatedAdmin: false,
  suspended: false, archived: false, lastLogin: "2026-10-14T09:00:00Z", created: "2025-01-01T00:00:00Z", orgUnit: "/", ...over,
});
const posture = (over: Partial<GooglePosture> = {}): GooglePosture => ({
  domain: "acme.com",
  scannedAt: NOW.toISOString(),
  durationMs: 900,
  users: ok([user("sam@acme.com", { superAdmin: true }), user("dani@acme.com", { superAdmin: true }), user("amara@acme.com")]),
  truncated: false,
  apps: ok([]),
  appsWindowDays: 180,
  ...over,
});
const opts: GoogleEvaluateOptions = { now: NOW, exceptions: [], dormantDays: 90 };
const run = (p: GooglePosture, o: Partial<GoogleEvaluateOptions> = {}) => evaluateGoogle(p, { ...opts, ...o });

// ---------------------------------------------------------------- baseline
const clean = run(posture());
const gating = ["google.2sv_enforced", "google.2fa", "google.admins_2sv", "google.super_admins", "google.dormant"];
expect("clean workspace: every gating check passes", gating.filter((k) => get(clean, k).result !== "pass").join(",") || "all pass", "all pass");
expect("no risky apps passes", get(clean, "google.oauth_apps").result, "pass");

// ------------------------------------------------------------ 2SV enforced
const notEnforced = run(posture({ users: ok([user("sam@acme.com", { superAdmin: true }), user("amara@acme.com", { enforced2sv: false, orgUnit: "/Sales" })]) }));
expect("enrolled but not enforced fails enforcement", get(notEnforced, "google.2sv_enforced").result, "fail");
expect("…names the org unit", get(notEnforced, "google.2sv_enforced").detail.includes("/Sales") ? "yes" : "no", "yes");
expect("…while enrolment still passes", get(notEnforced, "google.2fa").result, "pass");
const truncated = run(posture({ truncated: true }));
expect("more accounts than read → enforcement must NOT pass", get(truncated, "google.2sv_enforced").result, "inconclusive");
expect("more accounts than read → enrolment must NOT pass", get(truncated, "google.2fa").result, "inconclusive");
const truncFail = run(posture({ truncated: true, users: ok([user("amara@acme.com", { enforced2sv: false })]) }));
expect("a real failure still fails despite truncation", get(truncFail, "google.2sv_enforced").result, "fail");
const suspendedOff = run(posture({ users: ok([user("sam@acme.com", { superAdmin: true }), user("old@acme.com", { suspended: true, enrolled2sv: false, enforced2sv: false })]) }));
expect("suspended accounts don't count", get(suspendedOff, "google.2sv_enforced").result, "pass");
const archivedOff = run(posture({ users: ok([user("sam@acme.com", { superAdmin: true }), user("gone@acme.com", { archived: true, enrolled2sv: false })]) }));
expect("archived accounts don't count", get(archivedOff, "google.2fa").result, "pass");
const excepted = run(posture({ users: ok([user("sam@acme.com", { superAdmin: true }), user("scanner@acme.com", { enforced2sv: false })]) }), {
  exceptions: [{ checkKey: "google.2sv_enforced", resourceId: userResource("acme.com", { email: "scanner@acme.com" }).id, reason: "printer mailbox, can't sign in", expiresAt: null }],
});
expect("a recorded exception accepts the account", get(excepted, "google.2sv_enforced").result, "pass");
const expired = run(posture({ users: ok([user("scanner@acme.com", { enforced2sv: false })]) }), {
  exceptions: [{ checkKey: "google.2sv_enforced", resourceId: userResource("acme.com", { email: "scanner@acme.com" }).id, reason: "x", expiresAt: "2026-01-01T00:00:00Z" }],
});
expect("an expired exception no longer counts", get(expired, "google.2sv_enforced").result, "fail");

// ---------------------------------------------------------------- admins
const adminNo2sv = run(posture({ users: ok([user("sam@acme.com", { superAdmin: true }), user("help@acme.com", { delegatedAdmin: true, enrolled2sv: false })]) }));
expect("a delegated admin without 2SV fails", get(adminNo2sv, "google.admins_2sv").result, "fail");
expect("…labelled admin", get(adminNo2sv, "google.admins_2sv").resources[0]?.label, "help@acme.com (admin)");
const fourSupers = run(posture({ users: ok(["a", "b", "c", "d"].map((n) => user(`${n}@acme.com`, { superAdmin: true }))) }));
expect("four super admins fails", get(fourSupers, "google.super_admins").result, "fail");
const fourOneSuspended = run(posture({ users: ok(["a", "b", "c"].map((n) => user(`${n}@acme.com`, { superAdmin: true })).concat(user("d@acme.com", { superAdmin: true, suspended: true }))) }));
expect("a suspended super admin doesn't count", get(fourOneSuspended, "google.super_admins").result, "pass");

// ---------------------------------------------------------------- dormant
const dormant = run(posture({ users: ok([
  user("sam@acme.com", { superAdmin: true }),
  user("idle@acme.com", { lastLogin: "2026-05-01T00:00:00Z" }),
  user("never@acme.com", { lastLogin: null, created: "2026-01-01T00:00:00Z" }),
  user("newbie@acme.com", { lastLogin: null, created: "2026-10-01T00:00:00Z" }),
]) }));
expect("idle 167 days and never-signed-in-old flagged", get(dormant, "google.dormant").failingCount, 2);
expect("a new joiner who hasn't signed in yet is not dormant", get(dormant, "google.dormant").resources.some((r) => r.label.startsWith("newbie")) ? "flagged" : "ok", "ok");
const longer = run(posture({ users: ok([user("idle@acme.com", { lastLogin: "2026-05-01T00:00:00Z" })]) }), { dormantDays: 180 });
expect("the window is the workspace's setting", get(longer, "google.dormant").result, "pass");

// ------------------------------------------------------------------- apps
expect("Gmail full access is risky", riskyScopes(["https://mail.google.com/"]).join(), "Gmail");
expect("all of Drive is risky", riskyScopes(["https://www.googleapis.com/auth/drive.readonly"]).join(), "all of Drive");
expect("drive.file (only its own files) is not", riskyScopes(["https://www.googleapis.com/auth/drive.file"]).length, 0);
expect("sign-in only is not", riskyScopes(["openid", "https://www.googleapis.com/auth/userinfo.email"]).length, 0);
const app = (name: string, scopes: string[], users = ["amara@acme.com"]): GApp => ({ clientId: `${name}.apps`, name, scopes, users, lastAuthorized: "2026-10-01T00:00:00Z" });
const apps = run(posture({ apps: ok([app("MailMerge Pro", ["https://mail.google.com/"]), app("Calendly", ["https://www.googleapis.com/auth/calendar"])]) }));
expect("an app reading Gmail is flagged", get(apps, "google.oauth_apps").result, "fail");
expect("…only that one", get(apps, "google.oauth_apps").failingCount, 1);
const approved = run(posture({ apps: ok([app("HubSpot", ["https://mail.google.com/"])]) }), {
  exceptions: [{ checkKey: "google.oauth_apps", resourceId: appResource("acme.com", "HubSpot.apps", "HubSpot").id, reason: "our CRM, DPA signed", expiresAt: null }],
});
expect("an approved app passes", get(approved, "google.oauth_apps").result, "pass");
const noScope = run(posture({ apps: null }));
expect("audit log not granted → app check not emitted", has(noScope, "google.oauth_apps"), "absent");
const appsTimeout = run(posture({ apps: { ok: false, reason: "timeout", action: "Reports", message: "more app grants than one scan reads" } }));
expect("app grants partly read → must NOT pass", get(appsTimeout, "google.oauth_apps").result, "inconclusive");

// appsFrom: authorise then revoke = gone; re-authorise after revoke = holding.
const ev = (time: string, user: string, name: "authorize" | "revoke", clientId = "x.apps") => ({ time, user, name, clientId, app: "X", scopes: ["https://mail.google.com/"] });
const replay = appsFrom([
  ev("2026-09-01T00:00:00Z", "a@acme.com", "authorize"),
  ev("2026-09-02T00:00:00Z", "a@acme.com", "revoke"),
  ev("2026-09-03T00:00:00Z", "b@acme.com", "authorize"),
  ev("2026-09-05T00:00:00Z", "c@acme.com", "revoke"),
  ev("2026-09-04T00:00:00Z", "c@acme.com", "authorize"),
]);
expect("revoked grants drop out; out-of-order events replay by time", replay[0]?.users.join(","), "b@acme.com");
const regrant = appsFrom([ev("2026-09-01T00:00:00Z", "a@acme.com", "authorize"), ev("2026-09-02T00:00:00Z", "a@acme.com", "revoke"), ev("2026-09-03T00:00:00Z", "a@acme.com", "authorize")]);
expect("re-granted after a revoke is holding", regrant[0]?.users.length, 1);

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
