"use client";

import { useState, useTransition, useOptimistic } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Download, Save, Trash2, Eye, Pencil, ShieldCheck, Send, Check } from "lucide-react";
import { Markdown } from "@/components/ui/Markdown";
import { useToast } from "@/components/ui/Toast";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import {
  createPolicy,
  savePolicy,
  deletePolicy,
  approvePolicy,
  publishPolicy,
  acknowledgePolicy,
} from "@/app/actions/policies";
import { POLICY_TYPES } from "@/lib/validation";
import type { Framework, Policy, PolicyAck } from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

function lifecycle(p: Policy): { label: string; variant: BadgeVariant } {
  if (p.published_at) return { label: "Published", variant: "success" };
  if (p.approved_at) return { label: "Approved", variant: "info" };
  return { label: "Draft", variant: "neutral" };
}

export function PolicyWorkspace({
  frameworks,
  policies,
  aiEnabled,
  canWrite = true,
  canApprove = false,
  isAuditor = false,
  acks,
  memberCount,
  currentUserId,
  initialPolicyId = null,
}: {
  frameworks: Framework[];
  policies: Policy[];
  aiEnabled: boolean;
  canWrite?: boolean;
  canApprove?: boolean;
  isAuditor?: boolean;
  acks: PolicyAck[];
  memberCount: number;
  currentUserId: string;
  /** From ?policy= on /policies — opens the right pane while keeping the list visible. */
  initialPolicyId?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [policyType, setPolicyType] = useState<(typeof POLICY_TYPES)[number]>(POLICY_TYPES[0]);
  const [frameworkId, setFrameworkId] = useState<string>(frameworks[0]?.id ?? "");
  const [generating, setGenerating] = useState(false);
  // Track selection by id (not object) so a policy that doesn't exist yet at
  // click time — like one just generated, arriving via router.refresh() — can
  // still be pre-selected and auto-open once the fresh list lands.
  const [selectedId, setSelectedId] = useState<string | null>(initialPolicyId);

  // Keep the selected policy in sync with refreshed server data (so lifecycle
  // buttons reflect the latest state after an approve/publish/acknowledge).
  const selectedLive = selectedId ? policies.find((p) => p.id === selectedId) ?? null : null;

  function ackedCount(p: Policy): number {
    return acks.filter((a) => a.policy_id === p.id && a.version === p.version).length;
  }
  function iAcknowledged(p: Policy): boolean {
    return acks.some(
      (a) => a.policy_id === p.id && a.version === p.version && a.user_id === currentUserId,
    );
  }

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyType, frameworkId: frameworkId || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = "/login?reason=expired";
          return;
        }
        toast("error", data.error ?? "Generation failed.");
        return;
      }
      const created = await createPolicy({
        title: data.title,
        body: data.body,
        frameworkId: frameworkId || null,
      });
      if (created?.error) {
        toast("error", created.error);
        return;
      }
      // Auto-open the new policy in the editor pane — without this the right
      // side keeps showing the "Select a policy" placeholder and the generate
      // looks like it did nothing.
      if (created?.id) setSelectedId(created.id);
      toast("success", "Policy generated");
      router.refresh();
    } catch {
      toast("error", "Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      {/* Left: generator + list */}
      <div className="space-y-6">
        {canWrite && (
          <div className="card space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Generate a policy</h2>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Policy type</label>
              <select
                value={policyType}
                onChange={(e) => setPolicyType(e.target.value as (typeof POLICY_TYPES)[number])}
                className="input"
              >
                {POLICY_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            {frameworks.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Framework</label>
                <select value={frameworkId} onChange={(e) => setFrameworkId(e.target.value)} className="input">
                  {frameworks.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            )}
            <button onClick={generate} disabled={!aiEnabled || generating} className="btn-primary w-full">
              <Sparkles className="mr-2 h-4 w-4" />
              {generating ? "Generating..." : "Generate with AI"}
            </button>
          </div>
        )}

        <div className="card p-0">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
            Your policies ({policies.length})
          </div>
          {policies.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">No policies yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {policies.map((p) => {
                const lc = lifecycle(p);
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => setSelectedId(p.id)}
                      className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-secondary ${
                        selectedLive?.id === p.id ? "bg-secondary" : ""
                      }`}
                    >
                      <span className="min-w-0 truncate">{p.title}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {p.published_at && (
                          <span className="text-xs text-muted-foreground">
                            {ackedCount(p)}/{memberCount}
                          </span>
                        )}
                        <Badge variant={lc.variant}>{lc.label}</Badge>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Right: editor */}
      <div>
        {selectedLive ? (
          <PolicyEditor
            key={`${selectedLive.id}-${selectedLive.version}`}
            policy={selectedLive}
            canWrite={canWrite}
            canApprove={canApprove}
            isAuditor={isAuditor}
            acked={ackedCount(selectedLive)}
            memberCount={memberCount}
            mine={iAcknowledged(selectedLive)}
            onChanged={() => router.refresh()}
          />
        ) : (
          <div className="card flex h-full min-h-64 items-center justify-center text-sm text-muted-foreground">
            Select a policy to view or edit, or generate a new one.
          </div>
        )}
      </div>
    </div>
  );
}

function PolicyEditor({
  policy,
  onChanged,
  canWrite = true,
  canApprove = false,
  isAuditor = false,
  acked,
  memberCount,
  mine,
}: {
  policy: Policy;
  onChanged: () => void;
  canWrite?: boolean;
  canApprove?: boolean;
  isAuditor?: boolean;
  acked: number;
  memberCount: number;
  mine: boolean;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(policy.title);
  const [body, setBody] = useState(policy.body);
  const [status, setStatus] = useState<Policy["status"]>(policy.status);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [pending, start] = useTransition();

  // Optimistic lifecycle state — the button reflects the new state the instant
  // it's clicked instead of waiting on the round trip + router.refresh(), which
  // otherwise has a visible gap where the old button is still showing (and
  // still clickable), inviting repeat clicks. React reconciles this back to the
  // real `policy`/`mine`/`acked` props once fresh data lands, and rolls it back
  // automatically if the action errors.
  const [optimisticPolicy, setOptimisticPolicy] = useOptimistic(
    policy,
    (state, patch: Partial<Pick<Policy, "approved_at" | "published_at">>) => ({ ...state, ...patch }),
  );
  const [optimisticAck, setOptimisticAck] = useOptimistic(
    { mine, acked },
    (state, _action: true) => ({ mine: true, acked: state.mine ? state.acked : state.acked + 1 }),
  );

  function run(fn: () => Promise<{ error?: string } | undefined>, ok: string) {
    start(async () => {
      const res = await fn().catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", ok);
        onChanged();
      }
    });
  }

  function approve() {
    start(async () => {
      setOptimisticPolicy({ approved_at: new Date().toISOString() });
      const res = await approvePolicy(policy.id).catch(() => ({ error: NETWORK }));
      if (res?.error) { toast("error", res.error); return; }
      toast("success", "Policy approved");
      onChanged();
    });
  }
  function publish() {
    start(async () => {
      setOptimisticPolicy({ published_at: new Date().toISOString() });
      const res = await publishPolicy(policy.id).catch(() => ({ error: NETWORK }));
      if (res?.error) { toast("error", res.error); return; }
      toast("success", "Published for acknowledgement");
      onChanged();
    });
  }
  function acknowledge() {
    start(async () => {
      setOptimisticAck(true);
      const res = await acknowledgePolicy(policy.id).catch(() => ({ error: NETWORK }));
      if (res?.error) { toast("error", res.error); return; }
      toast("success", "Acknowledged");
      onChanged();
    });
  }

  function save() {
    run(() => savePolicy({ id: policy.id, title, body, status }), "Saved");
  }
  function remove() {
    if (!confirm("Delete this policy?")) return;
    run(() => deletePolicy(policy.id), "Deleted");
  }
  function download() {
    const blob = new Blob([body], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w.-]+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const fullyAcked = memberCount > 0 && optimisticAck.acked >= memberCount;

  return (
    <div className="space-y-4">
      {/* Approval & acknowledgement — surfaced first so the action needed (Approve /
          Publish / Acknowledge) is immediately visible, never buried below a long
          policy body. */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4" /> Approval &amp; acknowledgement
          </h3>
          <Badge variant={lifecycle(optimisticPolicy).variant}>
            {lifecycle(optimisticPolicy).label} · v{optimisticPolicy.version}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          {optimisticPolicy.published_at
            ? `Published. ${optimisticAck.acked} of ${memberCount} team member${memberCount === 1 ? "" : "s"} acknowledged this version.`
            : optimisticPolicy.approved_at
              ? "Approved — publish it to request acknowledgements from the team."
              : "Draft — an owner or admin approves it, then publishes it for the team to acknowledge."}
        </p>

        {optimisticPolicy.published_at && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full transition-all ${fullyAcked ? "bg-[var(--brand-emerald)]" : "bg-amber-500"}`}
              style={{ width: `${memberCount > 0 ? Math.min(100, Math.round((optimisticAck.acked / memberCount) * 100)) : 0}%` }}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {canApprove && !optimisticPolicy.approved_at && (
            <button onClick={approve} disabled={pending} className="btn-primary text-xs">
              <ShieldCheck className="mr-1 h-3 w-3" /> Approve
            </button>
          )}
          {canApprove && optimisticPolicy.approved_at && !optimisticPolicy.published_at && (
            <button onClick={publish} disabled={pending} className="btn-primary text-xs">
              <Send className="mr-1 h-3 w-3" /> Publish for acknowledgement
            </button>
          )}
          {/* Acknowledgement is an internal-workforce attestation — auditors are
              external reviewers and never acknowledge, so neither branch applies. */}
          {optimisticPolicy.published_at && !isAuditor && (
            optimisticAck.mine ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <Check className="h-4 w-4" /> You acknowledged this version
              </span>
            ) : (
              <button onClick={acknowledge} disabled={pending} className="btn-accent text-xs">
                <Check className="mr-1 h-3 w-3" /> I acknowledge this policy
              </button>
            )
          )}
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {canWrite ? (
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input max-w-md font-medium" />
          ) : (
            <h2 className="max-w-md truncate text-sm font-medium text-foreground">{title}</h2>
          )}
          <div className="flex items-center gap-1">
            {canWrite && (
              <button
                onClick={() => setMode(mode === "preview" ? "edit" : "preview")}
                className="btn-outline text-xs"
              >
                {mode === "preview" ? <><Pencil className="mr-1 h-3 w-3" />Edit</> : <><Eye className="mr-1 h-3 w-3" />Preview</>}
              </button>
            )}
            <button onClick={download} className="btn-outline text-xs"><Download className="mr-1 h-3 w-3" />.md</button>
            {canWrite && (
              <button onClick={remove} disabled={pending} className="rounded-md p-2 text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {mode === "preview" ? (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-background p-4">
            <Markdown content={body} />
          </div>
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={22}
            className="input resize-y font-mono text-xs"
          />
        )}

        {canWrite ? (
          <div className="flex items-center justify-between border-t border-border pt-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as Policy["status"])} className="input w-auto py-1.5">
                <option value="draft">Draft</option>
                <option value="final">Final</option>
              </select>
            </label>
            <button onClick={save} disabled={pending} className="btn-primary">
              <Save className="mr-2 h-4 w-4" />
              {pending ? "Saving..." : "Save"}
            </button>
          </div>
        ) : (
          <div className="border-t border-border pt-4 text-xs text-muted-foreground">
            Status: {status === "final" ? "Final" : "Draft"} · read-only
          </div>
        )}
      </div>
    </div>
  );
}
