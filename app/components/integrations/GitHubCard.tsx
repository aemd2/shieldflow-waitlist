"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Unplug, GitBranch, ArrowRight, ShieldCheck } from "lucide-react";
import { connectGitHub, syncGitHub, disconnectGitHub } from "@/app/actions/github";
import { useToast } from "@/components/ui/Toast";
import { Button, buttonClasses } from "@/components/ui/Button";

const NETWORK = "Network problem — check your connection and try again.";

export function GitHubCard({
  status,
  lastSyncedAt,
  oauthEnabled, // the older OAuth app (repo scope) is configured
  appEnabled, // the read-only ShieldFlow GitHub App is configured
  connectedLogin,
  connection, // "app" | "token" | null
}: {
  status: "connected" | "error" | "disconnected" | null;
  lastSyncedAt: string | null;
  oauthEnabled: boolean;
  appEnabled?: boolean;
  connectedLogin?: string | null;
  connection?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);

  const connected = status === "connected";
  const needsReconnect = status === "error";

  async function connectPat(e: React.FormEvent) {
    e.preventDefault();
    setBusy("connect");
    const res = await connectGitHub({ token }).catch(() => ({ error: NETWORK, login: undefined }));
    setBusy(null);
    if (res?.error) return toast("error", res.error);
    setToken("");
    toast("success", res?.login ? `Connected as ${res.login}` : "GitHub connected");
    router.refresh();
  }

  async function sync() {
    setBusy("sync");
    const res = await syncGitHub().catch(() => ({ error: NETWORK }) as const);
    setBusy(null);
    if ("error" in res && res.error) {
      toast("error", res.error);
      router.refresh();
      return;
    }
    if ("ok" in res) toast("success", `Scanned: ${res.fail} failing, ${res.pass} passing, ${res.inconclusive} can't tell`);
    router.refresh();
  }

  async function disconnect() {
    if (!confirm("Disconnect GitHub? Collected evidence stays in the vault.")) return;
    setBusy("disconnect");
    const res = await disconnectGitHub();
    setBusy(null);
    if (res?.error) toast("error", res.error);
    else {
      toast("success", "Disconnected");
      router.refresh();
    }
  }

  const installApp = (label: string) => (
    <a href="/api/integrations/github/app/start" className={buttonClasses("accent")}>
      <ShieldCheck className="mr-2 h-4 w-4" /> {label}
    </a>
  );

  const tokenForm = (
    <form onSubmit={connectPat} className="space-y-2">
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
        <Button type="submit" variant={appEnabled ? "outline" : "accent"} disabled={busy !== null} className="shrink-0">
          {busy === "connect" ? "Verifying..." : "Connect"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A{" "}
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
          fine-grained token
        </a>{" "}
        with read-only Metadata, Administration, Pull requests, Members and Dependabot alerts.
      </p>
    </form>
  );

  if (connected) {
    return (
      <div className="space-y-2">
        {connectedLogin && (
          <p className="text-xs text-muted-foreground">
            Connected as <span className="font-medium">@{connectedLogin}</span>
            {connection === "app" ? " · GitHub App (read-only)" : " · token"}
          </p>
        )}
        {connection !== "app" && appEnabled && (
          <p className="text-xs text-warning">
            Connected with a token that can also write. Switch to the read-only GitHub App:{" "}
            <a href="/api/integrations/github/app/start" className="underline">install it</a>.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/integrations/github" className="btn-accent inline-flex items-center gap-1.5">
            Open GitHub <ArrowRight className="h-4 w-4" />
          </Link>
          <Button onClick={sync} variant="outline" disabled={busy !== null} leftIcon={<RefreshCw className={`h-4 w-4 ${busy === "sync" ? "animate-spin" : ""}`} />}>
            {busy === "sync" ? "Scanning…" : "Scan now"}
          </Button>
          <Button variant="ghost" onClick={disconnect} disabled={busy !== null} leftIcon={<Unplug className="h-4 w-4" />}>
            Disconnect
          </Button>
          {lastSyncedAt && <span className="text-xs text-muted-foreground">Last scanned {new Date(lastSyncedAt).toLocaleString()}</span>}
        </div>
      </div>
    );
  }

  if (needsReconnect) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-warning">GitHub access stopped working — reconnect to resume scanning.</p>
        {appEnabled ? installApp("Reinstall the GitHub App") : oauthEnabled ? (
          <a href="/api/integrations/github/start" className={buttonClasses("accent")}>
            <GitBranch className="mr-2 h-4 w-4" /> Reconnect with GitHub
          </a>
        ) : (
          tokenForm
        )}
      </div>
    );
  }

  if (appEnabled) {
    return (
      <div className="space-y-2">
        {installApp("Install the GitHub App (read-only)")}
        <p className="text-xs text-muted-foreground">
          You choose the organisation and repositories on GitHub. ShieldFlow can read settings, pull requests and alerts — never write, never read code.
        </p>
        {!showToken ? (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowToken(true)}>
            Can&apos;t install apps? Use a token instead
          </button>
        ) : (
          tokenForm
        )}
      </div>
    );
  }

  if (oauthEnabled) {
    return (
      <a href="/api/integrations/github/start" className={buttonClasses("accent")}>
        <GitBranch className="mr-2 h-4 w-4" />
        Connect with GitHub
      </a>
    );
  }

  return tokenForm;
}
