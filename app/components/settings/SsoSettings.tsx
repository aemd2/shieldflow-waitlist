"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Trash2 } from "lucide-react";
import { addSsoDomain, removeSsoDomain } from "@/app/actions/sso";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ListCard, ListRow } from "@/components/ui/ListCard";
import type { SsoDomain } from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

export function SsoSettings({ domains }: { domains: SsoDomain[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [domain, setDomain] = useState("");

  function add(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await addSsoDomain({ domain }).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      toast("success", "verified" in res && res.verified ? "Domain added & verified" : "Domain added (unverified)");
      setDomain("");
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await removeSsoDomain(id).catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Removed");
        router.refresh();
      }
    });
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-[var(--brand-emerald)]" />
        <h2 className="text-sm font-semibold text-foreground">Single sign-on (SSO)</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Map your company&apos;s email domains. People who sign in with SSO from a{" "}
        <strong>verified</strong> domain auto-join this workspace. Configure the SAML connection
        itself in Supabase Auth — see <code>docs/SSO_SCIM_PLAN.md</code>.
      </p>

      <form onSubmit={add} className="flex gap-2">
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" maxLength={253} />
        <Button type="submit" loading={pending}>Add domain</Button>
      </form>

      {domains.length > 0 && (
        <ListCard>
          {domains.map((d) => (
            <ListRow key={d.id}>
              <span className="flex items-center gap-2 text-sm text-foreground">
                {d.domain}
                {d.verified ? <Badge variant="success">Verified</Badge> : <Badge variant="warning">Unverified</Badge>}
              </span>
              <button onClick={() => remove(d.id)} disabled={pending} className="rounded-md p-2 text-destructive hover:bg-destructive/10" title="Remove">
                <Trash2 className="h-4 w-4" />
              </button>
            </ListRow>
          ))}
        </ListCard>
      )}

      <p className="text-xs text-muted-foreground">
        A domain auto-verifies when it matches the owner&apos;s email domain. Unverified domains
        never auto-join anyone.
      </p>
    </div>
  );
}
