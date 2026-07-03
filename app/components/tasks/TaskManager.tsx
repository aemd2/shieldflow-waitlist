"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Pencil, Trash2, Check, RotateCw, Link2 } from "lucide-react";
import { createTask, updateTask, deleteTask, completeTask } from "@/app/actions/tasks";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { FormSection } from "@/components/ui/FormSection";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListCard, ListRow } from "@/components/ui/ListCard";
import { ManagerLayout } from "@/components/ui/layouts";
import { TASK_STATUSES, TASK_PRIORITIES, TASK_RECURRENCE } from "@/lib/validation";
import type { Task, TaskPriority, TaskStatus, TaskRecurrence, TeamMember } from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

const PRIORITY_VARIANT: Record<TaskPriority, BadgeVariant> = {
  low: "neutral",
  medium: "warning",
  high: "high",
};
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};
const RECURRENCE_LABEL: Record<TaskRecurrence, string> = {
  none: "One-off",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

export type TaskLinkType = "control" | "risk" | "vendor" | "policy";
export interface Linkable {
  type: TaskLinkType;
  id: string;
  label: string;
}
const LINK_GROUP_LABEL: Record<TaskLinkType, string> = {
  control: "Controls",
  risk: "Risks",
  vendor: "Vendors",
  policy: "Policies",
};

interface FormState {
  title: string;
  description: string;
  assignee_email: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string;
  recurrence: TaskRecurrence;
  linked_type: TaskLinkType | "";
  linked_id: string;
}

const EMPTY: FormState = {
  title: "",
  description: "",
  assignee_email: "",
  priority: "medium",
  status: "todo",
  due_date: "",
  recurrence: "none",
  linked_type: "",
  linked_id: "",
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function isOverdue(t: Task): boolean {
  if (t.status === "done" || !t.due_date) return false;
  const due = new Date(`${t.due_date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

export function TaskManager({
  tasks,
  canWrite = true,
  members = [],
  linkables = [],
}: {
  tasks: Task[];
  canWrite?: boolean;
  members?: TeamMember[];
  linkables?: Linkable[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const active = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  const linkableByKey = new Map(linkables.map((l) => [`${l.type}:${l.id}`, l]));

  function openNew() {
    setForm(EMPTY);
    setEditing("new");
  }
  function openEdit(t: Task) {
    setForm({
      title: t.title,
      description: t.description ?? "",
      assignee_email: t.assignee_email ?? "",
      priority: t.priority,
      status: t.status,
      due_date: t.due_date ?? "",
      recurrence: t.recurrence,
      linked_type: (t.linked_type as TaskLinkType | null) ?? "",
      linked_id: t.linked_id ?? "",
    });
    setEditing(t.id);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await (editing === "new"
        ? createTask(form)
        : updateTask(editing as string, form)
      ).catch(() => ({ error: NETWORK }));
      if (res?.error) {
        toast("error", res.error);
        return;
      }
      toast("success", editing === "new" ? "Task added" : "Task updated");
      setEditing(null);
      router.refresh();
    });
  }

  function complete(id: string) {
    start(async () => {
      const res = await completeTask(id).catch(
        () => ({ error: NETWORK }) as Awaited<ReturnType<typeof completeTask>>,
      );
      if (res?.error) toast("error", res.error);
      else {
        toast(
          "success",
          res.nextDue
            ? `Task completed — "${res.title}" repeats, next due ${res.nextDue}`
            : "Task completed",
        );
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      const ok = await confirm({
        title: "Delete task",
        message: "This removes the task. This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const res = await deleteTask(id).catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Task deleted");
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
            Add task
          </Button>
        ) : undefined
      }
    >
      {editing && (
        <form onSubmit={submit} className="card space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            {editing === "new" ? "New task" : "Edit task"}
          </h2>
          <FormSection label="Basics">
            <Field label="Title" required>
              <Input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => set("title")(e.target.value)}
                placeholder="e.g. Quarterly access review"
              />
            </Field>
            <Field label="Assignee">
              <Select value={form.assignee_email} onChange={(e) => set("assignee_email")(e.target.value)}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.email}>
                    {m.email} ({m.role})
                  </option>
                ))}
                {/* A prior assignee who's no longer on the team — keep it selectable so
                    editing the task doesn't silently reassign it out from under you. */}
                {form.assignee_email && !members.some((m) => m.email === form.assignee_email) && (
                  <option value={form.assignee_email}>{form.assignee_email} (no longer on team)</option>
                )}
              </Select>
            </Field>
            <Field label="Description">
              <Textarea
                maxLength={2000}
                rows={2}
                value={form.description}
                onChange={(e) => set("description")(e.target.value)}
                placeholder="What needs to be done?"
              />
            </Field>
            <Field label="Link to" hint="Ties this task to the control, risk, vendor, or policy it remediates.">
              <Select
                value={form.linked_type && form.linked_id ? `${form.linked_type}:${form.linked_id}` : ""}
                onChange={(e) => {
                  const [type, linkId] = e.target.value.split(":") as [TaskLinkType | "", string];
                  setForm((f) => ({ ...f, linked_type: type, linked_id: type ? linkId : "" }));
                }}
              >
                <option value="">Not linked</option>
                {(["control", "risk", "vendor", "policy"] as const).map((type) => {
                  const items = linkables.filter((l) => l.type === type);
                  if (items.length === 0) return null;
                  return (
                    <optgroup key={type} label={LINK_GROUP_LABEL[type]}>
                      {items.map((l) => (
                        <option key={l.id} value={`${l.type}:${l.id}`}>{l.label}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </Select>
            </Field>
          </FormSection>

          <FormSection label="Schedule">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Due date">
                <Input type="date" value={form.due_date} onChange={(e) => set("due_date")(e.target.value)} />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Priority">
                  <Select value={form.priority} onChange={(e) => set("priority")(e.target.value)}>
                    {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={form.status} onChange={(e) => set("status")(e.target.value)}>
                    {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </Select>
                </Field>
                <Field label="Repeats">
                  <Select value={form.recurrence} onChange={(e) => set("recurrence")(e.target.value)}>
                    {TASK_RECURRENCE.map((r) => <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>)}
                  </Select>
                </Field>
              </div>
            </div>
          </FormSection>
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>Save task</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {tasks.length === 0 && !editing ? (
        <EmptyState description="No tasks yet. Track remediation work and recurring obligations (access reviews, pen tests, policy reviews) here." />
      ) : (
        <>
          {active.length > 0 && (
            <ListCard>
              {active.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  canWrite={canWrite}
                  pending={pending}
                  linked={t.linked_type && t.linked_id ? linkableByKey.get(`${t.linked_type}:${t.linked_id}`) : undefined}
                  onComplete={() => complete(t.id)}
                  onEdit={() => openEdit(t)}
                  onRemove={() => remove(t.id)}
                />
              ))}
            </ListCard>
          )}

          {done.length > 0 && (
            <details className="card p-0">
              <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-muted-foreground">
                Completed ({done.length})
              </summary>
              <ul className="divide-y divide-border border-t border-border">
                {done.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    canWrite={canWrite}
                    pending={pending}
                    linked={t.linked_type && t.linked_id ? linkableByKey.get(`${t.linked_type}:${t.linked_id}`) : undefined}
                    onComplete={() => {}}
                    onEdit={() => openEdit(t)}
                    onRemove={() => remove(t.id)}
                  />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </ManagerLayout>
  );
}

function TaskRow({
  task,
  canWrite,
  pending,
  linked,
  onComplete,
  onEdit,
  onRemove,
}: {
  task: Task;
  canWrite: boolean;
  pending: boolean;
  linked?: Linkable;
  onComplete: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const overdue = isOverdue(task);
  return (
    <ListRow>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`truncate text-sm font-medium ${task.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}`}
          >
            {task.title}
          </span>
          <Badge variant={PRIORITY_VARIANT[task.priority]}>{task.priority}</Badge>
          {task.recurrence !== "none" && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <RotateCw className="h-3 w-3" />
              {RECURRENCE_LABEL[task.recurrence]}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {STATUS_LABEL[task.status]}
          {task.due_date && (
            <>
              {" · "}
              <span className={overdue ? "font-medium text-destructive" : ""}>
                {overdue ? "Overdue " : "Due "}
                {task.due_date}
              </span>
            </>
          )}
          {task.assignee_email && <> · {task.assignee_email}</>}
          {linked && (
            <>
              {" · "}
              <span className="inline-flex items-center gap-1">
                <Link2 className="h-3 w-3" />
                {linked.type === "control" ? (
                  <Link href={`/controls/${linked.id}`} className="underline hover:text-foreground">
                    {linked.label}
                  </Link>
                ) : (
                  <span>{LINK_GROUP_LABEL[linked.type].replace(/s$/, "")}: {linked.label}</span>
                )}
              </span>
            </>
          )}
        </div>
      </div>
      {canWrite && (
        <div className="flex shrink-0 items-center gap-1">
          {task.status !== "done" && (
            <button
              onClick={onComplete}
              disabled={pending}
              className="rounded-md p-2 text-success hover:bg-success-muted"
              title="Mark complete"
            >
              <Check className="h-4 w-4" />
            </button>
          )}
          <button onClick={onEdit} disabled={pending} className="rounded-md p-2 hover:bg-secondary" title="Edit">
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onRemove}
            disabled={pending}
            className="rounded-md p-2 text-destructive hover:bg-destructive/10"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </ListRow>
  );
}
