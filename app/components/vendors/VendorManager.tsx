"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import { createVendor, updateVendor, deleteVendor } from "@/app/actions/vendors";
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
import { VENDOR_RISKS, VENDOR_STATUSES } from "@/lib/validation";
import type { Vendor, VendorRisk, VendorStatus } from "@/lib/db/queries";

const RISK_VARIANT: Record<VendorRisk, BadgeVariant> = {
  low: "success",
  medium: "warning",
  high: "high",
  critical: "critical",
};

const STATUS_LABEL: Record<VendorStatus, string> = {
  active: "Active",
  under_review: "Under review",
  offboarded: "Offboarded",
};

interface FormState {
  name: string;
  website: string;
  category: string;
  risk_level: VendorRisk;
  status: VendorStatus;
  notes: string;
}

const EMPTY: FormState = {
  name: "",
  website: "",
  category: "",
  risk_level: "low",
  status: "active",
  notes: "",
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function VendorManager({
  vendors,
  canWrite = true,
}: {
  vendors: Vendor[];
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
  function openEdit(v: Vendor) {
    setForm({
      name: v.name,
      website: v.website ?? "",
      category: v.category ?? "",
      risk_level: v.risk_level,
      status: v.status,
      notes: v.notes ?? "",
    });
    setEditing(v.id);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await (editing === "new"
        ? createVendor(form)
        : updateVendor(editing as string, form)
      ).catch(() => ({ error: "Network problem — check your connection and try again." }));
      if (res?.error) {
        toast("error", res.error);
        return;
      }
      toast("success", editing === "new" ? "Vendor added" : "Vendor updated");
      setEditing(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const ok = await confirm({
        title: "Delete vendor",
        message: "This removes the vendor from your register. This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const res = await deleteVendor(id).catch(() => ({
        error: "Network problem — check your connection and try again.",
      }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Vendor deleted");
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
            Add vendor
          </Button>
        </div>
      )}

      {editing && (
        <form onSubmit={submit} className="card space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            {editing === "new" ? "New vendor" : "Edit vendor"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input required maxLength={120} value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. AWS" />
            </Field>
            <Field label="Website">
              <Input type="url" maxLength={300} value={form.website} onChange={(e) => set("website")(e.target.value)} placeholder="https://..." />
            </Field>
            <Field label="Category">
              <Input maxLength={80} value={form.category} onChange={(e) => set("category")(e.target.value)} placeholder="e.g. Cloud hosting" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Risk level">
                <Select value={form.risk_level} onChange={(e) => set("risk_level")(e.target.value)}>
                  {VENDOR_RISKS.map((r) => <option key={r} value={r}>{cap(r)}</option>)}
                </Select>
              </Field>
              <Field label="Status">
                <Select value={form.status} onChange={(e) => set("status")(e.target.value)}>
                  {VENDOR_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Select>
              </Field>
            </div>
          </div>
          <Field label="Notes">
            <Textarea maxLength={2000} rows={3} value={form.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="DPA signed, SOC 2 report on file, ..." />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>Save vendor</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {vendors.length === 0 && !editing ? (
        <EmptyState description="No vendors yet. Add the third-party services your company relies on." />
      ) : (
        vendors.length > 0 && (
          <ListCard>
            {vendors.map((v) => (
              <ListRow key={v.id}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{v.name}</span>
                    <Badge variant={RISK_VARIANT[v.risk_level]}>{v.risk_level}</Badge>
                    <span className="shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[v.status]}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {v.category || "Uncategorized"}
                    {v.reviewed_at && <> · reviewed {v.reviewed_at}</>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {v.website && (
                    <a href={v.website} target="_blank" rel="noopener noreferrer" className="rounded-md p-2 hover:bg-secondary" title="Open website">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                  {canWrite && (
                    <>
                      <button onClick={() => openEdit(v)} className="rounded-md p-2 hover:bg-secondary" title="Edit" disabled={pending}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => remove(v.id)} className="rounded-md p-2 text-destructive hover:bg-destructive/10" title="Delete" disabled={pending}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </ListRow>
            ))}
          </ListCard>
        )
      )}
    </div>
  );
}
