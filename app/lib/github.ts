// Server-side GitHub helpers (plain fetch, no SDK — mirrors lib/google.ts).
// Supports two connection methods:
//  1. OAuth app (recommended) — one-click "Connect with GitHub" button.
//     Requires GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET in .env.local.
//  2. Fine-grained PAT fallback — user pastes a token (no app registration).
//     Used automatically when OAuth env vars are not set.

const API = "https://api.github.com";

// ── OAuth helpers ─────────────────────────────────────────────────────────────

export function isGitHubOAuthConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

/** Build the GitHub OAuth consent URL. Scope: repo (branch protection requires it). */
export function buildGitHubConsentUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: "repo",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

/** Exchange the OAuth code for an access token. */
export async function exchangeGitHubCode(
  code: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new GitHubError("unavailable", "Couldn't exchange GitHub code.");
  const json = await res.json();
  if (json.error || typeof json.access_token !== "string") {
    throw new GitHubError("auth", json.error_description ?? "GitHub OAuth failed.");
  }
  return json.access_token;
}

// Bounded pagination: 3 pages × 100 = 300 repos max per sync.
const MAX_REPO_PAGES = 3;
// Branch-protection lookups are 1 request each — cap them so a giant org
// can't burn the PAT's rate limit (5000/hr) in one sync.
const MAX_DETAIL_CHECKS = 30;

export class GitHubError extends Error {
  constructor(
    public kind: "auth" | "forbidden" | "rate_limited" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "GitHubError";
  }
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function rateLimited(res: Response): boolean {
  return (
    (res.status === 403 || res.status === 429) &&
    res.headers.get("x-ratelimit-remaining") === "0"
  );
}

/** Live-check a pasted PAT. Returns the GitHub login it belongs to. */
export async function validateToken(token: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API}/user`, {
      headers: headers(token),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GitHubError("unavailable", "Couldn't reach GitHub. Please try again.");
  }
  if (res.status === 401) {
    throw new GitHubError("auth", "GitHub rejected this token. Check it and try again.");
  }
  if (rateLimited(res)) {
    throw new GitHubError("rate_limited", "GitHub rate limit reached. Try again in a few minutes.");
  }
  if (!res.ok) {
    throw new GitHubError("unavailable", "GitHub is unavailable right now. Try again shortly.");
  }
  const json = await res.json();
  if (typeof json.login !== "string" || !json.login) {
    throw new GitHubError("unavailable", "Unexpected response from GitHub. Try again.");
  }
  return json.login;
}

export interface RepoSecurity {
  fullName: string;
  isPrivate: boolean;
  archived: boolean;
  defaultBranch: string;
  // "protected" | "unprotected" | "unknown" (no permission / not checked)
  branchProtection: "protected" | "unprotected" | "unknown";
}

export interface RepoSecurityReport {
  repos: RepoSecurity[];
  totalRepos: number;
  checked: number;
  protectedCount: number;
  publicCount: number;
  truncated: boolean; // hit a pagination/detail cap or the rate limit
}

export async function fetchRepoSecurity(token: string): Promise<RepoSecurityReport> {
  type RawRepo = {
    full_name: string;
    private: boolean;
    archived: boolean;
    default_branch: string;
  };
  const raw: RawRepo[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    let res: Response;
    try {
      res = await fetch(
        `${API}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,organization_member`,
        { headers: headers(token), signal: AbortSignal.timeout(20_000) },
      );
    } catch {
      throw new GitHubError("unavailable", "Couldn't reach GitHub. Please try again.");
    }
    if (res.status === 401) {
      throw new GitHubError("auth", "GitHub access was revoked. Please reconnect with a new token.");
    }
    if (rateLimited(res)) {
      throw new GitHubError("rate_limited", "GitHub rate limit reached. Try again in a few minutes.");
    }
    if (!res.ok) {
      throw new GitHubError("unavailable", "GitHub is unavailable right now. Try again shortly.");
    }
    const batch = (await res.json()) as RawRepo[];
    raw.push(...batch);
    if (batch.length < 100) break;
    if (page === MAX_REPO_PAGES) truncated = true;
  }

  const repos: RepoSecurity[] = raw.map((r) => ({
    fullName: r.full_name,
    isPrivate: r.private,
    archived: r.archived,
    defaultBranch: r.default_branch,
    branchProtection: "unknown",
  }));

  // Detail-check branch protection on active repos only, newest first, capped.
  const toCheck = repos.filter((r) => !r.archived).slice(0, MAX_DETAIL_CHECKS);
  if (repos.filter((r) => !r.archived).length > MAX_DETAIL_CHECKS) truncated = true;

  let checked = 0;
  for (const repo of toCheck) {
    let res: Response;
    try {
      res = await fetch(
        `${API}/repos/${repo.fullName}/branches/${encodeURIComponent(repo.defaultBranch)}/protection`,
        { headers: headers(token), signal: AbortSignal.timeout(15_000) },
      );
    } catch {
      // One slow repo shouldn't kill the whole report.
      continue;
    }
    if (res.status === 401) {
      throw new GitHubError("auth", "GitHub access was revoked. Please reconnect with a new token.");
    }
    if (rateLimited(res)) {
      // Keep what we have — the report notes it's partial.
      truncated = true;
      break;
    }
    if (res.ok) {
      repo.branchProtection = "protected";
      checked++;
    } else if (res.status === 404) {
      // 404 = no protection rules on the default branch.
      repo.branchProtection = "unprotected";
      checked++;
    }
    // 403 without rate-limit = token can't see protection settings (e.g. SSO-
    // gated org, missing administration:read) → stays "unknown", never fatal.
  }

  return {
    repos,
    totalRepos: repos.length,
    checked,
    protectedCount: repos.filter((r) => r.branchProtection === "protected").length,
    publicCount: repos.filter((r) => !r.isPrivate && !r.archived).length,
    truncated,
  };
}
