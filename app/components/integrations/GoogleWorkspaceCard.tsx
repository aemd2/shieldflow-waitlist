"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, RefreshCw, Unplug } from "lucide-react";
import { syncGoogleWorkspace, disconnectGoogleWorkspace } from "@/app/actions/integrations";
import { useToast } from "@/components/ui/Toast";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

const NETWORK = "Network problem — check your connection and try again.";

// Inner controls for the Google Workspace card — the IntegrationCard shell
// provides the header and status badge. Connect results (?connected / ?error)
// are toasted once by IntegrationsUrlToast for every provider.
export function GoogleWorkspaceCard({
  configured,
  status,
  lastSyncedAt,
  needsReconnect, // connected before the read-only audit-log permission was asked for
}: {
  configured: boolean;
  status: "connected" | "error" | "disconnected" | null;
  lastSyncedAt: string | null;
  needsReconnect?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);

  const connected = status === "connected";

  async function sync() {
    setBusy("sync");
    const res = await syncGoogleWorkspace().catch(() => ({ error: NETWORK }) as const);
    setBusy(null);
    if ("error" in res && res.error) {
      toast("error", res.error);
      router.refresh();
      return;
    }
    if ("ok" in res) toast("success", `Scanned ${res.summary.total} people: ${res.fail} failing, ${res.pass} passing, ${res.inconclusive} can't tell`);
    router.refresh();
  }

  async function disconnect() {
    if (!confirm("Disconnect Google Workspace? Collected evidence stays in the vault.")) return;
    setBusy("disconnect");
    const res = await disconnectGoogleWorkspace();
    setBusy(null);
    if (res?.error) toast("error", res.error);
    else {
      toast("success", "Disconnected");
      router.refresh();
    }
  }

  if (!configured) {
    return (
      <Alert variant="warning">
        Not configured yet — add <code className="font-mono">GOOGLE_CLIENT_ID</code> and{" "}
        <code className="font-mono">GOOGLE_CLIENT_SECRET</code> to enable it. See SETUP.md.
      </Alert>
    );
  }

  if (!connected) {
    return (
      <div className="space-y-2">
        <a href="/api/integrations/google/start" className={buttonClasses("accent")}>
          {status === "error" ? "Reconnect" : "Connect Google Workspace"}
        </a>
        <p className="text-xs text-muted-foreground">Sign in as a Workspace admin. Read-only: accounts and the audit log — never mail or files.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {needsReconnect && (
        <p className="text-xs text-warning">
          Reconnect once to see which third-party apps can read your mail and Drive (adds read-only audit-log access):{" "}
          <a href="/api/integrations/google/start" className="underline">reconnect</a>.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/integrations/google_workspace" className="btn-accent inline-flex items-center gap-1.5">
          Open Google Workspace <ArrowRight className="h-4 w-4" />
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
