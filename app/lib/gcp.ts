// Server-side Google Cloud helpers (plain fetch + node:crypto, no SDK). Auth is
// a pasted service-account JSON key: we build an RS256-signed JWT and exchange it
// for an access token (the same "sign it yourself" approach as AWS SigV4). Fixed
// Google endpoints — no SSRF. Reads project IAM exposure (owners/editors).

import { createSign } from "crypto";

export class GcpError extends Error {
  constructor(
    public kind: "auth" | "forbidden" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "GcpError";
  }
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
  project_id: string;
}

function parseServiceAccount(jsonStr: string): ServiceAccount {
  let obj: Record<string, string>;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    throw new GcpError("auth", "That isn't valid service-account JSON. Paste the whole key file.");
  }
  if (!obj.client_email || !obj.private_key || !obj.project_id) {
    throw new GcpError(
      "auth",
      "The JSON is missing client_email / private_key / project_id — paste the full, unmodified key file.",
    );
  }
  return {
    client_email: obj.client_email,
    private_key: obj.private_key,
    token_uri: obj.token_uri || "https://oauth2.googleapis.com/token",
    project_id: obj.project_id,
  };
}

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform.read-only",
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;

  let signature: string;
  try {
    signature = createSign("RSA-SHA256").update(signingInput).sign(sa.private_key, "base64url");
  } catch {
    throw new GcpError("auth", "Couldn't use the private key in that JSON — paste the full, unmodified key file.");
  }
  const jwt = `${signingInput}.${signature}`;

  let res: Response;
  try {
    res = await fetch(sa.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GcpError("unavailable", "Couldn't reach Google. Please try again.");
  }
  const json = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !json.access_token) {
    throw new GcpError(
      "auth",
      "Google rejected this service account. Check the key is valid and the account is enabled.",
    );
  }
  return json.access_token;
}

/** Validate the service account (parse + token exchange). Returns the project ID. */
export async function validateServiceAccount(jsonStr: string): Promise<string> {
  const sa = parseServiceAccount(jsonStr);
  await getAccessToken(sa);
  return sa.project_id;
}

export interface GcpReport {
  projectId: string;
  owners: number;
  editors: number;
  totalBindings: number;
}

export async function fetchProjectSecurity(jsonStr: string): Promise<GcpReport> {
  const sa = parseServiceAccount(jsonStr);
  const token = await getAccessToken(sa);

  let res: Response;
  try {
    res = await fetch(
      `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}:getIamPolicy`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new GcpError("unavailable", "Couldn't reach Google Cloud. Please try again.");
  }
  if (res.status === 403) {
    throw new GcpError(
      "forbidden",
      "The service account can't read the IAM policy. Grant it the Viewer or Security Reviewer role.",
    );
  }
  if (!res.ok) throw new GcpError("unavailable", "Google Cloud is unavailable right now. Try again shortly.");

  const json = (await res.json()) as { bindings?: Array<{ role: string; members?: string[] }> };
  const bindings = json.bindings ?? [];
  let owners = 0;
  let editors = 0;
  for (const b of bindings) {
    if (b.role === "roles/owner") owners += b.members?.length ?? 0;
    if (b.role === "roles/editor") editors += b.members?.length ?? 0;
  }
  return { projectId: sa.project_id, owners, editors, totalBindings: bindings.length };
}
