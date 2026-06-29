"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { updateTrustRequestStatus } from "@/app/actions/trust";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { ListCard, ListRow } from "@/components/ui/ListCard";
import type { TrustAccessRequest } from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

export function TrustRequests({ requests }: { requests: TrustAccessRequest[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  function setStatus(id: string, status: string) {
    start(async () => {
      const res = await updateTrustRequestStatus(id, status).catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Updated");
        router.refresh();
      }
    });
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-[var(--brand-emerald)]" />
        <h2 className="text-sm font-semibold text-foreground">Trust Center access requests</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        People who requested your security package from the public Trust Center.
      </p>

      {requests.length === 0 ? (
        <p className="text-xs text-muted-foreground">No requests yet.</p>
      ) : (
        <ListCard>
          {requests.map((r) => (
            <ListRow key={r.id}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{r.email}</div>
                <div className="text-xs text-muted-foreground">
                  {[r.name, r.requester_company].filter(Boolean).join(" · ") || "—"}
                  {r.message ? ` — ${r.message}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={r.status === "approved" ? "success" : r.status === "declined" ? "critical" : "warning"}>
                  {r.status}
                </Badge>
                {r.status === "new" && (
                  <>
                    <button onClick={() => setStatus(r.id, "approved")} disabled={pending} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary">
                      Approve
                    </button>
                    <button onClick={() => setStatus(r.id, "declined")} disabled={pending} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary">
                      Decline
                    </button>
                  </>
                )}
              </div>
            </ListRow>
          ))}
        </ListCard>
      )}
    </div>
  );
}
