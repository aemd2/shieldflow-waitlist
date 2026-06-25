"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Unplug } from "lucide-react";
import { syncGoogleWorkspace, disconnectGoogleWorkspace } from "@/app/actions/integrations";
import { useToast } from "@/components/ui/Toast";

const CALLBACK_ERRORS: Record<string, string> = {
  not_configured: "Google integration isn't configured yet (missing GOOGLE_CLIENT_ID/SECRET).",
  denied: "Google access was denied — nothing was connected.",
  state_mismatch: "The connection attempt expired. Please try again.",
  exchange_failed: "Google sign-in failed. Please try connecting again.",
  db: "We couldn't save the connection. Please try again.",
};

// Inner controls for the Google Workspace card — the IntegrationCard shell
// provides the header and status badge.
export function GoogleWorkspaceCard({
  configured,
  status,
  lastSyncedAt,
}: {
  configured: boolean;
  status: "connected" | "error" | "disconnected" | null;
  lastSyncedAt: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);

  // Surface OAuth-callback results (arrives via query params) exactly once.
  useEffect(() => {
    const err = params.get("error");
    if (err && CALLBACK_ERRORS[err]) toast("error", CALLBACK_ERRORS[err]);
    if (params.get("connected") === "1") toast("success", "Google Workspace connected");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = status === "connected";

  async function sync() {
    setBusy("sync");
    const res = await syncGoogleWorkspace();
    setBusy(null);
    if (res?.error) {
      toast("error", res.error);
      router.refresh();
      return;
    }
    const s = res?.summary;
    toast(
      "success",
      s ? `Synced: ${s.total} users, ${s.with2fa} with 2FA` : "Sync complete",
    );
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
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Not configured yet — add <code className="font-mono">GOOGLE_CLIENT_ID</code> and{" "}
        <code className="font-mono">GOOGLE_CLIENT_SECRET</code> to enable it. See SETUP.md.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!connected ? (
        <a href="/api/integrations/google/start" className="btn-accent">
          {status === "error" ? "Reconnect" : "Connect Google Workspace"}
        </a>
      ) : (
        <>
          <button onClick={sync} disabled={busy !== null} className="btn-primary">
            <RefreshCw className={`mr-2 h-4 w-4 ${busy === "sync" ? "animate-spin" : ""}`} />
            {busy === "sync" ? "Syncing..." : "Sync now"}
          </button>
          <button onClick={disconnect} disabled={busy !== null} className="btn-outline">
            <Unplug className="mr-2 h-4 w-4" /> Disconnect
          </button>
        </>
      )}
      {lastSyncedAt && (
        <span className="text-xs text-muted-foreground">
          Last synced {new Date(lastSyncedAt).toLocaleString()}
        </span>
      )}
    </div>
  );
}
