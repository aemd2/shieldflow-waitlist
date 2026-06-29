"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Server } from "lucide-react";
import { createSubprocessor, updateSubprocessor, deleteSubprocessor } from "@/app/actions/trust";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { ListCard, ListRow } from "@/components/ui/ListCard";
import type { Subprocessor } from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

interface FormState {
  name: string;
  purpose: string;
  location: string;
  url: string;
}
const EMPTY: FormState = { name: "", purpose: "", location: "", url: "" };

export function SubprocessorManager({ subprocessors }: { subprocessors: Subprocessor[] }) {
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
  function openEdit(s: Subprocessor) {
    setForm({ name: s.name, purpose: s.purpose ?? "", location: s.location ?? "", url: s.url ?? "" });
    setEditing(s.id);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await (editing === "new"
        ? createSubprocessor(form)
        : updateSubprocessor(editing as string, form)
      ).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      toast("success", editing === "new" ? "Subprocessor added" : "Updated");
      setEditing(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const ok = await confirm({ title: "Delete subprocessor", message: "This removes it from your public Trust Center.", confirmLabel: "Delete", danger: true });
      if (!ok) return;
      const res = await deleteSubprocessor(id).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      toast("success", "Deleted");
      router.refresh();
    });
  }

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-[var(--brand-emerald)]" />
          <h2 className="text-sm font-semibold text-foreground">Subprocessors</h2>
        </div>
        <Button variant="outline" onClick={openNew} disabled={pending} leftIcon={<Plus className="h-4 w-4" />}>
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The third parties that process customer data on your behalf — shown publicly on your Trust Center.
      </p>

      {editing && (
        <form onSubmit={submit} className="space-y-3 rounded-md border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required>
              <Input required maxLength={120} value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Amazon Web Services" />
            </Field>
            <Field label="Purpose">
              <Input maxLength={200} value={form.purpose} onChange={(e) => set("purpose")(e.target.value)} placeholder="Cloud hosting" />
            </Field>
            <Field label="Location">
              <Input maxLength={120} value={form.location} onChange={(e) => set("location")(e.target.value)} placeholder="US / EU" />
            </Field>
            <Field label="Website">
              <Input type="url" maxLength={300} value={form.url} onChange={(e) => set("url")(e.target.value)} placeholder="https://..." />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>Save</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {subprocessors.length > 0 && (
        <ListCard>
          {subprocessors.map((s) => (
            <ListRow key={s.id}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{s.name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.purpose || "—"}{s.location ? ` · ${s.location}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => openEdit(s)} className="rounded-md p-2 hover:bg-secondary" title="Edit" disabled={pending}>
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => remove(s.id)} className="rounded-md p-2 text-destructive hover:bg-destructive/10" title="Delete" disabled={pending}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </ListRow>
          ))}
        </ListCard>
      )}
    </div>
  );
}
