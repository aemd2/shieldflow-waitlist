"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Unplug, MessageSquare } from "lucide-react";
import { connectSlack, sendComplianceDigest, disconnectSlack } from "@/app/actions/slack";
import { useToast } from "@/components/ui/Toast";

export function SlackCard({
  status,
  lastSyncedAt,
  oauthEnabled,  // true when SLACK_CLIENT_ID + SECRET are set
  channel,       // e.g. "#compliance" stored from OAuth callback
}: {
  status: "connected" | "error" | "disconnected" | null;
  lastSyncedAt: string | null;
  oauthEnabled: boolean;
  channel?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"connect" | "digest" | "disconnect" | null>(null);

  const connected = status === "connected";
  const needsReconnect = status === "error";

  // Webhook URL paste — fallback when OAuth app is not configured.
  async function connectWebhook(e: React.FormEvent) {
    e.preventDefault();
    setBusy("connect");
    const res = await connectSlack({ webhookUrl: url }).catch(() => ({
      error: "Network problem — check your connection and try again.",
    }));
    setBusy(null);
    if (res?.error) { toast("error", res.error); return; }
    setUrl("");
    toast("success", "Slack connected — a test message was sent to the channel");
    router.refresh();
  }

  async function digest() {
    setBusy("digest");
    const res = await sendComplianceDigest().catch(() => ({
      error: "Network problem — check your connection and try again.",
    }));
    setBusy(null);
    if (res?.error) { toast("error", res.error); router.refresh(); return; }
    toast("success", "Digest sent to Slack");
    router.refresh();
  }

  async function disconnect() {
    if (!confirm("Disconnect Slack?")) return;
    setBusy("disconnect");
    const res = await disconnectSlack();
    setBusy(null);
    if (res?.error) toast("error", res.error);
    else { toast("success", "Disconnected"); router.refresh(); }
  }

  // ── Connected ────────────────────────────────────────────────────────────────
  if (connected) {
    return (
      <div className="space-y-2">
        {channel && (
          <p className="text-xs text-muted-foreground">
            Posting to <span className="font-medium">{channel}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={digest} disabled={busy !== null} className="btn-primary">
            <Send className="mr-2 h-4 w-4" />
            {busy === "digest" ? "Sending..." : "Send digest now"}
          </button>
          <button onClick={disconnect} disabled={busy !== null} className="btn-outline">
            <Unplug className="mr-2 h-4 w-4" /> Disconnect
          </button>
          {lastSyncedAt && (
            <span className="text-xs text-muted-foreground">
              Last digest {new Date(lastSyncedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Reconnect after webhook revoked ──────────────────────────────────────────
  if (needsReconnect) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-amber-600">Webhook was removed — reconnect to resume digests.</p>
        {oauthEnabled ? (
          <a href="/api/integrations/slack/start" className="btn-accent inline-flex items-center">
            <MessageSquare className="mr-2 h-4 w-4" /> Reconnect with Slack
          </a>
        ) : (
          <form onSubmit={connectWebhook} className="flex flex-wrap gap-2">
            <input
              type="password"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a new webhook URL"
              required
              autoComplete="off"
              className="input min-w-0 flex-1"
            />
            <button type="submit" disabled={busy !== null} className="btn-accent shrink-0">
              {busy === "connect" ? "Testing..." : "Reconnect"}
            </button>
          </form>
        )}
      </div>
    );
  }

  // ── Not connected ────────────────────────────────────────────────────────────
  if (oauthEnabled) {
    // One-click OAuth — user picks a channel, we get the webhook URL automatically.
    return (
      <a
        href="/api/integrations/slack/start"
        className="btn-accent inline-flex items-center"
      >
        <MessageSquare className="mr-2 h-4 w-4" />
        Add to Slack
      </a>
    );
  }

  // Fallback: webhook URL paste.
  return (
    <form onSubmit={connectWebhook} className="space-y-2">
      <label className="block text-xs font-medium text-muted-foreground">
        Incoming webhook URL
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
          required
          autoComplete="off"
          className="input min-w-0 flex-1"
        />
        <button type="submit" disabled={busy !== null} className="btn-accent shrink-0">
          {busy === "connect" ? "Testing..." : "Connect"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        In Slack: create an app →{" "}
        <a
          href="https://api.slack.com/apps"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          Incoming Webhooks
        </a>{" "}
        → add to a channel → copy the URL.
      </p>
    </form>
  );
}
