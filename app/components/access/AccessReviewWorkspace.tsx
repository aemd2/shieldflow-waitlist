"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, X, ShieldCheck, Download } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
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
  pullRosterFrom,
  type RosterProvider,
} from "@/app/actions/access-reviews";
import type { AccessReview, AccessReviewItem, AccessDecision } from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

export interface RosterProviderInfo {
  provider: RosterProvider;
  label: string;
}

/** Parse a pasted "subject — access" line into its parts (em-dash, pipe, spaced
 * hyphen, or comma separate the two; anything else is all subject). */
function parseSubject(line: string): { subject: string; access: string } {
  for (const sep of [" — ", " | ", " - ", ","]) {
    const i = line.indexOf(sep);
    if (i >= 0) return { subject: line.slice(0, i).trim(), access: line.slice(i + sep.length).trim() };
  }
  return { subject: line.trim(), access: "" };
}

/** "Q3 2026 access review" — a sensible starting point, not a requirement. */
function defaultReviewName(): string {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  return `Q${quarter} ${now.getFullYear()} access review`;
}

export function AccessReviewWorkspace({
  reviews,
  items,
  canWrite = true,
  rosterProviders = [],
  currentUserEmail = "",
}: {
  reviews: AccessReview[];
  items: AccessReviewItem[];
  canWrite?: boolean;
  rosterProviders?: RosterProviderInfo[];
  currentUserEmail?: string;
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
  const [pullingFrom, setPullingFrom] = useState<RosterProvider | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(reviews[0]?.id ?? null);

  const selected = reviews.find((r) => r.id === selectedId) ?? null;
  const itemsFor = (rid: string) => items.filter((it) => it.review_id === rid);

  function openCreate() {
    setCreating((v) => {
      const opening = !v;
      if (opening) {
        setName((n) => n || defaultReviewName());
        setReviewer((r) => r || currentUserEmail);
      }
      return opening;
    });
  }

  function pullFrom(providerInfo: RosterProviderInfo) {
    setPullingFrom(providerInfo.provider);
    start(async () => {
      const res = await pullRosterFrom(providerInfo.provider).catch(() => ({ error: NETWORK }));
      setPullingFrom(null);
      if (!res || "error" in res) {
        toast("error", res?.error ?? NETWORK);
        return;
      }
      const lines = res.rows.map((r) => `${r.subject} — ${r.access}`).join("\n");
      setSubjectsText((prev) => (prev.trim() ? `${prev}\n${lines}` : lines));
      setSource((s) => s || providerInfo.label);
      toast("success", `Pulled ${res.rows.length} ${res.rows.length === 1 ? "person" : "people"} from ${providerInfo.label}`);
    });
  }

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
          <Button variant="accent" onClick={openCreate} leftIcon={<Plus className="h-4 w-4" />}>
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
                  <Select value={source} onChange={(e) => setSource(e.target.value)}>
                    <option value="">Manual</option>
                    {rosterProviders.map((p) => (
                      <option key={p.provider} value={p.label}>{p.label}</option>
                    ))}
                    <option value="Other">Other</option>
                  </Select>
                </Field>
                <Field label="Reviewer">
                  <Input type="email" value={reviewer} maxLength={254} onChange={(e) => setReviewer(e.target.value)} placeholder="you@co.com" />
                </Field>
              </div>
              <Field
                label="People / accounts"
                hint="One per line: email — access level. Pull a real roster below instead of typing it by hand."
              >
                <Textarea rows={6} value={subjectsText} onChange={(e) => setSubjectsText(e.target.value)} placeholder={"alice@acme.com — Admin\nbob@acme.com — Member\nci-bot — Deploy key"} />
              </Field>
              {rosterProviders.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {rosterProviders.map((p) => (
                    <Button
                      key={p.provider}
                      type="button"
                      variant="outline"
                      onClick={() => pullFrom(p)}
                      loading={pullingFrom === p.provider}
                      disabled={pending && pullingFrom !== p.provider}
                      leftIcon={<Download className="h-3.5 w-3.5" />}
                    >
                      Pull from {p.label}
                    </Button>
                  ))}
                </div>
              )}
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
