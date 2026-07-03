"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Unplug, Cloud } from "lucide-react";
import { connectAWS, syncAWS, disconnectAWS } from "@/app/actions/aws";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";

export function AwsCard({
  status,
  lastSyncedAt,
  accountId,
}: {
  status: "connected" | "error" | "disconnected" | null;
  lastSyncedAt: string | null;
  accountId?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);

  const connected = status === "connected";
  const needsReconnect = status === "error";

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy("connect");
    const res = await connectAWS({ accessKeyId: keyId, secretAccessKey: secret }).catch(() => ({
      error: "Network problem — check your connection and try again.",
      accountId: undefined,
    }));
    setBusy(null);
    if ("error" in res && res.error) {
      toast("error", res.error);
      return;
    }
    setKeyId("");
    setSecret("");
    toast("success", res.accountId ? `Connected to account ${res.accountId}` : "AWS connected");
    router.refresh();
  }

  async function sync() {
    setBusy("sync");
    const res = await syncAWS().catch(() => ({
      error: "Network problem — check your connection and try again.",
      summary: undefined,
    }));
    setBusy(null);
    if ("error" in res && res.error) {
      toast("error", res.error);
      router.refresh();
      return;
    }
    const s = res.summary;
    toast(
      "success",
      s
        ? `Synced: root MFA ${s.rootMfa ? "on" : "OFF"}, ${s.users} users, password policy ${s.passwordPolicy ? "set" : "missing"}`
        : "Sync complete",
    );
    router.refresh();
  }

  async function disconnect() {
    if (!confirm("Disconnect AWS? Collected evidence stays in the vault.")) return;
    setBusy("disconnect");
    const res = await disconnectAWS();
    setBusy(null);
    if (res?.error) toast("error", res.error);
    else {
      toast("success", "Disconnected");
      router.refresh();
    }
  }

  if (connected) {
    return (
      <div className="space-y-2">
        {accountId && (
          <p className="text-xs text-muted-foreground">
            Connected to account <span className="font-medium">{accountId}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
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
          {lastSyncedAt && (
            <span className="text-xs text-muted-foreground">
              Last synced {new Date(lastSyncedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={connect} className="space-y-2">
      {needsReconnect && (
        <p className="text-xs text-warning">Access was revoked — reconnect to resume syncing.</p>
      )}
      <label className="block text-xs font-medium text-muted-foreground">
        Read-only IAM access key
      </label>
      <input
        value={keyId}
        onChange={(e) => setKeyId(e.target.value)}
        placeholder="Access key ID (AKIA...)"
        required
        autoComplete="off"
        autoCapitalize="characters"
        className="input"
      />
      <input
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder="Secret access key"
        required
        autoComplete="off"
        className="input"
      />
      <Button
        type="submit"
        variant="accent"
        disabled={busy !== null}
        className="w-full sm:w-auto"
        leftIcon={<Cloud className="h-4 w-4" />}
      >
        {busy === "connect" ? "Verifying..." : needsReconnect ? "Reconnect" : "Connect"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Create an IAM user with the AWS-managed{" "}
        <code className="font-mono">IAMReadOnlyAccess</code> policy, then an access key. ShieldFlow
        reads only account-level security posture (root MFA, password policy) — it never makes changes.
      </p>
    </form>
  );
}
