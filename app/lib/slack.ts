// Server-side Slack helpers. Supports two connection methods:
//  1. OAuth app (recommended) — one-click "Add to Slack" button.
//     Requires SLACK_CLIENT_ID + SLACK_CLIENT_SECRET in .env.local.
//     Slack's OAuth callback returns the webhook URL automatically.
//  2. Incoming Webhook URL paste — fallback when OAuth vars are not set.
// The digest/send logic is identical for both — both store a webhook URL.

// ── OAuth helpers ─────────────────────────────────────────────────────────────

export function isSlackOAuthConfigured(): boolean {
  return Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
}

/** Build the Slack OAuth consent URL. Scope: incoming-webhook. */
export function buildSlackConsentUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID!,
    scope: "incoming-webhook",
    redirect_uri: redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

/** Exchange an OAuth code for an incoming webhook URL + channel name. */
export async function exchangeSlackCode(
  code: string,
  redirectUri: string,
): Promise<{ webhookUrl: string; channel: string; teamName: string }> {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID!,
    client_secret: process.env.SLACK_CLIENT_SECRET!,
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(`https://slack.com/api/oauth.v2.access?${params}`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new SlackError("unavailable", "Couldn't exchange Slack code.");
  const json = await res.json();
  if (!json.ok || !json.incoming_webhook?.url) {
    throw new SlackError("unavailable", json.error ?? "Slack OAuth failed.");
  }
  return {
    webhookUrl: json.incoming_webhook.url as string,
    channel: (json.incoming_webhook.channel as string) ?? "",
    teamName: (json.team?.name as string) ?? "",
  };
}

export class SlackError extends Error {
  constructor(
    public kind: "revoked" | "rate_limited" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "SlackError";
  }
}

/**
 * SSRF guard: the server POSTs to this URL, so it must never be an
 * attacker-chosen host (internal services, cloud metadata endpoints).
 * Only genuine Slack incoming-webhook URLs pass: https, exact host,
 * /services/ path.
 */
export function isValidSlackWebhook(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === "hooks.slack.com" &&
    parsed.pathname.startsWith("/services/") &&
    parsed.username === "" &&
    parsed.password === "" &&
    (parsed.port === "" || parsed.port === "443")
  );
}

/** Post a message to a Slack incoming webhook. Throws SlackError on failure. */
export async function sendSlackMessage(webhookUrl: string, text: string): Promise<void> {
  // Defense in depth: validate again right before the network call, in case a
  // caller ever passes a stored value that predates the validation.
  if (!isValidSlackWebhook(webhookUrl)) {
    throw new SlackError("revoked", "This Slack webhook isn't valid. Please reconnect.");
  }

  let res: Response;
  try {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SlackError("unavailable", "Couldn't reach Slack. Please try again.");
  }

  if (res.ok) return;

  // Slack returns 404 "no_service" / 410 when the webhook was deleted.
  if (res.status === 404 || res.status === 410 || res.status === 403) {
    throw new SlackError(
      "revoked",
      "This Slack webhook was removed in Slack. Please reconnect with a new one.",
    );
  }
  if (res.status === 429) {
    throw new SlackError("rate_limited", "Slack is busy right now. Try again in a minute.");
  }
  throw new SlackError("unavailable", "Slack is unavailable right now. Try again shortly.");
}
