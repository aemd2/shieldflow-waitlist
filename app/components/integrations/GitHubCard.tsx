"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Unplug, GitBranch } from "lucide-react";
import { connectGitHub, syncGitHub, disconnectGitHub } from "@/app/actions/github";
import { useToast } from "@/components/ui/Toast";

export function GitHubCard({
  status,
  lastSyncedAt,
  oauthEnabled,   // true when GITHUB_CLIENT_ID + SECRET are set
  connectedLogin, // GitHub @username stored from OAuth callback
}: {
  status: "connected" | "error" | "disconnected" | null;
  lastSyncedAt: string | null;
  oauthEnabled: boolean;
  connectedLogin?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);

  const connected = status === "connected";
  const needsReconnect = status === "error";

  // PAT connect — used as fallback when OAuth app is not configured.
  async function connectPat(e: React.FormEvent) {
    e.preventDefault();
    setBusy("connect");
    const res = await connectGitHub({ token }).catch(() => ({
      error: "Network problem — check your connection and try again.",
      login: undefined,
    }));
    setBusy(null);
    if (res?.error) { toast("error", res.error); return; }
    setToken("");
    toast("success", res?.login ? `Connected as ${res.login}` : "GitHub connected");
    router.refresh();
  }

  async function sync() {
    setBusy("sync");
    const res = await syncGitHub().catch(() => ({
      error: "Network problem — check your connection and try again.",
      summary: undefined,
    }));
    setBusy(null);
    if (res?.error) { toast("error", res.error); router.refresh(); return; }
    const s = res?.summary;
    toast(
      "success",
      s ? `Synced: ${s.total} repos, ${s.protected} with branch protection` : "Sync complete",
    );
    router.refresh();
  }

  async function disconnect() {
    if (!confirm("Disconnect GitHub? Collected evidence stays in the vault.")) return;
    setBusy("disconnect");
    const res = await disconnectGitHub();
    setBusy(null);
    if (res?.error) toast("error", res.error);
    else { toast("success", "Disconnected"); router.refresh(); }
  }

  // ── Connected state (same regardless of how they connected) ─────────────────
  if (connected) {
    return (
      <div className="space-y-2">
        {connectedLogin && (
          <p className="text-xs text-muted-foreground">
            Connected as <span className="font-medium">@{connectedLogin}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={sync} disabled={busy !== null} className="btn-primary">
            <RefreshCw className={`mr-2 h-4 w-4 ${busy === "sync" ? "animate-spin" : ""}`} />
            {busy === "sync" ? "Syncing..." : "Sync now"}
          </button>
          <button onClick={disconnect} disabled={busy !== null} className="btn-outline">
            <Unplug className="mr-2 h-4 w-4" /> Disconnect
          </button>
          {lastSyncedAt && (
            <span className="text-xs text-muted-foreground">
              Last synced {new Date(lastSyncedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Reconnect after token revoked ───────────────────────────────────────────
  if (needsReconnect) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-amber-600">Access was revoked — reconnect to resume syncing.</p>
        {oauthEnabled ? (
          // Re-run the OAuth flow to get a fresh token.
          <a href="/api/integrations/github/start" className="btn-accent inline-flex items-center">
            <GitBranch className="mr-2 h-4 w-4" /> Reconnect with GitHub
          </a>
        ) : (
          <form onSubmit={connectPat} className="flex flex-wrap gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste a new token (github_pat_...)"
              required
              autoComplete="off"
              className="input min-w-0 flex-1"
            />
            <button type="submit" disabled={busy !== null} className="btn-accent shrink-0">
              {busy === "connect" ? "Verifying..." : "Reconnect"}
            </button>
          </form>
        )}
      </div>
    );
  }

  // ── Not connected ────────────────────────────────────────────────────────────
  if (oauthEnabled) {
    // One-click OAuth — same UX as Google Workspace.
    return (
      <a
        href="/api/integrations/github/start"
        className="btn-accent inline-flex items-center"
      >
        <GitBranch className="mr-2 h-4 w-4" />
        Connect with GitHub
      </a>
    );
  }

  // Fallback: PAT paste (works without registering an OAuth app).
  return (
    <form onSubmit={connectPat} className="space-y-2">
      <label className="block text-xs font-medium text-muted-foreground">
        Fine-grained personal access token (read-only)
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_..."
          required
          autoComplete="off"
          className="input min-w-0 flex-1"
        />
        <button type="submit" disabled={busy !== null} className="btn-accent shrink-0">
          {busy === "connect" ? "Verifying..." : "Connect"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Create one at{" "}
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          GitHub → Fine-grained tokens
        </a>
        , with read-only <code className="font-mono">Metadata</code> and{" "}
        <code className="font-mono">Administration</code> permissions.
      </p>
    </form>
  );
}
