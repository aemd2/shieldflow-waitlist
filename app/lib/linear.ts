// Server-side Linear helpers (GraphQL, plain fetch). Personal API key goes in
// the Authorization header directly (no "Bearer"). Fixed endpoint — no SSRF.

const ENDPOINT = "https://api.linear.app/graphql";

export class LinearError extends Error {
  constructor(
    public kind: "auth" | "rate_limited" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "LinearError";
  }
}

async function gql<T>(key: string, query: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new LinearError("unavailable", "Couldn't reach Linear. Please try again.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new LinearError("auth", "Linear rejected this API key. Check it and try again.");
  }
  if (res.status === 429) {
    throw new LinearError("rate_limited", "Linear rate limit reached. Try again in a minute.");
  }
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    const msg = json.errors[0].message;
    if (/auth/i.test(msg)) throw new LinearError("auth", "Linear rejected this API key. Check it and try again.");
    throw new LinearError("unavailable", "Linear returned an error. Try again shortly.");
  }
  if (!res.ok || !json.data) {
    throw new LinearError("unavailable", "Linear is unavailable right now. Try again shortly.");
  }
  return json.data;
}

/** Validate the API key via the viewer query. Returns the user's email/name. */
export async function validateKey(key: string): Promise<string> {
  const data = await gql<{ viewer: { name?: string; email?: string } }>(
    key,
    `query { viewer { id name email } }`,
  );
  return data.viewer.email || data.viewer.name || "Linear user";
}

export interface LinearReport {
  teams: number;
  issuesSampled: number;
  completed: number;
  open: number;
}

export async function fetchActivity(key: string): Promise<LinearReport> {
  const data = await gql<{
    teams: { nodes: Array<{ id: string }> };
    issues: { nodes: Array<{ state: { type: string } | null }> };
  }>(
    key,
    `query {
      teams(first: 100) { nodes { id } }
      issues(first: 100) { nodes { state { type } } }
    }`,
  );
  const issues = data.issues.nodes;
  const completed = issues.filter((i) => i.state?.type === "completed" || i.state?.type === "canceled").length;
  return {
    teams: data.teams.nodes.length,
    issuesSampled: issues.length,
    completed,
    open: issues.length - completed,
  };
}
