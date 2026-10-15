"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncAWS, updateAwsAccount, updateAwsSettings, removeAwsAccount } from "@/app/actions/aws";
import { AWS_CHECKS } from "@/lib/aws/catalog";
import type { CheckArea } from "@/lib/aws/types";
import type { AwsView, AwsAccountView } from "@/lib/aws/view";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AwsConnect } from "@/components/integrations/aws/AwsConnect";
import { PostureChecks } from "@/components/integrations/checks/CheckList";

const NETWORK = "Network problem — check your connection and try again.";

const AREAS: { area: CheckArea; title: string }[] = [
  { area: "identity", title: "Identity & access" },
  { area: "exposure", title: "Internet exposure" },
  { area: "logging", title: "Audit logging" },
  { area: "detection", title: "Threat detection" },
  { area: "encryption", title: "Encryption at rest" },
  { area: "patching", title: "Patching & support" },
  { area: "vulnerabilities", title: "Vulnerabilities" },
  { area: "backups", title: "Backups" },
  { area: "residency", title: "Data residency" },
];

function ago(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function AccountSettings({ account, canWrite }: { account: AwsAccountView; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [alias, setAlias] = useState(account.alias ?? "");
  const [regions, setRegions] = useState((account.regions ?? []).join(", "));
  const save = async (patch: Record<string, unknown>) => {
    const r = await updateAwsAccount({ id: account.id, ...patch }).catch(() => ({ error: NETWORK }));
    if ("error" in r && r.error) return toast("error", r.error);
    toast("success", "Saved");
    router.refresh();
  };
  if (!canWrite || account.id === "legacy") return null;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Name" className="input max-w-[12rem]" />
        <Button size="sm" variant="outline" onClick={() => save({ alias: alias || null })}>Rename</Button>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={account.inScope} onChange={(e) => save({ inScope: e.target.checked })} />
          In audit scope
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="Regions to scan — blank = every region in use" className="input max-w-md" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => save({ regions: regions.split(/[\s,]+/).filter(Boolean) })}
        >
          Save regions
        </Button>
      </div>
      <button
        type="button"
        className="text-xs text-destructive underline"
        onClick={async () => {
          if (!confirm(`Remove account ${account.alias ?? account.accountId}? Its evidence stays in the vault.`)) return;
          const r = await removeAwsAccount(account.id).catch(() => ({ error: NETWORK }));
          if ("error" in r && r.error) return toast("error", r.error);
          router.refresh();
        }}
      >
        Remove this account
      </button>
    </div>
  );
}

export function AwsPosture({ view, canWrite }: { view: AwsView; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const scanned = view.accounts.filter((a) => a.scan);
  const [accountId, setAccountId] = useState<string>((scanned.find((a) => a.inScope) ?? scanned[0] ?? view.accounts[0])?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(!view.accounts.length);
  const [retention, setRetention] = useState(String(view.logRetentionDays));
  const [restoreDays, setRestoreDays] = useState(String(view.settings.restoreTestDays));

  const account = view.accounts.find((a) => a.id === accountId) ?? null;
  const totalCost = account?.scan?.results.reduce((n, r) => n + (r.costPerMonth ?? 0), 0) ?? 0;

  async function scan() {
    setBusy(true);
    const res = await syncAWS().catch(() => ({ error: NETWORK }));
    setBusy(false);
    if ("error" in res && res.error) toast("error", res.error);
    else if ("ok" in res) toast("success", `Scanned: ${res.fail} failing, ${res.pass} passing, ${res.inconclusive} can't tell`);
    router.refresh();
  }

  if (adding) {
    return (
      <div className="card space-y-3">
        <h2 className="text-sm font-semibold">Connect an AWS account</h2>
        <AwsConnect onDone={() => setAdding(false)} />
        {view.accounts.length > 0 && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setAdding(false)}>Cancel</button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Accounts */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {view.accounts.length > 1 ? (
            <SegmentedControl
              options={view.accounts.map((a) => ({ value: a.id, label: `${a.alias ?? a.accountId}${a.inScope ? "" : " (out of scope)"}` }))}
              value={accountId}
              onChange={(v) => setAccountId(v)}
            />
          ) : (
            <span className="text-sm font-semibold">{account?.alias ?? account?.accountId}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {account?.scan
              ? `Scanned ${ago(account.scan.scannedAt)} · ${account.scan.regions.scanned.join(", ") || "no active regions"} · ${Math.round(account.scan.durationMs / 1000)} s`
              : "Not scanned yet"}
          </span>
          <span className="ml-auto flex gap-2">
            {canWrite && (
              <>
                <Button size="sm" onClick={scan} disabled={busy} leftIcon={<RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />}>
                  {busy ? "Scanning…" : "Scan now"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>Add account</Button>
              </>
            )}
          </span>
        </div>
        {account && !account.inScope && (
          <p className="text-xs text-muted-foreground">
            This account is out of audit scope: its results are shown here, but never raise alerts or count toward your frameworks.
          </p>
        )}
        {account?.authKind === "key" && (
          <p className="text-xs text-warning">Connected with an access key. Switch to a read-only role (Add account → same account) so no long-lived key is stored.</p>
        )}
        {account?.lastError && <p className="text-xs text-destructive">{account.lastError}</p>}
        {account?.scan?.regions.unscanned.length ? (
          <p className="text-xs text-warning">
            Not scanned this time: {account.scan.regions.unscanned.map((u) => `${u.region} (${u.reason})`).join(", ")}.
          </p>
        ) : null}
      </div>

      {account?.scan ? (
        <>
          <PostureChecks
            key={account.id}
            catalog={AWS_CHECKS}
            areas={AREAS}
            results={account.scan.results}
            vars={{ account: account.accountId }}
            exceptions={view.exceptions}
            canWrite={canWrite}
            emptyText="Nothing failing in this account. 🎉"
          />
          {totalCost > 0 && (
            <p className="text-xs text-muted-foreground">
              Unsupported versions are costing an estimated <strong>${totalCost}/month</strong> in AWS extended-support charges — upgrading removes it.
            </p>
          )}

          {/* Inventory */}
          <section className="card text-xs text-muted-foreground">
            In this account: {account.scan.inventory.instances} instances, {account.scan.inventory.volumes} volumes,{" "}
            {account.scan.inventory.databases} databases, {account.scan.inventory.functions} functions,{" "}
            {account.scan.inventory.tables} DynamoDB tables, {account.scan.inventory.clusters} EKS clusters,{" "}
            {account.scan.inventory.buckets} S3 buckets — filed daily as your asset inventory.
          </section>
        </>
      ) : (
        <p className="card text-sm text-muted-foreground">
          {canWrite ? "Run the first scan to see this account's checks." : "This account hasn't been scanned yet."}
        </p>
      )}

      {/* Settings */}
      {canWrite && (
        <section className="card space-y-4">
          <h2 className="text-sm font-semibold">Settings</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Keep audit logs at least</span>
            <input type="number" min={30} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} className="input w-24" />
            <span>days</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const r = await updateAwsSettings({ logRetentionDays: Number(retention) }).catch(() => ({ error: NETWORK }));
                if ("error" in r && r.error) toast("error", r.error);
                else toast("success", "Saved — applies from the next scan");
              }}
            >
              Save
            </Button>
            <span className="text-xs text-muted-foreground">NIS2 sets no fixed number; 365 days is common.</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Test a restore at least every</span>
            <input type="number" min={30} max={730} value={restoreDays} onChange={(e) => setRestoreDays(e.target.value)} className="input w-24" />
            <span>days</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const r = await updateAwsSettings({ restoreTestDays: Number(restoreDays) }).catch(() => ({ error: NETWORK }));
                if ("error" in r && r.error) toast("error", r.error);
                else toast("success", "Saved — applies from the next scan");
              }}
            >
              Save
            </Button>
            <span className="text-xs text-muted-foreground">Yearly is what most SOC 2 policies say; quarterly is stricter.</span>
          </div>
          {account && <AccountSettings key={account.id} account={account} canWrite={canWrite} />}
        </section>
      )}
    </div>
  );
}
