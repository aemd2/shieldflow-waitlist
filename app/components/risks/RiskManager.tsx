"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { createRisk, updateRisk, deleteRisk } from "@/app/actions/risks";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListCard, ListRow } from "@/components/ui/ListCard";
import { RISK_LEVELS, RISK_STATUSES } from "@/lib/validation";
import type { Risk, RiskLevel, RiskStatus } from "@/lib/db/queries";

const LVL: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };

function severity(l: RiskLevel, i: RiskLevel): { label: string; variant: BadgeVariant } {
  const s = LVL[l] + LVL[i];
  if (s >= 6) return { label: "Critical", variant: "critical" };
  if (s === 5) return { label: "High", variant: "high" };
  if (s === 4) return { label: "Medium", variant: "warning" };
  return { label: "Low", variant: "success" };
}

const STATUS_LABEL: Record<RiskStatus, string> = {
  open: "Open",
  mitigating: "Mitigating",
  accepted: "Accepted",
  closed: "Closed",
};

interface FormState {
  title: string;
  description: string;
  category: string;
  likelihood: RiskLevel;
  impact: RiskLevel;
  status: RiskStatus;
  owner_email: string;
  treatment: string;
}

const EMPTY: FormState = {
  title: "",
  description: "",
  category: "",
  likelihood: "medium",
  impact: "medium",
  status: "open",
  owner_email: "",
  treatment: "",
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function RiskManager({
  risks,
  canWrite = true,
}: {
  risks: Risk[];
  canWrite?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  function openNew() {
    setForm(EMPTY);
    setEditing("new");
  }
  function openEdit(r: Risk) {
    setForm({
      title: r.title,
      description: r.description ?? "",
      category: r.category ?? "",
      likelihood: r.likelihood,
      impact: r.impact,
      status: r.status,
      owner_email: r.owner_email ?? "",
      treatment: r.treatment ?? "",
    });
    setEditing(r.id);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await (editing === "new"
        ? createRisk(form)
        : updateRisk(editing as string, form)
      ).catch(() => ({ error: "Network problem — check your connection and try again." }));
      if (res?.error) {
        toast("error", res.error);
        return;
      }
      toast("success", editing === "new" ? "Risk added" : "Risk updated");
      setEditing(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const ok = await confirm({
        title: "Delete risk",
        message: "This removes the risk from your register. This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const res = await deleteRisk(id).catch(() => ({
        error: "Network problem — check your connection and try again.",
      }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Risk deleted");
        router.refresh();
      }
    });
  }

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <Button variant="accent" onClick={openNew} disabled={pending} leftIcon={<Plus className="h-4 w-4" />}>
            Add risk
          </Button>
        </div>
      )}

      {editing && (
        <form onSubmit={submit} className="card space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            {editing === "new" ? "New risk" : "Edit risk"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" required>
              <Input required maxLength={160} value={form.title} onChange={(e) => set("title")(e.target.value)} placeholder="e.g. Single cloud region — no DR" />
            </Field>
            <Field label="Category">
              <Input maxLength={80} value={form.category} onChange={(e) => set("category")(e.target.value)} placeholder="e.g. Availability" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Likelihood">
                <Select value={form.likelihood} onChange={(e) => set("likelihood")(e.target.value)}>
                  {RISK_LEVELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}
                </Select>
              </Field>
              <Field label="Impact">
                <Select value={form.impact} onChange={(e) => set("impact")(e.target.value)}>
                  {RISK_LEVELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}
                </Select>
              </Field>
              <Field label="Status">
                <Select value={form.status} onChange={(e) => set("status")(e.target.value)}>
                  {RISK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Owner email">
              <Input type="email" maxLength={254} value={form.owner_email} onChange={(e) => set("owner_email")(e.target.value)} placeholder="owner@company.com" />
            </Field>
          </div>
          <Field label="Description">
            <Textarea maxLength={2000} rows={2} value={form.description} onChange={(e) => set("description")(e.target.value)} placeholder="What is the risk?" />
          </Field>
          <Field label="Treatment / mitigation">
            <Textarea maxLength={2000} rows={2} value={form.treatment} onChange={(e) => set("treatment")(e.target.value)} placeholder="How are you reducing it?" />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>Save risk</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {risks.length === 0 && !editing ? (
        <EmptyState description="No risks yet. Log the risks your business is tracking and how you're treating them." />
      ) : (
        risks.length > 0 && (
          <ListCard>
            {risks.map((r) => {
              const sev = severity(r.likelihood, r.impact);
              return (
                <ListRow key={r.id}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{r.title}</span>
                      <Badge variant={sev.variant}>{sev.label}</Badge>
                      <span className="shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[r.status]}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.category || "Uncategorized"} · {cap(r.likelihood)} likelihood / {cap(r.impact)} impact
                      {r.owner_email && <> · {r.owner_email}</>}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => openEdit(r)} className="rounded-md p-2 hover:bg-secondary" title="Edit" disabled={pending}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => remove(r.id)} className="rounded-md p-2 text-destructive hover:bg-destructive/10" title="Delete" disabled={pending}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </ListRow>
              );
            })}
          </ListCard>
        )
      )}
    </div>
  );
}
