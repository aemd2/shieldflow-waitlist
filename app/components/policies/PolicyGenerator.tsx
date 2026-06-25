"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Download, Save, Trash2, Eye, Pencil } from "lucide-react";
import { Markdown } from "@/components/ui/Markdown";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { createPolicy, savePolicy, deletePolicy } from "@/app/actions/policies";
import { POLICY_TYPES } from "@/lib/validation";
import type { Framework, Policy } from "@/lib/db/queries";

export function PolicyWorkspace({
  frameworks,
  policies,
  aiEnabled,
  canWrite = true,
}: {
  frameworks: Framework[];
  policies: Policy[];
  aiEnabled: boolean;
  canWrite?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [policyType, setPolicyType] = useState<(typeof POLICY_TYPES)[number]>(POLICY_TYPES[0]);
  const [frameworkId, setFrameworkId] = useState<string>(frameworks[0]?.id ?? "");
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<Policy | null>(null);

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
        // 401 mid-session = logged out in another tab; send them back to login.
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
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No policies yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {policies.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setSelected(p)}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-secondary ${
                      selected?.id === p.id ? "bg-secondary" : ""
                    }`}
                  >
                    <span className="min-w-0 truncate">{p.title}</span>
                    <Badge variant={p.status === "final" ? "success" : "neutral"}>{p.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right: editor */}
      <div>
        {selected ? (
          <PolicyEditor key={selected.id} policy={selected} canWrite={canWrite} onChanged={() => router.refresh()} />
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
}: {
  policy: Policy;
  onChanged: () => void;
  canWrite?: boolean;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(policy.title);
  const [body, setBody] = useState(policy.body);
  const [status, setStatus] = useState<Policy["status"]>(policy.status);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await savePolicy({ id: policy.id, title, body, status });
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Saved");
        onChanged();
      }
    });
  }

  function remove() {
    if (!confirm("Delete this policy?")) return;
    start(async () => {
      const res = await deletePolicy(policy.id);
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Deleted");
        onChanged();
      }
    });
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

  return (
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
  );
}
