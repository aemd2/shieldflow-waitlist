/**
 * Branch cases for lib/integrations/cloudflare/evaluate.ts.
 * Run with:  npx tsx lib/integrations/cloudflare/checks.cases.ts
 */
import { evaluateCloudflare, zoneResource } from "@/lib/integrations/cloudflare/evaluate";
import type { CloudflarePosture, CfZone, CfAccount } from "@/lib/integrations/cloudflare/collect";
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

const zone = (name: string, over: Partial<CfZone> = {}): CfZone => ({ id: name, name, ssl: "strict", minTls: "1.2", alwaysHttps: "on", hsts: true, dnssec: "active", plan: "Free", ...over });
const acct = (over: Partial<CfAccount> = {}): CfAccount => ({
  id: "a1", name: "Acme", enforceTwoFactor: false,
  members: ok([{ email: "sam@acme.com", name: "Sam", twoFactor: true, status: "accepted", roles: ["Super Administrator"] }]),
  ...over,
});
const posture = (over: Partial<CloudflarePosture> = {}): CloudflarePosture => ({
  scannedAt: NOW.toISOString(), durationMs: 500, zones: ok([zone("acme.com"), zone("acme.io")]), zonesTruncated: false, accounts: ok([acct()]), ...over,
});
const run = (p: CloudflarePosture, exceptions = [] as Parameters<typeof evaluateCloudflare>[1]["exceptions"]) => evaluateCloudflare(p, { now: NOW, exceptions });

const clean = run(posture());
expect("clean: all pass", ["cloudflare.tls", "cloudflare.hsts", "cloudflare.dnssec", "cloudflare.members_2fa"].filter((k) => get(clean, k).result !== "pass").join(",") || "all pass", "all pass");
const full = run(posture({ zones: ok([zone("acme.com", { ssl: "full" })]) }));
expect("SSL Full (not strict) fails", get(full, "cloudflare.tls").result, "fail");
expect("…and says why", get(full, "cloudflare.tls").resources[0]?.label.includes("isn't verified") ? "yes" : "no", "yes");
expect("TLS 1.0 allowed fails", get(run(posture({ zones: ok([zone("a.com", { minTls: "1.0" })]) })), "cloudflare.tls").result, "fail");
expect("plain HTTP allowed fails", get(run(posture({ zones: ok([zone("a.com", { alwaysHttps: "off" })]) })), "cloudflare.tls").result, "fail");
expect("a setting unreadable → must NOT pass", get(run(posture({ zones: ok([zone("a.com"), zone("b.com", { ssl: null })]) })), "cloudflare.tls").result, "inconclusive");
expect("more zones than read → must NOT pass", get(run(posture({ zonesTruncated: true })), "cloudflare.tls").result, "inconclusive");
expect("zones unreadable → must NOT pass", get(run(posture({ zones: denied("Zone: Read") })), "cloudflare.tls").result, "inconclusive");
expect("HSTS off fails", get(run(posture({ zones: ok([zone("a.com", { hsts: false })]) })), "cloudflare.hsts").result, "fail");
expect("HSTS unreadable → must NOT pass", get(run(posture({ zones: ok([zone("a.com", { hsts: null })]) })), "cloudflare.hsts").result, "inconclusive");
expect("DNSSEC off fails", get(run(posture({ zones: ok([zone("a.com", { dnssec: "disabled" })]) })), "cloudflare.dnssec").result, "fail");
expect("DNSSEC pending → must NOT pass", get(run(posture({ zones: ok([zone("a.com", { dnssec: "pending" })]) })), "cloudflare.dnssec").result, "inconclusive");
const exc = run(posture({ zones: ok([zone("legacy.com", { hsts: false })]) }), [{ checkKey: "cloudflare.hsts", resourceId: zoneResource({ name: "legacy.com" }).id, reason: "subdomains still on HTTP until Q1", expiresAt: null }]);
expect("an exception accepts the zone", get(exc, "cloudflare.hsts").result, "pass");

const no2fa = acct({ members: ok([{ email: "dev@agency.com", name: null, twoFactor: false, status: "accepted", roles: ["Administrator"] }]) });
expect("a member without 2FA fails", get(run(posture({ accounts: ok([no2fa]) })), "cloudflare.members_2fa").result, "fail");
expect("…unless the account enforces 2FA", get(run(posture({ accounts: ok([{ ...no2fa, enforceTwoFactor: true }]) })), "cloudflare.members_2fa").result, "pass");
expect("members unreadable → must NOT pass", get(run(posture({ accounts: ok([acct({ members: denied("Account Settings: Read") })]) })), "cloudflare.members_2fa").result, "inconclusive");
expect("accounts unreadable → must NOT pass", get(run(posture({ accounts: denied("Account Settings: Read") })), "cloudflare.members_2fa").result, "inconclusive");
expect("2FA status hidden → must NOT pass", get(run(posture({ accounts: ok([acct({ members: ok([{ email: "x@acme.com", name: null, twoFactor: null, status: "accepted", roles: [] }]) })]) })), "cloudflare.members_2fa").result, "inconclusive");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
