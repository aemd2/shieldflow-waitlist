import { GitLabError } from "@/lib/gitlab";
import { ok, type Section } from "@/lib/checks-core";

/**
 * Read GitLab (gitlab.com or a self-managed server) with a read_api token:
 * projects, default-branch protection, merge-request approval rules, merged
 * MRs and who approved them, deploy keys, and groups' 2FA requirement.
 */

const MAX_PROJECTS = 300;
const MAX_DETAIL = 150;
const TICKET = /\b([A-Za-z][A-Za-z0-9]{1,9}-\d{1,6})\b/;

/** gitlab.com, or a self-managed server's public https address (no IPs, localhost or internal names). */
export function normalizeGitLabUrl(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return "https://gitlab.com";
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== "https:") return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || /^\d+(\.\d+)*$/.test(h)) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(h)) return null;
  return `https://${h}${u.port && u.port !== "443" ? `:${u.port}` : ""}`;
}

/** Who a token belongs to, on any GitLab server (connect-time check). */
export async function gitlabUser(base: string, token: string): Promise<string> {
  const res = await fetch(`${base}/api/v4/user`, { headers: { "PRIVATE-TOKEN": token, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000) }).catch(() => {
    throw new GitLabError("unavailable", "Couldn't reach that GitLab server.");
  });
  if (res.status === 401) throw new GitLabError("auth", "GitLab rejected this token. Check it and try again.");
  if (!res.ok) throw new GitLabError("unavailable", `That GitLab server answered HTTP ${res.status}.`);
  const j = (await res.json()) as { username?: string };
  if (!j.username) throw new GitLabError("unavailable", "That doesn't look like a GitLab server.");
  return j.username;
}

export interface GlProtection {
  /** Nobody can push straight to the branch: changes go through a merge request. */
  pushRestricted: boolean;
  forcePushAllowed: boolean;
}

export interface GlProject {
  id: number;
  path: string;
  visibility: string;
  archived: boolean;
  defaultBranch: string | null;
  topics: string[];
  /** null = not read; false = branch not protected. */
  protection: GlProtection | false | null;
  /** Approvals required before merge (approval rules), null = not read. */
  approvalsRequired: number | null;
  authorCanApprove: boolean | null;
  writeDeployKeys: string[] | null;
}

export interface GlMerge {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  mergedBy: string | null;
  mergedAt: string;
  approvers: string[];
  independentApproval: boolean;
  ticket: string | null;
}

export interface GlGroup {
  path: string;
  require2fa: boolean;
}

export interface GitLabPosture {
  base: string;
  login: string;
  scannedAt: string;
  durationMs: number;
  projects: Section<GlProject[]>;
  projectsTruncated: boolean;
  projectsUnread: string[];
  merges: GlMerge[];
  mergesUnread: string[];
  groups: Section<GlGroup[]>;
}

class Http extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

export async function collectGitLab(baseUrl: string, token: string, since: Date, budgetMs = 45_000): Promise<GitLabPosture> {
  const started = Date.now();
  const base = normalizeGitLabUrl(baseUrl);
  if (!base) throw new GitLabError("auth", "That isn't a GitLab address we can reach — use https and a public hostname.");
  const api = `${base}/api/v4`;
  const left = () => budgetMs - (Date.now() - started);

  const get = async <T,>(path: string): Promise<T> => {
    const res = await fetch(`${api}${path}`, { headers: { "PRIVATE-TOKEN": token, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(20_000) }).catch(() => {
      throw new GitLabError("unavailable", "Couldn't reach GitLab. Please try again.");
    });
    if (res.status === 401) throw new GitLabError("auth", "GitLab rejected the token — it may have expired. Create a new read_api token and reconnect.");
    if (!res.ok) throw new Http(res.status);
    return (await res.json()) as T;
  };

  const me = await get<{ username: string }>("/user");

  type RawProject = { id: number; path_with_namespace: string; visibility: string; archived: boolean; default_branch: string | null; topics?: string[] };
  const raw: RawProject[] = [];
  let projectsTruncated = false;
  for (let page = 1; page <= MAX_PROJECTS / 100; page++) {
    const batch = await get<RawProject[]>(`/projects?membership=true&archived=false&per_page=100&page=${page}&order_by=last_activity_at`);
    raw.push(...batch);
    if (batch.length < 100) break;
    if (page === MAX_PROJECTS / 100) projectsTruncated = true;
  }

  const projects: GlProject[] = raw.map((r) => ({
    id: r.id,
    path: r.path_with_namespace,
    visibility: r.visibility,
    archived: Boolean(r.archived),
    defaultBranch: r.default_branch,
    topics: r.topics ?? [],
    protection: null,
    approvalsRequired: null,
    authorCanApprove: null,
    writeDeployKeys: null,
  }));
  const active = projects.filter((p) => !p.archived && p.defaultBranch);
  if (active.length > MAX_DETAIL) projectsTruncated = true;
  const projectsUnread: string[] = [];
  const merges: GlMerge[] = [];
  const mergesUnread: string[] = [];

  let i = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (i < Math.min(active.length, MAX_DETAIL)) {
        const p = active[i++];
        if (left() <= 0) {
          projectsUnread.push(p.path);
          mergesUnread.push(p.path);
          continue;
        }
        try {
          const pb = await get<{ push_access_levels?: { access_level: number }[]; allow_force_push?: boolean }>(`/projects/${p.id}/protected_branches/${encodeURIComponent(p.defaultBranch!)}`);
          p.protection = { pushRestricted: (pb.push_access_levels ?? []).every((l) => l.access_level === 0), forcePushAllowed: Boolean(pb.allow_force_push) };
        } catch (e) {
          if (e instanceof GitLabError) throw e;
          if (e instanceof Http && e.status === 404) p.protection = false;
          else projectsUnread.push(p.path);
        }
        try {
          const [cfg, rules] = await Promise.all([
            get<{ merge_requests_author_approval?: boolean }>(`/projects/${p.id}/approvals`),
            get<{ approvals_required?: number; rule_type?: string }[]>(`/projects/${p.id}/approval_rules`).catch((e) => {
              // Approval rules are a paid-tier feature: on Free nothing can be required.
              if (e instanceof Http && (e.status === 403 || e.status === 404)) return [];
              throw e;
            }),
          ]);
          p.approvalsRequired = Math.max(0, ...rules.map((r) => r.approvals_required ?? 0));
          p.authorCanApprove = Boolean(cfg.merge_requests_author_approval);
        } catch (e) {
          if (e instanceof GitLabError) throw e;
        }
        try {
          p.writeDeployKeys = (await get<{ title?: string; can_push?: boolean }[]>(`/projects/${p.id}/deploy_keys`)).filter((k) => k.can_push).map((k) => k.title ?? "deploy key");
        } catch (e) {
          if (e instanceof GitLabError) throw e;
        }
        try {
          const mrs = await get<{ iid: number; title: string; web_url: string; author?: { username?: string }; merged_by?: { username?: string } | null; merge_user?: { username?: string } | null; merged_at?: string; source_branch?: string; target_branch?: string }[]>(
            `/projects/${p.id}/merge_requests?state=merged&target_branch=${encodeURIComponent(p.defaultBranch!)}&updated_after=${encodeURIComponent(since.toISOString())}&per_page=100`,
          );
          for (const mr of mrs) {
            if (!mr.merged_at || Date.parse(mr.merged_at) < since.getTime()) continue;
            const author = mr.author?.username ?? null;
            let approvers: string[] = [];
            try {
              const a = await get<{ approved_by?: { user?: { username?: string } }[] }>(`/projects/${p.id}/merge_requests/${mr.iid}/approvals`);
              approvers = (a.approved_by ?? []).map((x) => x.user?.username ?? "").filter((x) => x && x !== author);
            } catch (e) {
              if (e instanceof GitLabError) throw e;
              mergesUnread.push(`${p.path}!${mr.iid}`);
              continue;
            }
            merges.push({
              repo: p.path,
              number: mr.iid,
              title: mr.title,
              url: mr.web_url,
              author,
              mergedBy: mr.merge_user?.username ?? mr.merged_by?.username ?? null,
              mergedAt: mr.merged_at,
              approvers,
              independentApproval: approvers.length > 0,
              ticket: (TICKET.exec(mr.title)?.[1] ?? TICKET.exec(mr.source_branch ?? "")?.[1] ?? null)?.toUpperCase() ?? null,
            });
          }
        } catch (e) {
          if (e instanceof GitLabError) throw e;
          mergesUnread.push(p.path);
        }
      }
    }),
  );

  let groups: Section<GlGroup[]>;
  try {
    const g = await get<{ full_path: string; parent_id: number | null; require_two_factor_authentication?: boolean }[]>("/groups?min_access_level=10&top_level_only=true&per_page=100");
    groups = ok(g.filter((x) => !x.parent_id).map((x) => ({ path: x.full_path, require2fa: Boolean(x.require_two_factor_authentication) })));
  } catch (e) {
    if (e instanceof GitLabError) throw e;
    groups = { ok: false, reason: "error", action: "read_api", message: "groups couldn't be read" };
  }

  return { base, login: me.username, scannedAt: new Date(started).toISOString(), durationMs: Date.now() - started, projects: ok(projects), projectsTruncated, projectsUnread, merges, mergesUnread, groups };
}
