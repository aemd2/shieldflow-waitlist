"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, X, MinusCircle, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import {
  WorkspaceLayout,
  SidebarListPanel,
  SidebarListButton,
  WorkspaceDetailEmpty,
} from "@/components/ui/layouts";
import {
  decideAccessItem,
  completeAccessReview,
  deleteAccessReview,
  type RosterProviderInfo,
} from "@/app/actions/access-reviews";
import { AccessReviewCreateForm } from "./AccessReviewCreateForm";
import type { PersonSuggestion } from "./SystemRosterEditor";
import type { AccessReview, AccessReviewItem, AccessReviewSystem, AccessDecision } from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

export function AccessReviewWorkspace({
  reviews,
  systems,
  items,
  canWrite = true,
  rosterProviders = [],
  currentUserEmail = "",
  personnelSuggestions = [],
}: {
  reviews: AccessReview[];
  systems: AccessReviewSystem[];
  items: AccessReviewItem[];
  canWrite?: boolean;
  rosterProviders?: RosterProviderInfo[];
  currentUserEmail?: string;
  personnelSuggestions?: PersonSuggestion[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  // Optimistically hidden after a confirmed delete — the sidebar updates
  // instantly instead of waiting on router.refresh()'s server round-trip.
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const visibleReviews = reviews.filter((r) => !deletedIds.includes(r.id));
  const [selectedId, setSelectedId] = useState<string | null>(reviews[0]?.id ?? null);

  const selected = visibleReviews.find((r) => r.id === selectedId) ?? null;
  const itemsFor = (rid: string) => items.filter((it) => it.review_id === rid);
  const systemsFor = (rid: string) => systems.filter((s) => s.review_id === rid);

  function decide(itemId: string, decision: AccessDecision) {
    start(async () => {
      const res = await decideAccessItem({ id: itemId, decision }).catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else router.refresh();
    });
  }

  function complete(id: string) {
    start(async () => {
      const res = await completeAccessReview(id).catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Review completed — evidence filed");
        router.refresh();
      }
    });
  }

  // Deleting a review is reversible in the UI for a few seconds, so this
  // skips the blocking "are you sure?" modal entirely (best practice for
  // reversible actions — see docs/PREMIUM_GAP_2.md) in favor of an undo
  // toast: hide immediately, only actually call the server if the 5s window
  // passes without the user clicking Undo. Also sidesteps the whole class of
  // bug fixed in 6076a06 (a confirm dialog blocking a shared pending flag).
  function removeReview(id: string) {
    const review = reviews.find((r) => r.id === id);
    if (!review) return;

    setDeletedIds((prev) => [...prev, id]);
    if (selectedId === id) setSelectedId(null);

    let undone = false;
    toast("success", `Deleted "${review.name}"`, {
      label: "Undo",
      onClick: () => {
        undone = true;
        setDeletedIds((prev) => prev.filter((x) => x !== id));
      },
    });

    setTimeout(() => {
      if (undone) return;
      start(async () => {
        const res = await deleteAccessReview(id).catch(() => ({ error: NETWORK }));
        if (res?.error) {
          toast("error", res.error);
          setDeletedIds((prev) => prev.filter((x) => x !== id)); // restore — the delete didn't actually happen
        } else {
          router.refresh();
        }
      });
    }, 5000);
  }

  const selItems = selected ? itemsFor(selected.id) : [];
  const selSystems = selected ? systemsFor(selected.id) : [];
  const decided = selItems.filter((it) => it.decision !== "pending").length;
  const allDecided = selItems.length > 0 && decided === selItems.length;
  const isOpen = selected?.status === "open";

  return (
    <WorkspaceLayout
      header={
        canWrite ? (
          <Button variant="accent" onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" />}>
            New review
          </Button>
        ) : undefined
      }
      sidebar={
        <SidebarListPanel title={`Reviews (${visibleReviews.length})`} isEmpty={visibleReviews.length === 0}>
          {visibleReviews.map((r) => {
            const its = itemsFor(r.id);
            const d = its.filter((it) => it.decision !== "pending").length;
            return (
              <SidebarListButton
                key={r.id}
                selected={selectedId === r.id}
                onClick={() => {
                  setSelectedId(r.id);
                  setCreating(false);
                }}
              >
                <span className="min-w-0 truncate">{r.name}</span>
                {r.status === "completed" ? (
                  <Badge variant="success">Done</Badge>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">{d}/{its.length}</span>
                )}
              </SidebarListButton>
            );
          })}
        </SidebarListPanel>
      }
    >
      {creating && canWrite ? (
        <AccessReviewCreateForm
          rosterProviders={rosterProviders}
          currentUserEmail={currentUserEmail}
          personnelSuggestions={personnelSuggestions}
          onDone={() => setCreating(false)}
          onCreated={(id) => setSelectedId(id)}
        />
      ) : selected ? (
        <div className="space-y-4">
          <div className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{selected.name}</h2>
                <Badge variant={selected.status === "completed" ? "success" : "neutral"}>
                  {selected.status === "completed" ? "Completed" : "In progress"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {selSystems.map((s) => s.name).join(", ") || "No systems"}
                {selected.reviewer_email && <> · reviewer {selected.reviewer_email}</>}
                {" · "}{decided}/{selItems.length} decided
                {selected.completed_at && <> · completed {selected.completed_at.slice(0, 10)}</>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canWrite && isOpen && (
                <Button onClick={() => complete(selected.id)} loading={pending} disabled={!allDecided} leftIcon={<ShieldCheck className="h-4 w-4" />}>
                  Complete &amp; file evidence
                </Button>
              )}
              {canWrite && (
                <button onClick={() => removeReview(selected.id)} className="rounded-md p-2 text-destructive hover:bg-destructive/10" title="Delete review">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {selected.status === "completed" && (
            <Alert variant="success">
              This review is complete and its attestations were filed as evidence (see the Evidence vault).
            </Alert>
          )}

          {selSystems.map((sys) => {
            const sysItems = selItems.filter((it) => it.system_id === sys.id);
            if (sysItems.length === 0) return null;
            return (
              <div key={sys.id} className="card p-0">
                <div className="border-b border-border px-5 py-2.5 text-sm font-semibold text-foreground">
                  {sys.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {sysItems.filter((it) => it.decision !== "pending").length}/{sysItems.length} decided
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {sysItems.map((it) => (
                    <li key={it.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{it.subject}</div>
                        <div className="text-xs text-muted-foreground">{it.access || "—"}</div>
                      </div>
                      {isOpen && canWrite ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => decide(it.id, "keep")}
                            disabled={pending}
                            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${it.decision === "keep" ? "border-success-border bg-success-muted text-success" : "border-border hover:bg-secondary"}`}
                          >
                            <Check className="h-3 w-3" /> Keep
                          </button>
                          <button
                            onClick={() => decide(it.id, "revoke")}
                            disabled={pending}
                            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${it.decision === "revoke" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border hover:bg-secondary"}`}
                          >
                            <X className="h-3 w-3" /> Revoke
                          </button>
                          <button
                            onClick={() => decide(it.id, "out_of_scope")}
                            disabled={pending}
                            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${it.decision === "out_of_scope" ? "border-warning-border bg-warning-muted text-warning" : "border-border hover:bg-secondary"}`}
                          >
                            <MinusCircle className="h-3 w-3" /> Out of scope
                          </button>
                        </div>
                      ) : (
                        <Badge variant={it.decision === "keep" ? "success" : it.decision === "revoke" ? "critical" : it.decision === "out_of_scope" ? "warning" : "neutral"}>
                          {it.decision === "pending" ? "Pending" : it.decision === "keep" ? "Keep" : it.decision === "revoke" ? "Revoke" : "Out of scope"}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <WorkspaceDetailEmpty>
          Select a review, or start one by choosing the systems it covers.
        </WorkspaceDetailEmpty>
      )}
    </WorkspaceLayout>
  );
}
