"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Unplug } from "lucide-react";
import { syncGoogleWorkspace, disconnectGoogleWorkspace } from "@/app/actions/integrations";
import { useToast } from "@/components/ui/Toast";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

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
      <Alert variant="warning">
        Not configured yet — add <code className="font-mono">GOOGLE_CLIENT_ID</code> and{" "}
        <code className="font-mono">GOOGLE_CLIENT_SECRET</code> to enable it. See SETUP.md.
      </Alert>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!connected ? (
        <a href="/api/integrations/google/start" className={buttonClasses("accent")}>
          {status === "error" ? "Reconnect" : "Connect Google Workspace"}
        </a>
      ) : (
        <>
          <Button
            onClick={sync}
            disabled={busy !== null}
            leftIcon={<RefreshCw className={`h-4 w-4 ${busy === "sync" ? "animate-spin" : ""}`} />}
          >
            {busy === "sync" ? "Syncing..." : "Sync now"}
          </Button>
          <Button variant="outline" onClick={disconnect} disabled={busy !== null} leftIcon={<Unplug className="h-4 w-4" />}>
            Disconnect
          </Button>
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
