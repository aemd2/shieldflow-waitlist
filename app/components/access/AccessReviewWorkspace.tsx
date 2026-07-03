"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, X, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import {
  WorkspaceLayout,
  SidebarListPanel,
  SidebarListButton,
  WorkspaceDetailEmpty,
} from "@/components/ui/layouts";
import {
  createAccessReview,
  decideAccessItem,
  completeAccessReview,
  deleteAccessReview,
} from "@/app/actions/access-reviews";
import type { AccessReview, AccessReviewItem, AccessDecision } from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

/** Parse a pasted "subject — access" line into its parts (em-dash, pipe, spaced
 * hyphen, or comma separate the two; anything else is all subject). */
function parseSubject(line: string): { subject: string; access: string } {
  for (const sep of [" — ", " | ", " - ", ","]) {
    const i = line.indexOf(sep);
    if (i >= 0) return { subject: line.slice(0, i).trim(), access: line.slice(i + sep.length).trim() };
  }
  return { subject: line.trim(), access: "" };
}

export function AccessReviewWorkspace({
  reviews,
  items,
  canWrite = true,
}: {
  reviews: AccessReview[];
  items: AccessReviewItem[];
  canWrite?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [subjectsText, setSubjectsText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(reviews[0]?.id ?? null);

  const selected = reviews.find((r) => r.id === selectedId) ?? null;
  const itemsFor = (rid: string) => items.filter((it) => it.review_id === rid);

  function create() {
    const subjects = subjectsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map(parseSubject);
    if (name.trim().length < 2) return toast("error", "Give the review a name.");
    if (subjects.length === 0) return toast("error", "Paste at least one person/account (one per line).");
    start(async () => {
      const res = await createAccessReview({ name, source, reviewer_email: reviewer, subjects }).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      toast("success", "Access review created");
      setName(""); setSource(""); setReviewer(""); setSubjectsText(""); setCreating(false);
      if ("id" in res && res.id) setSelectedId(res.id);
      router.refresh();
    });
  }

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

  function removeReview(id: string) {
    start(async () => {
      const ok = await confirm({
        title: "Delete access review",
        message: "This removes the review and its rows. This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const res = await deleteAccessReview(id).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      toast("success", "Deleted");
      if (selectedId === id) setSelectedId(null);
      router.refresh();
    });
  }

  const selItems = selected ? itemsFor(selected.id) : [];
  const decided = selItems.filter((it) => it.decision !== "pending").length;
  const allDecided = selItems.length > 0 && decided === selItems.length;
  const isOpen = selected?.status === "open";

  return (
    <WorkspaceLayout
      header={
        canWrite ? (
          <Button variant="accent" onClick={() => setCreating((v) => !v)} leftIcon={<Plus className="h-4 w-4" />}>
            New review
          </Button>
        ) : undefined
      }
      sidebar={
        <>
          {creating && canWrite && (
            <div className="card space-y-3">
              <Field label="Name" required>
                <Input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} placeholder="Q3 access review" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Source">
                  <Input value={source} maxLength={80} onChange={(e) => setSource(e.target.value)} placeholder="Okta / Google / Manual" />
                </Field>
                <Field label="Reviewer">
                  <Input type="email" value={reviewer} maxLength={254} onChange={(e) => setReviewer(e.target.value)} placeholder="you@co.com" />
                </Field>
              </div>
              <Field label="People / accounts" hint="One per line: email — access level.">
                <Textarea rows={6} value={subjectsText} onChange={(e) => setSubjectsText(e.target.value)} placeholder={"alice@acme.com — Admin\nbob@acme.com — Member\nci-bot — Deploy key"} />
              </Field>
              <Button onClick={create} loading={pending} fullWidth>Create review</Button>
            </div>
          )}

          <SidebarListPanel title={`Reviews (${reviews.length})`} isEmpty={reviews.length === 0}>
            {reviews.map((r) => {
              const its = itemsFor(r.id);
              const d = its.filter((it) => it.decision !== "pending").length;
              return (
                <SidebarListButton key={r.id} selected={selectedId === r.id} onClick={() => setSelectedId(r.id)}>
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
        </>
      }
    >
      {selected ? (
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
                  {selected.source ?? "Manual"}
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
                  <button onClick={() => removeReview(selected.id)} disabled={pending} className="rounded-md p-2 text-destructive hover:bg-destructive/10" title="Delete review">
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

            <div className="card p-0">
              <ul className="divide-y divide-border">
                {selItems.map((it) => (
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
                      </div>
                    ) : (
                      <Badge variant={it.decision === "keep" ? "success" : it.decision === "revoke" ? "critical" : "neutral"}>
                        {it.decision === "pending" ? "Pending" : it.decision === "keep" ? "Keep" : "Revoke"}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <WorkspaceDetailEmpty>
            Select a review, or start one from a pasted list of people and their access.
          </WorkspaceDetailEmpty>
        )}
    </WorkspaceLayout>
  );
}
