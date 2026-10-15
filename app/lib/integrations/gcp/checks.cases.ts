/**
 * Branch cases for lib/integrations/gcp/evaluate.ts.
 * Run with:  npx tsx lib/integrations/gcp/checks.cases.ts
 */
import { evaluateGcp, gcpResource } from "@/lib/integrations/gcp/evaluate";
import type { GcpPosture, GcpProject } from "@/lib/integrations/gcp/collect";
import { ok, denied, type CheckOutcome, type ExceptionRow } from "@/lib/checks-core";

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

const project = (id: string, over: Partial<GcpProject> = {}): GcpProject => ({
  id,
  iam: ok([{ role: "roles/owner", members: ["user:sam@acme.com"] }, { role: "roles/viewer", members: ["serviceAccount:shieldflow@acme.iam.gserviceaccount.com"] }]),
  keys: ok([{ serviceAccount: "ci@acme.iam.gserviceaccount.com", keyId: "abc123def456", created: "2026-09-01T00:00:00Z" }]),
  buckets: ok([{ name: "acme-uploads", publicRoles: [], publicAccessPrevention: true }]),
  firewalls: ok([{ name: "allow-https", network: "default", openAdminPorts: [] }]),
  sql: ok([{ name: "prod-db", publicIp: false, openToWorld: false, sslRequired: true, backups: true }]),
  ...over,
});
const posture = (projects: GcpProject[] = [project("acme-prod")], truncated = false): GcpPosture => ({ scannedAt: NOW.toISOString(), durationMs: 1, projects, projectsTruncated: truncated, serviceAccount: "shieldflow@acme.iam.gserviceaccount.com" });
const run = (p: GcpPosture, exceptions: ExceptionRow[] = []) => evaluateGcp(p, { now: NOW, exceptions, keyMaxDays: 90 });

const all = ["gcp.over_privilege", "gcp.public_iam", "gcp.personal_accounts", "gcp.sa_owners", "gcp.sa_key_age", "gcp.public_buckets", "gcp.open_admin_ports", "gcp.sql_public", "gcp.sql_backups"];
expect("clean project: all pass", all.filter((k) => get(run(posture()), k).result !== "pass").join(",") || "all pass", "all pass");

const owners = project("p", { iam: ok([{ role: "roles/owner", members: ["user:a@acme.com", "user:b@acme.com", "user:c@acme.com", "user:d@acme.com"] }]) });
expect("four owners fails", get(run(posture([owners])), "gcp.over_privilege").result, "fail");
expect("IAM unreadable → must NOT pass", get(run(posture([project("p", { iam: denied("getIamPolicy") })])), "gcp.over_privilege").result, "inconclusive");
expect("one of two projects unreadable → must NOT pass", get(run(posture([project("a"), project("b", { iam: denied("getIamPolicy") })])), "gcp.public_iam").result, "inconclusive");
expect("more projects than read → must NOT pass", get(run(posture([project("a")], true)), "gcp.public_iam").result, "inconclusive");
expect("allUsers binding fails", get(run(posture([project("p", { iam: ok([{ role: "roles/viewer", members: ["allUsers"] }]) })])), "gcp.public_iam").result, "fail");
expect("a personal gmail account is flagged", get(run(posture([project("p", { iam: ok([{ role: "roles/editor", members: ["user:sam.dev@gmail.com"] }]) })])), "gcp.personal_accounts").result, "fail");
expect("a service account with Editor fails", get(run(posture([project("p", { iam: ok([{ role: "roles/editor", members: ["serviceAccount:ci@p.iam.gserviceaccount.com"] }]) })])), "gcp.sa_owners").result, "fail");
expect("a key 200 days old fails", get(run(posture([project("p", { keys: ok([{ serviceAccount: "ci@p", keyId: "k1", created: "2026-03-01T00:00:00Z" }]) })])), "gcp.sa_key_age").result, "fail");
expect("keys unreadable → must NOT pass", get(run(posture([project("p", { keys: denied("iam.serviceAccountKeys.list") })])), "gcp.sa_key_age").result, "inconclusive");
expect("no service accounts/keys at all passes", get(run(posture([project("p", { keys: ok([]) })])), "gcp.sa_key_age").result, "pass");
expect("a public bucket fails", get(run(posture([project("p", { buckets: ok([{ name: "site", publicRoles: ["roles/storage.objectViewer"], publicAccessPrevention: false }]) })])), "gcp.public_buckets").result, "fail");
expect("a bucket whose IAM can't be read → must NOT pass", get(run(posture([project("p", { buckets: ok([{ name: "x", publicRoles: null, publicAccessPrevention: false }]) })])), "gcp.public_buckets").result, "inconclusive");
const site = run(posture([project("p", { buckets: ok([{ name: "www-acme", publicRoles: ["roles/storage.objectViewer"], publicAccessPrevention: false }]) })]), [
  { checkKey: "gcp.public_buckets", resourceId: gcpResource("p", "bucket", "www-acme").id, reason: "static marketing site, public by design", expiresAt: null },
]);
expect("a website bucket can be accepted with a reason", get(site, "gcp.public_buckets").result, "pass");
expect("SSH open to the internet fails", get(run(posture([project("p", { firewalls: ok([{ name: "default-allow-ssh", network: "default", openAdminPorts: ["22"] }]) })])), "gcp.open_admin_ports").result, "fail");
expect("public SQL open to 0.0.0.0/0 fails", get(run(posture([project("p", { sql: ok([{ name: "db", publicIp: true, openToWorld: true, sslRequired: true, backups: true }]) })])), "gcp.sql_public").result, "fail");
expect("public SQL without SSL fails", get(run(posture([project("p", { sql: ok([{ name: "db", publicIp: true, openToWorld: false, sslRequired: false, backups: true }]) })])), "gcp.sql_public").result, "fail");
expect("private SQL without SSL passes", get(run(posture([project("p", { sql: ok([{ name: "db", publicIp: false, openToWorld: false, sslRequired: false, backups: true }]) })])), "gcp.sql_public").result, "pass");
expect("SQL without backups fails", get(run(posture([project("p", { sql: ok([{ name: "db", publicIp: false, openToWorld: false, sslRequired: true, backups: false }]) })])), "gcp.sql_backups").result, "fail");
expect("Cloud SQL unreadable → must NOT pass", get(run(posture([project("p", { sql: denied("cloudsql.instances.list") })])), "gcp.sql_backups").result, "inconclusive");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
