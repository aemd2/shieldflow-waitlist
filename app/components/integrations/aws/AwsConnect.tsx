"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { startAwsConnect, connectAwsRole, connectAWS, syncAWS } from "@/app/actions/aws";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

type Start = Awaited<ReturnType<typeof startAwsConnect>>;
type Ready = Extract<Start, { ok: true }>;
type Method = "cloudformation" | "terraform" | "cli";

const NETWORK = "Network problem — check your connection and try again.";

function CodeBlock({ text }: { text: string }) {
  const toast = useToast();
  return (
    <div className="relative">
      <pre className="max-h-72 overflow-auto rounded-md border border-border bg-secondary/50 p-3 text-[11px] leading-relaxed">{text}</pre>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(text).then(() => toast("success", "Copied"))}
        className="absolute right-2 top-2 rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
        title="Copy"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Connect an AWS account with a read-only role. Step 1 shows the workspace's
 * External ID and three ways to create the role; step 2 takes the role ARN. The
 * access-key path stays available underneath for anyone who can't create a role.
 */
export function AwsConnect({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [start, setStart] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("cloudformation");
  const [roleArn, setRoleArn] = useState("");
  const [alias, setAlias] = useState("");
  const [inScope, setInScope] = useState(true);
  const [busy, setBusy] = useState<null | "role" | "key" | "scan">(null);
  const [showKey, setShowKey] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");

  useEffect(() => {
    startAwsConnect()
      .then((r) => ("ok" in r && r.ok ? setStart(r) : setError(("error" in r && r.error) || "Couldn't start.")))
      .catch(() => setError(NETWORK));
  }, []);

  async function firstScan() {
    setBusy("scan");
    const res = await syncAWS().catch(() => ({ error: NETWORK }));
    setBusy(null);
    if ("error" in res && res.error) toast("error", res.error);
    else if ("ok" in res) toast("success", `Scanned: ${res.fail} failing, ${res.pass} passing, ${res.inconclusive} to check`);
    router.refresh();
    onDone?.();
  }

  async function connectRole(e: React.FormEvent) {
    e.preventDefault();
    setBusy("role");
    const res = await connectAwsRole({ roleArn, alias: alias || undefined, inScope }).catch(() => ({ error: NETWORK }));
    setBusy(null);
    if ("error" in res && res.error) return toast("error", res.error);
    toast("success", `Connected account ${"accountId" in res ? res.accountId : ""} — scanning now`);
    setRoleArn("");
    setAlias("");
    await firstScan();
  }

  async function connectKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy("key");
    const res = await connectAWS({ accessKeyId: keyId, secretAccessKey: secret }).catch(() => ({ error: NETWORK }));
    setBusy(null);
    if ("error" in res && res.error) return toast("error", res.error);
    setKeyId("");
    setSecret("");
    toast("success", "Connected — scanning now");
    await firstScan();
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!start) return <p className="text-sm text-muted-foreground">Preparing your connection…</p>;
  if (busy === "scan") return <p className="text-sm text-muted-foreground">Scanning your account — this takes up to a minute…</p>;

  return (
    <div className="space-y-4">
      {start.available ? (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium">1. Create a read-only role in your AWS account</p>
            <p className="text-xs text-muted-foreground">
              AWS&rsquo;s own <code className="font-mono">SecurityAudit</code> policy, plus an explicit deny on reading
              any of your data — objects, rows, secrets, logs. No keys change hands; you&rsquo;ll see ShieldFlow in
              CloudTrail as <code className="font-mono">ShieldFlow-…</code>.
            </p>
            <p className="text-xs text-muted-foreground">
              Your External ID: <code className="font-mono">{start.externalId}</code>
            </p>
          </div>
          <SegmentedControl<Method>
            options={[
              { value: "cloudformation", label: "CloudFormation" },
              { value: "terraform", label: "Terraform" },
              { value: "cli", label: "AWS CLI" },
            ]}
            value={method}
            onChange={setMethod}
          />
          {method === "cloudformation" &&
            (start.quickCreateUrl ? (
              <a href={start.quickCreateUrl} target="_blank" rel="noopener noreferrer" className="btn-accent inline-flex items-center gap-2">
                <ExternalLink className="h-4 w-4" /> Create the role in AWS
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">
                Download <a className="underline" href="/api/aws/role-template" target="_blank">the template</a> and create a
                stack from it with ShieldFlowAccountId <code className="font-mono">{start.scannerAccountId}</code> and
                ExternalId <code className="font-mono">{start.externalId}</code>.
              </p>
            ))}
          {method === "terraform" && start.terraform && <CodeBlock text={start.terraform} />}
          {method === "cli" && start.cli && <CodeBlock text={start.cli} />}

          <form onSubmit={connectRole} className="space-y-2">
            <p className="text-sm font-medium">2. Paste the role ARN</p>
            <input
              value={roleArn}
              onChange={(e) => setRoleArn(e.target.value)}
              placeholder={`arn:aws:iam::123456789012:role/${start.roleName}`}
              required
              className="input font-mono text-xs"
            />
            <div className="flex flex-wrap items-center gap-3">
              <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Name (e.g. production)" className="input max-w-[14rem]" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={inScope} onChange={(e) => setInScope(e.target.checked)} />
                In audit scope
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Out-of-scope accounts (staging, dev) are scanned and shown, but never raise alerts or count toward your
              frameworks.
            </p>
            <Button type="submit" variant="accent" disabled={busy !== null} leftIcon={<ShieldCheck className="h-4 w-4" />}>
              {busy === "role" ? "Checking the role…" : "Connect account"}
            </Button>
          </form>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Role-based connections aren&rsquo;t switched on for this ShieldFlow server yet. Use a read-only access key below
          for now — you can switch to a role later without losing anything.
        </p>
      )}

      <div className="border-t border-border pt-3">
        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowKey((v) => !v)}>
          {showKey || !start.available ? "Connect with an access key instead" : "Can't create a role? Use an access key"}
        </button>
        {(showKey || !start.available) && (
          <form onSubmit={connectKey} className="mt-2 space-y-2">
            <input value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="Access key ID (AKIA…)" required autoComplete="off" className="input" />
            <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Secret access key" required autoComplete="off" className="input" />
            <p className="text-xs text-muted-foreground">
              An IAM user with the AWS-managed <code className="font-mono">SecurityAudit</code> policy. A role is safer —
              no long-lived key leaves your account.
            </p>
            <Button type="submit" variant="outline" disabled={busy !== null}>
              {busy === "key" ? "Verifying…" : "Connect with key"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
