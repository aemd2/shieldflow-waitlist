"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, ExternalLink, CalendarCheck } from "lucide-react";
import { createVendor, updateVendor, deleteVendor, markVendorReviewed } from "@/app/actions/vendors";
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
import {
  VENDOR_RISKS,
  VENDOR_STATUSES,
  VENDOR_SOC2_STATUSES,
  VENDOR_DATA_SENSITIVITY,
} from "@/lib/validation";
import type {
  Vendor,
  VendorRisk,
  VendorStatus,
  VendorSoc2Status,
  VendorDataSensitivity,
} from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

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
const SOC2_LABEL: Record<VendorSoc2Status, string> = {
  none: "No SOC 2",
  requested: "SOC 2 requested",
  on_file: "SOC 2 on file",
};
const SENSITIVITY_LABEL: Record<VendorDataSensitivity, string> = {
  none: "No sensitive data",
  internal: "Internal data",
  pii: "PII",
  phi: "PHI",
};

function reviewDue(v: Vendor): boolean {
  if (v.status === "offboarded" || !v.reviewed_at || !v.review_cadence_months) return false;
  const next = new Date(v.reviewed_at);
  next.setMonth(next.getMonth() + v.review_cadence_months);
  return next < new Date();
}
function soc2Expired(v: Vendor): boolean {
  return v.soc2_status === "on_file" && !!v.soc2_expires_at && new Date(v.soc2_expires_at) < new Date();
}

interface FormState {
  name: string;
  website: string;
  category: string;
  risk_level: VendorRisk;
  status: VendorStatus;
  notes: string;
  contact_email: string;
  review_cadence_months: string;
  soc2_status: VendorSoc2Status;
  soc2_expires_at: string;
  data_sensitivity: VendorDataSensitivity;
}

const EMPTY: FormState = {
  name: "",
  website: "",
  category: "",
  risk_level: "low",
  status: "active",
  notes: "",
  contact_email: "",
  review_cadence_months: "",
  soc2_status: "none",
  soc2_expires_at: "",
  data_sensitivity: "none",
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function VendorManager({ vendors, canWrite = true }: { vendors: Vendor[]; canWrite?: boolean }) {
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
      contact_email: v.contact_email ?? "",
      review_cadence_months: v.review_cadence_months != null ? String(v.review_cadence_months) : "",
      soc2_status: v.soc2_status,
      soc2_expires_at: v.soc2_expires_at ?? "",
      data_sensitivity: v.data_sensitivity,
    });
    setEditing(v.id);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await (editing === "new"
        ? createVendor(form)
        : updateVendor(editing as string, form)
      ).catch(() => ({ error: NETWORK }));
      if (res?.error) {
        toast("error", res.error);
        return;
      }
      toast("success", editing === "new" ? "Vendor added" : "Vendor updated");
      setEditing(null);
      router.refresh();
    });
  }

  function review(id: string) {
    start(async () => {
      const res = await markVendorReviewed(id).catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Marked reviewed");
        router.refresh();
      }
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
      const res = await deleteVendor(id).catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Vendor deleted");
        router.refresh();
      }
    });
  }

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }) as FormState);

  return (
    <ManagerLayout
      toolbar={
        canWrite ? (
          <Button variant="accent" onClick={openNew} disabled={pending} leftIcon={<Plus className="h-4 w-4" />}>
            Add vendor
          </Button>
        ) : undefined
      }
    >
      {editing && (
        <form onSubmit={submit} className="card space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            {editing === "new" ? "New vendor" : "Edit vendor"}
          </h2>
          <FormSection label="Basics">
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
              <Field label="Security contact email">
                <Input type="email" maxLength={254} value={form.contact_email} onChange={(e) => set("contact_email")(e.target.value)} placeholder="security@vendor.com" />
              </Field>
            </div>
          </FormSection>

          <FormSection label="Risk & compliance">
            <div className="grid gap-4 sm:grid-cols-2">
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
              <Field label="Data they process">
                <Select value={form.data_sensitivity} onChange={(e) => set("data_sensitivity")(e.target.value)}>
                  {VENDOR_DATA_SENSITIVITY.map((d) => <option key={d} value={d}>{SENSITIVITY_LABEL[d]}</option>)}
                </Select>
              </Field>
              <Field label="SOC 2 status">
                <Select value={form.soc2_status} onChange={(e) => set("soc2_status")(e.target.value)}>
                  {VENDOR_SOC2_STATUSES.map((s) => <option key={s} value={s}>{SOC2_LABEL[s]}</option>)}
                </Select>
              </Field>
              <Field label="SOC 2 report expires">
                <Input type="date" value={form.soc2_expires_at} onChange={(e) => set("soc2_expires_at")(e.target.value)} disabled={form.soc2_status !== "on_file"} />
              </Field>
            </div>
          </FormSection>

          <FormSection label="Review cadence">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Re-review every (months)" hint="Drives the 'review overdue' alert.">
                <Input type="number" min={1} max={60} value={form.review_cadence_months} onChange={(e) => set("review_cadence_months")(e.target.value)} placeholder="e.g. 12" />
              </Field>
            </div>
          </FormSection>

          <Field label="Notes">
            <Textarea maxLength={2000} rows={3} value={form.notes} onChange={(e) => set("notes")(e.target.value)} placeholder="DPA signed, subprocessor list reviewed, ..." />
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
            {vendors.map((v) => {
              const due = reviewDue(v);
              const expired = soc2Expired(v);
              return (
                <ListRow key={v.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{v.name}</span>
                      <Badge variant={RISK_VARIANT[v.risk_level]}>{v.risk_level}</Badge>
                      <span className="shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[v.status]}</span>
                      {v.soc2_status !== "none" && (
                        <Badge variant={expired ? "critical" : v.soc2_status === "on_file" ? "success" : "warning"}>
                          {expired ? "SOC 2 expired" : SOC2_LABEL[v.soc2_status]}
                        </Badge>
                      )}
                      {(v.data_sensitivity === "pii" || v.data_sensitivity === "phi") && (
                        <Badge variant="info">{SENSITIVITY_LABEL[v.data_sensitivity]}</Badge>
                      )}
                      {due && <Badge variant="warning">Review overdue</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {v.category || "Uncategorized"}
                      {v.reviewed_at && <> · reviewed {v.reviewed_at}</>}
                      {v.review_cadence_months ? <> · every {v.review_cadence_months}mo</> : null}
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
                        <button onClick={() => review(v.id)} className="rounded-md p-2 text-success hover:bg-success-muted" title="Mark reviewed today" disabled={pending}>
                          <CalendarCheck className="h-4 w-4" />
                        </button>
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
              );
            })}
          </ListCard>
        )
      )}
    </ManagerLayout>
  );
}
