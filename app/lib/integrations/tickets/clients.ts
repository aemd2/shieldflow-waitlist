import { JiraError, normalizeJiraHost } from "@/lib/jira";
import { LinearError } from "@/lib/linear";

/**
 * Jira and Linear, for three things: what a merged change's ticket is (title,
 * status, link), the incident population (tickets labelled as incidents), and —
 * only if the workspace turns it on — creating a ticket for a failing check.
 */

export type Tracker = "jira" | "linear";

export interface TicketInfo {
  key: string;
  title: string;
  status: string | null;
  url: string;
}

export interface IncidentInfo extends TicketInfo {
  created: string | null;
  resolved: string | null;
}

export interface JiraCreds {
  host: string;
  email: string;
  token: string;
}

const INCIDENT_LABELS = ["incident", "security-incident", "security_incident", "sev1", "sev2"];

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------- Jira

async function jira(c: JiraCreds, path: string, init: RequestInit = {}): Promise<Response> {
  const host = normalizeJiraHost(c.host);
  if (!host) throw new JiraError("auth", "That isn't a Jira Cloud address — reconnect with yourco.atlassian.net.");
  const res = await fetch(`https://${host}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${Buffer.from(`${c.email}:${c.token}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new JiraError("unavailable", "Couldn't reach Jira. Please try again.");
  });
  if (res.status === 401) throw new JiraError("auth", "Jira rejected these credentials. Check the email and API token, then reconnect.");
  return res;
}

export async function jiraTickets(c: JiraCreds, keys: string[]): Promise<Map<string, TicketInfo | null>> {
  const host = normalizeJiraHost(c.host)!;
  const out = new Map<string, TicketInfo | null>();
  await pool(keys, 6, async (key) => {
    const res = await jira(c, `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status`);
    if (res.status === 404) return out.set(key, null);
    if (!res.ok) return; // unknown — left out, retried next scan
    const j = (await res.json()) as { key: string; fields?: { summary?: string; status?: { name?: string } } };
    out.set(key, { key: j.key, title: j.fields?.summary ?? key, status: j.fields?.status?.name ?? null, url: `https://${host}/browse/${j.key}` });
  });
  return out;
}

export async function jiraIncidents(c: JiraCreds): Promise<IncidentInfo[]> {
  const host = normalizeJiraHost(c.host)!;
  const labels = INCIDENT_LABELS.map((l) => `"${l}"`).join(", ");
  const search = async (jql: string) =>
    jira(c, "/rest/api/3/search/jql", { method: "POST", body: JSON.stringify({ jql, fields: ["summary", "status", "created", "resolutiondate"], maxResults: 100 }) });
  // "issuetype = Incident" errors when the site has no Incident type: fall back to labels only.
  let res = await search(`(issuetype = Incident OR labels in (${labels})) AND created >= -365d ORDER BY created DESC`);
  if (res.status === 400) res = await search(`labels in (${labels}) AND created >= -365d ORDER BY created DESC`);
  if (!res.ok) throw new JiraError("unavailable", `Jira search failed (HTTP ${res.status}).`);
  const j = (await res.json()) as { issues?: { key: string; fields?: { summary?: string; status?: { name?: string }; created?: string; resolutiondate?: string | null } }[] };
  return (j.issues ?? []).map((i) => ({
    key: i.key,
    title: i.fields?.summary ?? i.key,
    status: i.fields?.status?.name ?? null,
    url: `https://${host}/browse/${i.key}`,
    created: i.fields?.created ?? null,
    resolved: i.fields?.resolutiondate ?? null,
  }));
}

export async function jiraProjects(c: JiraCreds): Promise<{ key: string; name: string }[]> {
  const res = await jira(c, "/rest/api/3/project/search?maxResults=100&orderBy=name");
  if (!res.ok) return [];
  const j = (await res.json()) as { values?: { key: string; name: string }[] };
  return (j.values ?? []).map((p) => ({ key: p.key, name: p.name }));
}

export async function jiraCreate(c: JiraCreds, project: string, title: string, body: string): Promise<TicketInfo> {
  const host = normalizeJiraHost(c.host)!;
  const res = await jira(c, "/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({
      fields: {
        project: { key: project },
        summary: title.slice(0, 250),
        issuetype: { name: "Task" },
        description: { type: "doc", version: 1, content: body.split("\n\n").map((p) => ({ type: "paragraph", content: [{ type: "text", text: p.slice(0, 3000) }] })) },
        labels: ["shieldflow"],
      },
    }),
  });
  if (res.status === 403) throw new JiraError("forbidden", "These Jira credentials can't create issues in that project.");
  if (!res.ok) throw new JiraError("unavailable", `Jira didn't create the issue (HTTP ${res.status}) — check the project key.`);
  const j = (await res.json()) as { key: string };
  return { key: j.key, title, status: null, url: `https://${host}/browse/${j.key}` };
}

// -------------------------------------------------------------------- Linear

/** GraphQL that tolerates per-field errors (a missing issue) instead of failing the whole call. */
async function linear<T>(key: string, query: string, variables?: Record<string, unknown>): Promise<{ data: T | null; errors: string[] }> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new LinearError("unavailable", "Couldn't reach Linear. Please try again.");
  });
  if (res.status === 401 || res.status === 403) throw new LinearError("auth", "Linear rejected this API key. Create a new one and reconnect.");
  const j = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  return { data: j.data ?? null, errors: (j.errors ?? []).map((e) => e.message) };
}

export async function linearTickets(key: string, ids: string[]): Promise<Map<string, TicketInfo | null>> {
  const out = new Map<string, TicketInfo | null>();
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const q = `query { ${batch.map((id, n) => `t${n}: issue(id: ${JSON.stringify(id)}) { identifier title url state { name } }`).join(" ")} }`;
    const { data } = await linear<Record<string, { identifier: string; title: string; url: string; state?: { name?: string } } | null>>(key, q);
    batch.forEach((id, n) => {
      const t = data?.[`t${n}`];
      out.set(id, t ? { key: t.identifier, title: t.title, status: t.state?.name ?? null, url: t.url } : null);
    });
  }
  return out;
}

export async function linearIncidents(key: string): Promise<IncidentInfo[]> {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data, errors } = await linear<{ issues: { nodes: { identifier: string; title: string; url: string; createdAt: string; completedAt: string | null; state?: { name?: string } }[] } }>(
    key,
    `query($since: DateTimeOrDuration!) { issues(first: 100, orderBy: createdAt, filter: { createdAt: { gt: $since }, labels: { some: { name: { in: ${JSON.stringify([...INCIDENT_LABELS, "Incident", "Security incident"])} } } } }) { nodes { identifier title url createdAt completedAt state { name } } } }`,
    { since },
  );
  if (!data) throw new LinearError("unavailable", errors[0] ?? "Linear search failed.");
  return data.issues.nodes.map((i) => ({ key: i.identifier, title: i.title, status: i.state?.name ?? null, url: i.url, created: i.createdAt, resolved: i.completedAt }));
}

export async function linearTeams(key: string): Promise<{ key: string; name: string; id: string }[]> {
  const { data } = await linear<{ teams: { nodes: { id: string; key: string; name: string }[] } }>(key, "query { teams(first: 100) { nodes { id key name } } }");
  return (data?.teams.nodes ?? []).map((t) => ({ id: t.id, key: t.key, name: t.name }));
}

export async function linearCreate(key: string, teamKey: string, title: string, body: string): Promise<TicketInfo> {
  const team = (await linearTeams(key)).find((t) => t.key === teamKey);
  if (!team) throw new LinearError("unavailable", `No Linear team with the key ${teamKey}.`);
  const { data, errors } = await linear<{ issueCreate: { success: boolean; issue?: { identifier: string; url: string } } }>(
    key,
    "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }",
    { input: { teamId: team.id, title: title.slice(0, 250), description: body } },
  );
  const issue = data?.issueCreate.issue;
  if (!issue) throw new LinearError("unavailable", errors[0] ?? "Linear didn't create the issue.");
  return { key: issue.identifier, title, status: null, url: issue.url };
}
