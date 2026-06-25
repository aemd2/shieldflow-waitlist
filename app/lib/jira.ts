// Server-side Jira Cloud helpers (plain fetch). Basic auth (email + API token).
// Host allow-listed to *.atlassian.net to block SSRF. Reads project inventory as
// change-management evidence (issue-count APIs are mid-deprecation, so omitted).

export class JiraError extends Error {
  constructor(
    public kind: "auth" | "forbidden" | "rate_limited" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "JiraError";
  }
}

export function normalizeJiraHost(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(host) ? host : null;
}

function authHeader(email: string, token: string): string {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

async function jiraGet(host: string, path: string, email: string, token: string): Promise<Response> {
  try {
    return await fetch(`https://${host}${path}`, {
      headers: { Authorization: authHeader(email, token), Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new JiraError("unavailable", "Couldn't reach Jira. Please try again.");
  }
}

function check(res: Response): void {
  if (res.status === 401) throw new JiraError("auth", "Jira rejected these credentials. Check the email and API token.");
  if (res.status === 403) throw new JiraError("forbidden", "These credentials lack read access in Jira.");
  if (res.status === 429) throw new JiraError("rate_limited", "Jira rate limit reached. Try again in a minute.");
  if (!res.ok) throw new JiraError("unavailable", "Jira is unavailable right now. Try again shortly.");
}

/** Validate via GET /rest/api/3/myself. Returns the account display name. */
export async function validateCredentials(host: string, email: string, token: string): Promise<string> {
  const res = await jiraGet(host, "/rest/api/3/myself", email, token);
  check(res);
  const json = await res.json().catch(() => ({}));
  return (json.displayName as string) || (json.emailAddress as string) || email;
}

export interface JiraReport {
  totalProjects: number;
  projects: { key: string; name: string }[];
}

export async function fetchProjects(host: string, email: string, token: string): Promise<JiraReport> {
  const res = await jiraGet(host, "/rest/api/3/project/search?maxResults=50&orderBy=name", email, token);
  check(res);
  const json = (await res.json()) as { total?: number; values?: Array<{ key: string; name: string }> };
  const values = json.values ?? [];
  return {
    totalProjects: json.total ?? values.length,
    projects: values.map((p) => ({ key: p.key, name: p.name })),
  };
}
