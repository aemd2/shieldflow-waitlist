"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Unplug } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";

export type ConnectField = {
  name: string;
  placeholder: string;
  type?: "text" | "password" | "textarea";
};

/** Token-based integrations that share IntegrationConnectCard. */
export type TokenIntegrationProvider =
  | "okta"
  | "gitlab"
  | "jira"
  | "linear"
  | "gcp"
  | "cloudflare";

// Toast copy lives on the client — inline functions can't cross the RSC boundary
// in production builds (Next.js only serializes "use server" actions).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function connectedToastFor(provider: TokenIntegrationProvider, res: any): string {
  switch (provider) {
    case "okta":
      return `Connected to ${res.org ?? "Okta"}`;
    case "gitlab":
      return `Connected as ${res.username}`;
    case "jira":
      return `Connected to ${res.site}`;
    case "linear":
      return `Connected as ${res.account}`;
    case "gcp":
      return `Connected to project ${res.project}`;
    case "cloudflare":
      return "Cloudflare connected";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function syncToastFor(provider: TokenIntegrationProvider, res: any): string {
  const s = res.summary ?? {};
  switch (provider) {
    case "okta":
      return `Synced: ${s.users} users, ${s.mfa}/${s.mfaChecked} with MFA`;
    case "gitlab":
      return `Synced: ${s.total} projects, ${s.protected} protected`;
    case "jira":
      return `Synced: ${s.projects} projects`;
    case "linear":
      return `Synced: ${s.teams} teams, ${s.issues} issues`;
    case "gcp":
      return `Synced: ${s.owners} owners, ${s.editors} editors`;
    case "cloudflare":
      return `Synced: ${s.zones} zones`;
  }
}

// Generic "paste a token, connect, sync, disconnect" card shared by the
// token-based integrations (Okta, GitLab, Jira, Linear, Cloudflare, GCP).
// Server actions are passed in from the page; field names map 1:1 to the
// action's expected input keys.
export function IntegrationConnectCard({
  provider,
  status,
  lastSyncedAt,
  identityLabel,
  fields,
  connectAction,
  syncAction,
  disconnectAction,
  setupHint,
  disconnectConfirm,
}: {
  provider: TokenIntegrationProvider;
  status: "connected" | "error" | "disconnected" | null;
  lastSyncedAt: string | null;
  identityLabel?: string | null;
  fields: ConnectField[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connectAction: (values: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  syncAction: () => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  disconnectAction: () => Promise<any>;
  setupHint: React.ReactNode;
  disconnectConfirm: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);

  const connected = status === "connected";
  const needsReconnect = status === "error";
  const NET = "Network problem — check your connection and try again.";

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy("connect");
    const res = await connectAction(values).catch(() => ({ error: NET }));
    setBusy(null);
    if (res?.error) {
      toast("error", res.error);
      return;
    }
    setValues({});
    toast("success", connectedToastFor(provider, res));
    router.refresh();
  }

  async function sync() {
    setBusy("sync");
    const res = await syncAction().catch(() => ({ error: NET }));
    setBusy(null);
    if (res?.error) {
      toast("error", res.error);
      router.refresh();
      return;
    }
    toast("success", syncToastFor(provider, res));
    router.refresh();
  }

  async function disconnect() {
    if (!confirm(disconnectConfirm)) return;
    setBusy("disconnect");
    const res = await disconnectAction();
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
        {identityLabel && <p className="text-xs text-muted-foreground">{identityLabel}</p>}
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
        <p className="text-xs text-amber-600">Access was revoked — reconnect to resume syncing.</p>
      )}
      {fields.map((f) =>
        f.type === "textarea" ? (
          <textarea
            key={f.name}
            required
            rows={4}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            placeholder={f.placeholder}
            className="input font-mono text-xs"
            autoComplete="off"
          />
        ) : (
          <input
            key={f.name}
            type={f.type ?? "text"}
            required
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            placeholder={f.placeholder}
            className="input"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        ),
      )}
      <Button type="submit" variant="accent" disabled={busy !== null} className="w-full sm:w-auto">
        {busy === "connect" ? "Verifying..." : needsReconnect ? "Reconnect" : "Connect"}
      </Button>
      <div className="text-xs text-muted-foreground">{setupHint}</div>
    </form>
  );
}
