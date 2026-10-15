import { daysSince, exceptionMap, listNames, resourceKey, Verdict, type CheckOutcome, type ExceptionRow, type Section } from "@/lib/checks-core";
import type { GcpPosture, GcpProject } from "@/lib/integrations/gcp/collect";

export interface GcpEvaluateOptions {
  now: Date;
  exceptions: ExceptionRow[];
  keyMaxDays: number;
}

export const gcpResource = (project: string, type: string, id: string, label?: string) => ({ id: resourceKey(project, null, type, id), label: label ?? `${id} (${project})`, region: null });

const PUBLIC = new Set(["allUsers", "allAuthenticatedUsers"]);
const ADMIN_ROLES = new Set(["roles/owner", "roles/editor"]);

export function evaluateGcp(p: GcpPosture, opts: GcpEvaluateOptions): CheckOutcome[] {
  const ex = exceptionMap(opts.exceptions, opts.now);
  const out: CheckOutcome[] = [];
  /** One check across every project, reading one section per project. */
  function across<T>(key: string, pick: (pr: GcpProject) => Section<T>, label: string, body: (v: Verdict, pr: GcpProject, data: T) => void, pass: string, fail: (n: number) => string) {
    const v = new Verdict(key, ex);
    if (p.projectsTruncated) v.gap("more projects than one scan reads");
    for (const pr of p.projects) {
      const data = v.read(pick(pr), `${label} in ${pr.id}`);
      if (data !== null) body(v, pr, data);
    }
    out.push(v.settle(pass, fail));
  }
  const n = p.projects.length;
  const where = n === 1 ? p.projects[0].id : `${n} projects`;

  across(
    "gcp.over_privilege",
    (pr) => pr.iam,
    "IAM",
    (v, pr, b) => {
      const owners = [...new Set(b.filter((x) => x.role === "roles/owner").flatMap((x) => x.members))];
      if (owners.length > 3) v.flag(gcpResource(pr.id, "project", pr.id, `${pr.id}: ${owners.length} owners (${listNames(owners.map((m) => m.replace(/^\w+:/, "")), 3)})`));
    },
    `Three or fewer owners in ${where}.`,
    (k) => `${k} ${k === 1 ? "project has" : "projects have"} more than three owners.`,
  );
  across(
    "gcp.public_iam",
    (pr) => pr.iam,
    "IAM",
    (v, pr, b) => {
      for (const x of b) for (const m of x.members) if (PUBLIC.has(m)) v.flag(gcpResource(pr.id, "binding", `${x.role}:${m}`, `${pr.id}: ${x.role} granted to ${m}`));
    },
    `Nothing in ${where} is granted to allUsers or allAuthenticatedUsers.`,
    (k) => `${k} ${k === 1 ? "role is" : "roles are"} granted to everyone on the internet.`,
  );
  across(
    "gcp.personal_accounts",
    (pr) => pr.iam,
    "IAM",
    (v, pr, b) => {
      const personal = new Set(b.flatMap((x) => x.members).filter((m) => /^user:.+@(gmail|googlemail)\.com$/i.test(m)));
      for (const m of personal) v.flag(gcpResource(pr.id, "member", m, `${m.replace(/^user:/, "")} (${pr.id})`));
    },
    `No personal Gmail accounts in ${where}.`,
    (k) => `${k} personal Gmail ${k === 1 ? "account has" : "accounts have"} access.`,
  );
  across(
    "gcp.sa_owners",
    (pr) => pr.iam,
    "IAM",
    (v, pr, b) => {
      for (const x of b.filter((r) => ADMIN_ROLES.has(r.role))) for (const m of x.members.filter((s) => s.startsWith("serviceAccount:"))) v.flag(gcpResource(pr.id, "sa-role", `${m}:${x.role}`, `${m.replace(/^serviceAccount:/, "")} is ${x.role.replace("roles/", "")} on ${pr.id}`));
    },
    `No service account holds Owner or Editor in ${where}.`,
    (k) => `${k} service-account ${k === 1 ? "grant is" : "grants are"} Owner or Editor.`,
  );
  across(
    "gcp.sa_key_age",
    (pr) => pr.keys,
    "service-account keys",
    (v, pr, keys) => {
      for (const k of keys) {
        const age = daysSince(k.created, opts.now);
        if (age > opts.keyMaxDays) v.flag(gcpResource(pr.id, "sa-key", k.keyId, `${k.serviceAccount} key ${k.keyId.slice(0, 8)}… — ${Number.isFinite(age) ? `${Math.floor(age)} days old` : "age unknown"}`));
      }
    },
    `No user-managed service-account key in ${where} is older than ${opts.keyMaxDays} days.`,
    (k) => `${k} service-account ${k === 1 ? "key is" : "keys are"} older than ${opts.keyMaxDays} days.`,
  );
  across(
    "gcp.public_buckets",
    (pr) => pr.buckets,
    "storage buckets",
    (v, pr, buckets) => {
      for (const b of buckets) {
        if (b.publicRoles === null) v.gap(`IAM of bucket ${b.name} not readable`);
        else if (b.publicRoles.length) v.flag(gcpResource(pr.id, "bucket", b.name, `gs://${b.name} — ${b.publicRoles.join(", ")} for everyone`));
      }
    },
    `No bucket in ${where} is public.`,
    (k) => `${k} ${k === 1 ? "bucket is" : "buckets are"} readable by anyone.`,
  );
  across(
    "gcp.open_admin_ports",
    (pr) => pr.firewalls,
    "firewall rules",
    (v, pr, rules) => {
      for (const r of rules) if (r.openAdminPorts.length) v.flag(gcpResource(pr.id, "firewall", r.name, `${r.name} (${pr.id}/${r.network}) — ${r.openAdminPorts.includes("all") ? "every port" : `port ${r.openAdminPorts.join(", ")}`} open to the internet`));
    },
    `No firewall rule in ${where} opens SSH or RDP to the internet.`,
    (k) => `${k} firewall ${k === 1 ? "rule opens" : "rules open"} SSH, RDP or every port to the internet.`,
  );
  across(
    "gcp.sql_public",
    (pr) => pr.sql,
    "Cloud SQL",
    (v, pr, dbs) => {
      for (const d of dbs) {
        const why = [d.publicIp && d.openToWorld ? "public IP open to 0.0.0.0/0" : null, d.publicIp && !d.sslRequired ? "SSL not required" : null].filter(Boolean);
        if (why.length) v.flag(gcpResource(pr.id, "sql", d.name, `${d.name} (${pr.id}) — ${why.join(", ")}`));
      }
    },
    `No Cloud SQL instance in ${where} is open to the internet.`,
    (k) => `${k} Cloud SQL ${k === 1 ? "instance is" : "instances are"} reachable from the internet or allow unencrypted connections.`,
  );
  across(
    "gcp.sql_backups",
    (pr) => pr.sql,
    "Cloud SQL",
    (v, pr, dbs) => {
      for (const d of dbs) if (!d.backups) v.flag(gcpResource(pr.id, "sql", d.name, `${d.name} (${pr.id})`));
    },
    `Every Cloud SQL instance in ${where} has automated backups.`,
    (k) => `${k} Cloud SQL ${k === 1 ? "instance has" : "instances have"} no automated backups.`,
  );
  return out;
}
