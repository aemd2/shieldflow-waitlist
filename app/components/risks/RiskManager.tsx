"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Link2 } from "lucide-react";
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
import { RiskHeatmap } from "@/components/risks/RiskHeatmap";
import { RISK_LEVELS, RISK_STATUSES } from "@/lib/validation";
import { RISK_LIBRARY } from "@/lib/risk-library";
import type { Risk, RiskLevel, RiskStatus, RiskControlLink } from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";
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

export interface RiskControlOption {
  id: string;
  code: string;
  title: string;
}

interface FormState {
  title: string;
  description: string;
  category: string;
  likelihood: RiskLevel;
  impact: RiskLevel;
  residual_likelihood: "" | RiskLevel;
  residual_impact: "" | RiskLevel;
  status: RiskStatus;
  owner_email: string;
  treatment: string;
  controlIds: string[];
}

const EMPTY: FormState = {
  title: "",
  description: "",
  category: "",
  likelihood: "medium",
  impact: "medium",
  residual_likelihood: "",
  residual_impact: "",
  status: "open",
  owner_email: "",
  treatment: "",
  controlIds: [],
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function RiskManager({
  risks,
  canWrite = true,
  controls = [],
  links = [],
}: {
  risks: Risk[];
  canWrite?: boolean;
  controls?: RiskControlOption[];
  links?: RiskControlLink[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const linkedIds = (riskId: string) =>
    links.filter((l) => l.risk_id === riskId).map((l) => l.control_id);

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
      residual_likelihood: r.residual_likelihood ?? "",
      residual_impact: r.residual_impact ?? "",
      status: r.status,
      owner_email: r.owner_email ?? "",
      treatment: r.treatment ?? "",
      controlIds: linkedIds(r.id),
    });
    setEditing(r.id);
  }

  function applyTemplate(idxStr: string) {
    if (!idxStr) return;
    const t = RISK_LIBRARY[Number(idxStr)];
    if (!t) return;
    setForm((f) => ({
      ...f,
      title: t.title,
      category: t.category,
      likelihood: t.likelihood,
      impact: t.impact,
      description: t.description,
      treatment: t.treatment,
    }));
  }

  function toggleControl(id: string) {
    setForm((f) => ({
      ...f,
      controlIds: f.controlIds.includes(id)
        ? f.controlIds.filter((c) => c !== id)
        : [...f.controlIds, id],
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await (editing === "new"
        ? createRisk(form)
        : updateRisk(editing as string, form)
      ).catch(() => ({ error: NETWORK }));
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
      const res = await deleteRisk(id).catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Risk deleted");
        router.refresh();
      }
    });
  }

  const set = (k: keyof FormState) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }) as FormState);

  return (
    <div className="space-y-4">
      <RiskHeatmap risks={risks} />

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

          {editing === "new" && (
            <Field label="Start from the risk library (optional)">
              <Select defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">— Choose a common risk —</option>
                {RISK_LIBRARY.map((t, idx) => (
                  <option key={idx} value={String(idx)}>{t.title}</option>
                ))}
              </Select>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" required>
              <Input required maxLength={160} value={form.title} onChange={(e) => set("title")(e.target.value)} placeholder="e.g. Single cloud region — no DR" />
            </Field>
            <Field label="Category">
              <Input maxLength={80} value={form.category} onChange={(e) => set("category")(e.target.value)} placeholder="e.g. Availability" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">Inherent (before controls)</div>
              <div className="grid grid-cols-2 gap-3">
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
              </div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">Residual (after controls)</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Likelihood">
                  <Select value={form.residual_likelihood} onChange={(e) => set("residual_likelihood")(e.target.value)}>
                    <option value="">— Not set —</option>
                    {RISK_LEVELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}
                  </Select>
                </Field>
                <Field label="Impact">
                  <Select value={form.residual_impact} onChange={(e) => set("residual_impact")(e.target.value)}>
                    <option value="">— Not set —</option>
                    {RISK_LEVELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}
                  </Select>
                </Field>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <Select value={form.status} onChange={(e) => set("status")(e.target.value)}>
                {RISK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </Select>
            </Field>
            <Field label="Owner email">
              <Input type="email" maxLength={254} value={form.owner_email} onChange={(e) => set("owner_email")(e.target.value)} placeholder="owner@company.com" />
            </Field>
          </div>

          <Field label="Mitigating controls" hint="Link the controls that treat this risk — they justify the residual score.">
            {controls.length === 0 ? (
              <p className="text-xs text-muted-foreground">No controls yet — add a framework first.</p>
            ) : (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {controls.map((c) => (
                  <label key={c.id} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={form.controlIds.includes(c.id)}
                      onChange={() => toggleControl(c.id)}
                      className="mt-0.5"
                    />
                    <span><span className="font-medium text-foreground">{c.code}</span> · {c.title}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{form.controlIds.length} linked</p>
          </Field>

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
        <EmptyState description="No risks yet. Add from the library or log your own, and link the controls that treat each one." />
      ) : (
        risks.length > 0 && (
          <ListCard>
            {risks.map((r) => {
              const inh = severity(r.likelihood, r.impact);
              const hasResidual = Boolean(r.residual_likelihood && r.residual_impact);
              const resid = hasResidual
                ? severity(r.residual_likelihood as RiskLevel, r.residual_impact as RiskLevel)
                : null;
              const nLinks = linkedIds(r.id).length;
              return (
                <ListRow key={r.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{r.title}</span>
                      <Badge variant={inh.variant}>{inh.label}</Badge>
                      {resid && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          → <Badge variant={resid.variant}>{resid.label}</Badge>
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[r.status]}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.category || "Uncategorized"}
                      {nLinks > 0 && (
                        <span className="ml-1 inline-flex items-center gap-1">
                          · <Link2 className="h-3 w-3" /> {nLinks} control{nLinks > 1 ? "s" : ""}
                        </span>
                      )}
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
