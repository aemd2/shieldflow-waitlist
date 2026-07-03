"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { createTraining, updateTraining, deleteTraining } from "@/app/actions/training";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListCard, ListRow } from "@/components/ui/ListCard";
import { ManagerLayout } from "@/components/ui/layouts";
import { TRAINING_STATUSES } from "@/lib/validation";
import type { TrainingRecord, TrainingStatus } from "@/lib/db/queries";

const STATUS: Record<TrainingStatus, { label: string; variant: BadgeVariant }> = {
  assigned: { label: "Assigned", variant: "warning" },
  in_progress: { label: "In progress", variant: "info" },
  completed: { label: "Completed", variant: "success" },
};

interface FormState {
  person_name: string;
  person_email: string;
  course: string;
  status: TrainingStatus;
  due_date: string;
}

const EMPTY: FormState = {
  person_name: "",
  person_email: "",
  course: "Security Awareness Training",
  status: "assigned",
  due_date: "",
};

function isOverdue(t: TrainingRecord): boolean {
  if (t.status === "completed" || !t.due_date) return false;
  const due = new Date(t.due_date);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

export function TrainingManager({
  records,
  canWrite = true,
}: {
  records: TrainingRecord[];
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
  function openEdit(t: TrainingRecord) {
    setForm({
      person_name: t.person_name,
      person_email: t.person_email ?? "",
      course: t.course,
      status: t.status,
      due_date: t.due_date ?? "",
    });
    setEditing(t.id);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await (editing === "new"
        ? createTraining(form)
        : updateTraining(editing as string, form)
      ).catch(() => ({ error: "Network problem — check your connection and try again." }));
      if (res?.error) {
        toast("error", res.error);
        return;
      }
      toast("success", editing === "new" ? "Training added" : "Training updated");
      setEditing(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const ok = await confirm({
        title: "Delete training record",
        message: "This removes the record permanently.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const res = await deleteTraining(id).catch(() => ({
        error: "Network problem — check your connection and try again.",
      }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Record deleted");
        router.refresh();
      }
    });
  }

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <ManagerLayout
      toolbar={
        canWrite ? (
          <Button variant="accent" onClick={openNew} disabled={pending} leftIcon={<Plus className="h-4 w-4" />}>
            Add training
          </Button>
        ) : undefined
      }
    >
      {editing && (
        <form onSubmit={submit} className="card space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            {editing === "new" ? "New training record" : "Edit training record"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Person" required>
              <Input required maxLength={120} value={form.person_name} onChange={(e) => set("person_name")(e.target.value)} placeholder="e.g. Jordan Lee" />
            </Field>
            <Field label="Email">
              <Input type="email" maxLength={254} value={form.person_email} onChange={(e) => set("person_email")(e.target.value)} placeholder="jordan@company.com" />
            </Field>
            <Field label="Course" required>
              <Input required maxLength={160} value={form.course} onChange={(e) => set("course")(e.target.value)} placeholder="e.g. Security Awareness Training" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Status">
                <Select value={form.status} onChange={(e) => set("status")(e.target.value)}>
                  {TRAINING_STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                </Select>
              </Field>
              <Field label="Due date">
                <Input type="date" value={form.due_date} onChange={(e) => set("due_date")(e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>Save</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {records.length === 0 && !editing ? (
        <EmptyState description="No training records yet. Track who has completed security awareness training — auditors ask for this." />
      ) : (
        records.length > 0 && (
          <ListCard>
            {records.map((t) => {
              const s = STATUS[t.status];
              const overdue = isOverdue(t);
              return (
                <ListRow key={t.id}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{t.person_name}</span>
                      <Badge variant={s.variant}>{s.label}</Badge>
                      {overdue && <Badge variant="critical">Overdue</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.course}
                      {t.due_date && <> · due {t.due_date}</>}
                      {t.completed_date && <> · completed {t.completed_date}</>}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => openEdit(t)} className="rounded-md p-2 hover:bg-secondary" title="Edit" disabled={pending}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => remove(t.id)} className="rounded-md p-2 text-destructive hover:bg-destructive/10" title="Delete" disabled={pending}>
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
    </ManagerLayout>
  );
}
