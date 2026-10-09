"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Unplug, Plus, ArrowRight } from "lucide-react";
import { syncAWS, disconnectAWS } from "@/app/actions/aws";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { AwsConnect } from "@/components/integrations/aws/AwsConnect";

export interface AwsAccountSummary {
  id: string;
  accountId: string;
  alias: string | null;
  authKind: "role" | "key";
  inScope: boolean;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  failing: number;
  checks: number;
}

const NETWORK = "Network problem — check your connection and try again.";

/** The AWS tile on the Integrations page: accounts at a glance, the full view is /integrations/aws. */
export function AwsCard({ accounts, canWrite = true }: { accounts: AwsAccountSummary[]; canWrite?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<null | "sync" | "disconnect">(null);
  const [adding, setAdding] = useState(false);

  async function sync() {
    setBusy("sync");
    const res = await syncAWS().catch(() => ({ error: NETWORK }));
    setBusy(null);
    if ("error" in res && res.error) toast("error", res.error);
    else if ("ok" in res) toast("success", `Scanned ${res.accounts} ${res.accounts === 1 ? "account" : "accounts"}: ${res.fail} failing, ${res.pass} passing`);
    router.refresh();
  }

  async function disconnect() {
    if (!confirm("Disconnect every AWS account? Collected evidence stays in the vault.")) return;
    setBusy("disconnect");
    const res = await disconnectAWS();
    setBusy(null);
    if (res?.error) toast("error", res.error);
    else {
      toast("success", "Disconnected");
      router.refresh();
    }
  }

  if (!accounts.length || adding) {
    if (!canWrite) return <p className="text-xs text-muted-foreground">Not connected.</p>;
    return (
      <div className="space-y-3">
        <AwsConnect onDone={() => setAdding(false)} />
        {adding && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setAdding(false)}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {accounts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{a.alias ?? a.accountId}</span>
            {a.alias && <span className="font-mono text-xs text-muted-foreground">{a.accountId}</span>}
            {!a.inScope && <Badge>out of scope</Badge>}
            {a.authKind === "key" && <Badge variant="warning">access key — upgrade to role</Badge>}
            {a.status === "error" ? (
              <Badge variant="critical">needs attention</Badge>
            ) : a.checks ? (
              <Badge variant={a.failing ? "high" : "success"}>{a.failing ? `${a.failing} failing` : "all passing"}</Badge>
            ) : (
              <Badge>not scanned yet</Badge>
            )}
          </li>
        ))}
      </ul>
      {accounts.some((a) => a.lastError) && (
        <p className="text-xs text-destructive">{accounts.find((a) => a.lastError)?.lastError}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/integrations/aws" className="btn-accent inline-flex items-center gap-1.5">
          Open AWS <ArrowRight className="h-4 w-4" />
        </Link>
        {canWrite && (
          <>
            <Button onClick={sync} variant="outline" disabled={busy !== null} leftIcon={<RefreshCw className={`h-4 w-4 ${busy === "sync" ? "animate-spin" : ""}`} />}>
              {busy === "sync" ? "Scanning…" : "Scan now"}
            </Button>
            <Button variant="ghost" onClick={() => setAdding(true)} disabled={busy !== null} leftIcon={<Plus className="h-4 w-4" />}>
              Add account
            </Button>
            <Button variant="ghost" onClick={disconnect} disabled={busy !== null} leftIcon={<Unplug className="h-4 w-4" />}>
              Disconnect
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
