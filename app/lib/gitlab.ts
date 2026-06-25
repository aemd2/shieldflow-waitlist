// Server-side GitLab helpers (plain fetch, no SDK — mirrors lib/github.ts).
// Read-only PAT, fixed host gitlab.com (self-managed hosts deferred).

const API = "https://gitlab.com/api/v4";
const MAX_PROJECT_PAGES = 3; // 3 × 100 = 300 projects max
const MAX_DETAIL_CHECKS = 30;

export class GitLabError extends Error {
  constructor(
    public kind: "auth" | "forbidden" | "rate_limited" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "GitLabError";
  }
}

function headers(token: string): Record<string, string> {
  return { "PRIVATE-TOKEN": token, Accept: "application/json" };
}

function check(res: Response): void {
  if (res.status === 401) throw new GitLabError("auth", "GitLab rejected this token. Check it and try again.");
  if (res.status === 403) throw new GitLabError("forbidden", "This token lacks read access. Use a read_api token.");
  if (res.status === 429) throw new GitLabError("rate_limited", "GitLab rate limit reached. Try again in a minute.");
  if (!res.ok) throw new GitLabError("unavailable", "GitLab is unavailable right now. Try again shortly.");
}

async function glGet(path: string, token: string): Promise<Response> {
  try {
    return await fetch(`${API}${path}`, { headers: headers(token), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new GitLabError("unavailable", "Couldn't reach GitLab. Please try again.");
  }
}

/** Validate a PAT via GET /user. Returns the username. */
export async function validateToken(token: string): Promise<string> {
  const res = await glGet("/user", token);
  check(res);
  const json = await res.json().catch(() => ({}));
  if (!json.username) throw new GitLabError("unavailable", "Unexpected response from GitLab. Try again.");
  return json.username as string;
}

export interface GitLabRepo {
  fullPath: string;
  visibility: string; // public | internal | private
  archived: boolean;
  branchProtection: "protected" | "unprotected" | "unknown";
}

export interface GitLabReport {
  repos: GitLabRepo[];
  total: number;
  protectedCount: number;
  publicCount: number;
  truncated: boolean;
}

export async function fetchRepoSecurity(token: string): Promise<GitLabReport> {
  type Raw = { id: number; path_with_namespace: string; visibility: string; archived: boolean };
  const raw: Raw[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PROJECT_PAGES; page++) {
    const res = await glGet(
      `/projects?membership=true&per_page=100&page=${page}&order_by=last_activity_at&simple=true`,
      token,
    );
    check(res);
    const batch = (await res.json()) as Raw[];
    raw.push(...batch);
    if (batch.length < 100) break;
    if (page === MAX_PROJECT_PAGES) truncated = true;
  }

  const repos: GitLabRepo[] = raw.map((r) => ({
    fullPath: r.path_with_namespace,
    visibility: r.visibility,
    archived: r.archived,
    branchProtection: "unknown",
  }));

  // Detail-check protected branches on active repos, capped.
  const active = raw.filter((r) => !r.archived);
  if (active.length > MAX_DETAIL_CHECKS) truncated = true;
  for (let i = 0; i < Math.min(active.length, MAX_DETAIL_CHECKS); i++) {
    const r = active[i];
    let res: Response;
    try {
      res = await fetch(`${API}/projects/${r.id}/protected_branches`, {
        headers: headers(token),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      continue;
    }
    if (res.status === 401) throw new GitLabError("auth", "GitLab access was revoked. Please reconnect.");
    if (res.status === 429) {
      truncated = true;
      break;
    }
    const target = repos.find((x) => x.fullPath === r.path_with_namespace)!;
    if (res.ok) {
      const branches = (await res.json()) as unknown[];
      target.branchProtection = branches.length > 0 ? "protected" : "unprotected";
    }
  }

  return {
    repos,
    total: repos.length,
    protectedCount: repos.filter((r) => r.branchProtection === "protected").length,
    publicCount: repos.filter((r) => r.visibility === "public" && !r.archived).length,
    truncated,
  };
}
