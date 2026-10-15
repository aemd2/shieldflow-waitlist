import { GcpError, getAccessToken, parseServiceAccount } from "@/lib/gcp";
import { ok, type Section } from "@/lib/checks-core";

/**
 * Read Google Cloud with the customer's read-only service account (Viewer +
 * Security Reviewer): IAM on every project it can see, service-account keys,
 * storage buckets, firewalls and Cloud SQL. An API that isn't enabled in a
 * project means the project doesn't use that service — nothing to check, not
 * "can't tell". A permission it lacks is "can't tell".
 */

const MAX_PROJECTS = 20;

export interface GcpBinding {
  role: string;
  members: string[];
}

export interface GcpKey {
  serviceAccount: string;
  keyId: string;
  created: string | null;
}

export interface GcpBucket {
  name: string;
  /** allUsers / allAuthenticatedUsers roles on the bucket; null = IAM unreadable. */
  publicRoles: string[] | null;
  publicAccessPrevention: boolean;
}

export interface GcpFirewall {
  name: string;
  network: string;
  /** Ports open to 0.0.0.0/0 that matter ("22", "3389", "all"). */
  openAdminPorts: string[];
}

export interface GcpSql {
  name: string;
  publicIp: boolean;
  /** 0.0.0.0/0 in authorised networks. */
  openToWorld: boolean;
  sslRequired: boolean;
  backups: boolean;
}

export interface GcpProject {
  id: string;
  iam: Section<GcpBinding[]>;
  keys: Section<GcpKey[]>;
  buckets: Section<GcpBucket[]>;
  firewalls: Section<GcpFirewall[]>;
  sql: Section<GcpSql[]>;
}

export interface GcpPosture {
  scannedAt: string;
  durationMs: number;
  /** The key's own project first, then any other the account can see. */
  projects: GcpProject[];
  projectsTruncated: boolean;
  serviceAccount: string;
}

class Http extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`HTTP ${status}`);
  }
}

async function g<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) }).catch(() => {
    throw new GcpError("unavailable", "Couldn't reach Google Cloud. Please try again.");
  });
  if (res.status === 401) throw new GcpError("auth", "Google rejected the service account — check it's enabled and the key isn't deleted, then reconnect.");
  if (!res.ok) throw new Http(res.status, await res.text().catch(() => ""));
  return (await res.json()) as T;
}

/** A disabled API: the project doesn't use this service. */
const notUsed = (e: unknown) => e instanceof Http && (e.status === 403 || e.status === 400) && /SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(e.body);

async function section<T>(what: string, permission: string, fn: () => Promise<T>, empty: T): Promise<Section<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof GcpError) throw e;
    if (notUsed(e)) return ok(empty);
    if (e instanceof Http && e.status === 403) return { ok: false, reason: "denied", action: permission, message: `the service account needs ${permission} to read ${what}` };
    return { ok: false, reason: "error", action: permission, message: `${what} couldn't be read` };
  }
}

const PUBLIC = new Set(["allUsers", "allAuthenticatedUsers"]);

function adminPorts(rule: { allowed?: { IPProtocol?: string; ports?: string[] }[] }): string[] {
  const out = new Set<string>();
  for (const a of rule.allowed ?? []) {
    const proto = (a.IPProtocol ?? "").toLowerCase();
    if (proto === "all") out.add("all");
    if (proto !== "tcp" && proto !== "all") continue;
    if (!a.ports?.length) out.add("all");
    for (const p of a.ports ?? []) {
      const [lo, hi] = p.split("-").map(Number);
      for (const port of [22, 3389]) if (port >= lo && port <= (hi || lo)) out.add(String(port));
    }
  }
  return [...out];
}

async function readProject(token: string, id: string): Promise<GcpProject> {
  const [iam, keys, buckets, firewalls, sql] = await Promise.all([
    section(
      `the IAM policy of ${id}`,
      "resourcemanager.projects.getIamPolicy (Viewer)",
      async () => ((await g<{ bindings?: GcpBinding[] }>(token, `https://cloudresourcemanager.googleapis.com/v1/projects/${id}:getIamPolicy`, { method: "POST", body: "{}" })).bindings ?? []).map((b) => ({ role: b.role, members: b.members ?? [] })),
      [] as GcpBinding[],
    ),
    section(
      `service-account keys in ${id}`,
      "iam.serviceAccountKeys.list (Security Reviewer)",
      async () => {
        const sas = (await g<{ accounts?: { email: string }[] }>(token, `https://iam.googleapis.com/v1/projects/${id}/serviceAccounts?pageSize=100`)).accounts ?? [];
        const out: GcpKey[] = [];
        for (const sa of sas.slice(0, 100)) {
          const ks = (await g<{ keys?: { name: string; validAfterTime?: string }[] }>(token, `https://iam.googleapis.com/v1/projects/${id}/serviceAccounts/${encodeURIComponent(sa.email)}/keys?keyTypes=USER_MANAGED`)).keys ?? [];
          for (const k of ks) out.push({ serviceAccount: sa.email, keyId: k.name.split("/").pop() ?? k.name, created: k.validAfterTime ?? null });
        }
        return out;
      },
      [] as GcpKey[],
    ),
    section(
      `storage buckets in ${id}`,
      "storage.buckets.list / getIamPolicy (Viewer)",
      async () => {
        const items = (await g<{ items?: { name: string; iamConfiguration?: { publicAccessPrevention?: string } }[] }>(token, `https://storage.googleapis.com/storage/v1/b?project=${id}&maxResults=200`)).items ?? [];
        const out: GcpBucket[] = [];
        for (const b of items) {
          const prevention = b.iamConfiguration?.publicAccessPrevention === "enforced";
          let publicRoles: string[] | null = [];
          try {
            const pol = await g<{ bindings?: GcpBinding[] }>(token, `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(b.name)}/iam`);
            publicRoles = (pol.bindings ?? []).filter((x) => (x.members ?? []).some((m) => PUBLIC.has(m))).map((x) => x.role);
          } catch (e) {
            if (e instanceof GcpError) throw e;
            publicRoles = null;
          }
          out.push({ name: b.name, publicRoles: prevention ? [] : publicRoles, publicAccessPrevention: prevention });
        }
        return out;
      },
      [] as GcpBucket[],
    ),
    section(
      `firewall rules in ${id}`,
      "compute.firewalls.list (Viewer)",
      async () =>
        ((await g<{ items?: { name: string; network?: string; direction?: string; disabled?: boolean; sourceRanges?: string[]; allowed?: { IPProtocol?: string; ports?: string[] }[] }[] }>(token, `https://compute.googleapis.com/compute/v1/projects/${id}/global/firewalls?maxResults=500`)).items ?? [])
          .filter((r) => (r.direction ?? "INGRESS") === "INGRESS" && !r.disabled && (r.sourceRanges ?? []).some((s) => s === "0.0.0.0/0" || s === "::/0"))
          .map((r) => ({ name: r.name, network: (r.network ?? "").split("/").pop() ?? "", openAdminPorts: adminPorts(r) })),
      [] as GcpFirewall[],
    ),
    section(
      `Cloud SQL instances in ${id}`,
      "cloudsql.instances.list (Viewer)",
      async () =>
        ((await g<{ items?: { name: string; settings?: { ipConfiguration?: { ipv4Enabled?: boolean; requireSsl?: boolean; sslMode?: string; authorizedNetworks?: { value?: string }[] }; backupConfiguration?: { enabled?: boolean } } }[] }>(token, `https://sqladmin.googleapis.com/v1/projects/${id}/instances`)).items ?? []).map((i) => {
          const ip = i.settings?.ipConfiguration;
          return {
            name: i.name,
            publicIp: Boolean(ip?.ipv4Enabled),
            openToWorld: (ip?.authorizedNetworks ?? []).some((n) => n.value === "0.0.0.0/0"),
            sslRequired: Boolean(ip?.requireSsl) || ip?.sslMode === "ENCRYPTED_ONLY" || ip?.sslMode === "TRUSTED_CLIENT_CERTIFICATE_REQUIRED",
            backups: Boolean(i.settings?.backupConfiguration?.enabled),
          };
        }),
      [] as GcpSql[],
    ),
  ]);
  return { id, iam, keys, buckets, firewalls, sql };
}

export async function collectGcp(keyJson: string): Promise<GcpPosture> {
  const started = Date.now();
  const sa = parseServiceAccount(keyJson);
  const token = await getAccessToken(sa);
  let ids = [sa.project_id];
  let truncated = false;
  try {
    const list = (await g<{ projects?: { projectId: string; lifecycleState?: string }[] }>(token, "https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE&pageSize=100")).projects ?? [];
    const others = list.map((p) => p.projectId).filter((p) => p !== sa.project_id);
    ids = [sa.project_id, ...others].slice(0, MAX_PROJECTS);
    truncated = others.length + 1 > MAX_PROJECTS;
  } catch (e) {
    if (e instanceof GcpError) throw e;
    // Listing projects needs more than the key's own project: scan just that one.
  }
  const projects: GcpProject[] = [];
  for (const id of ids) projects.push(await readProject(token, id));
  return { scannedAt: new Date(started).toISOString(), durationMs: Date.now() - started, projects, projectsTruncated: truncated, serviceAccount: sa.client_email };
}
