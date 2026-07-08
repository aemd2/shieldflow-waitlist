"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import {
  createPerson,
  updatePerson,
  offboardPerson,
  reactivatePerson,
  deletePerson,
} from "@/app/actions/personnel";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { FormSection } from "@/components/ui/FormSection";
import { Input } from "@/components/ui/Input";
import { Typeahead } from "@/components/ui/Typeahead";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListCard, ListRow } from "@/components/ui/ListCard";
import { ManagerLayout } from "@/components/ui/layouts";
import { PersonnelBulkAdd } from "./PersonnelBulkAdd";
import type { RosterProviderInfo } from "@/app/actions/access-reviews";
import type { Person, TrainingRecord } from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

/** Common titles offered as type-ahead suggestions in the Role field — titles
 * already used in this workspace's roster are merged in ahead of these, so a
 * team's own naming convention wins. Free text always allowed. */
const COMMON_ROLES = [
  "Engineer", "Senior Engineer", "Staff Engineer", "Engineering Manager",
  "Frontend Engineer", "Backend Engineer", "Full-stack Engineer",
  "DevOps Engineer", "Security Engineer", "QA Engineer", "Data Engineer",
  "CTO", "CEO", "COO", "CFO", "CISO",
  "Product Manager", "Product Designer", "Designer", "UX Researcher",
  "Data Analyst", "Data Scientist",
  "Customer Success Manager", "Support Engineer", "Account Executive",
  "Sales Manager", "Marketing Manager", "Content Manager",
  "HR Manager", "People Ops", "Recruiter", "Office Manager",
  "Finance Manager", "Legal Counsel", "Compliance Manager",
  "IT Administrator", "Intern", "Contractor",
];

interface FormState {
  name: string;
  email: string;
  role_title: string;
  started_at: string;
}
const EMPTY: FormState = { name: "", email: "", role_title: "", started_at: "" };

export function PersonnelManager({
  people,
  training = [],
  canWrite = true,
  rosterProviders = [],
  currentUserEmail = "",
}: {
  people: Person[];
  training?: TrainingRecord[];
  canWrite?: boolean;
  rosterProviders?: RosterProviderInfo[];
  currentUserEmail?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const active = people.filter((p) => p.status === "active");
  const offboarded = people.filter((p) => p.status === "offboarded");

  // Role suggestions: this workspace's own titles first, then the common list.
  const roleOptions = useMemo(() => {
    const existing = Array.from(
      new Set(people.map((p) => p.role_title).filter((r): r is string => Boolean(r))),
    );
    const merged = [
      ...existing,
      ...COMMON_ROLES.filter((r) => !existing.some((e) => e.toLowerCase() === r.toLowerCase())),
    ];
    return merged.map((r) => ({ value: r }));
  }, [people]);

  // Email domains: this company's own roster first (most frequent, so a real
  // company domain always outranks a personal one), then the signed-in
  // user's domain, then a handful of common providers as a baseline — so a
  // near-empty roster still offers more than a single repeated suggestion.
  const emailDomains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people) {
      const d = p.email?.split("@")[1]?.toLowerCase();
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const fromRoster = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
    const ownDomain = currentUserEmail.split("@")[1]?.toLowerCase();
    const baseline = ["gmail.com", "outlook.com", "yahoo.com", "icloud.com", "hotmail.com"];
    const merged = [...fromRoster, ...(ownDomain ? [ownDomain] : []), ...baseline];
    return Array.from(new Set(merged)).slice(0, 5);
  }, [people, currentUserEmail]);

  // "alice" -> alice@acme.com per known domain; with Email empty but Name
  // filled, derive the local part from the name ("Alex Doe" -> alex.doe).
  function emailOptions(): { value: string }[] {
    const typed = form.email.trim().toLowerCase();
    if (typed.includes("@")) {
      const [local, domainPart = ""] = typed.split("@");
      if (!local) return [];
      return emailDomains
        .filter((d) => d.startsWith(domainPart))
        .map((d) => ({ value: `${local}@${d}` }))
        .filter((o) => o.value !== typed);
    }
    const local = typed || form.name.trim().toLowerCase().split(/\s+/).filter(Boolean).join(".");
    if (!local) return [];
    return emailDomains.map((d) => ({ value: `${local}@${d}` }));
  }

  // Per-person training, matched by email.
  function trainingFor(p: Person): { total: number; completed: number } | null {
    if (!p.email) return null;
    const mine = training.filter((t) => t.person_email && t.person_email.toLowerCase() === p.email!.toLowerCase());
    if (mine.length === 0) return null;
    return { total: mine.length, completed: mine.filter((t) => t.status === "completed").length };
  }

  function openNew() {
    setForm(EMPTY);
    setEditing("new");
    setBulkAdding(false);
  }
  function openEdit(p: Person) {
    setForm({ name: p.name, email: p.email ?? "", role_title: p.role_title ?? "", started_at: p.started_at ?? "" });
    setEditing(p.id);
    setBulkAdding(false);
  }
  function openBulkAdd() {
    setEditing(null);
    setBulkAdding(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await (editing === "new"
        ? createPerson(form)
        : updatePerson(editing as string, form)
      ).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      toast("success", editing === "new" ? "Person added" : "Updated");
      setEditing(null);
      router.refresh();
    });
  }

  function act(fn: () => Promise<{ error?: string } | undefined>, ok: string) {
    start(async () => {
      const res = await fn().catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", ok);
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      const ok = await confirm({ title: "Delete person", message: "This removes them from the roster. This cannot be undone.", confirmLabel: "Delete", danger: true });
      if (!ok) return;
      const res = await deletePerson(id).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      toast("success", "Deleted");
      router.refresh();
    });
  }

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function renderRow(p: Person) {
    const tr = trainingFor(p);
    return (
      <ListRow key={p.id}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
            {p.role_title && <span className="text-xs text-muted-foreground">{p.role_title}</span>}
            {tr && (
              <Badge variant={tr.completed >= tr.total ? "success" : "warning"}>
                Training {tr.completed}/{tr.total}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {p.email || "no email"}
            {p.started_at && <> · joined {p.started_at}</>}
            {p.ended_at && <> · left {p.ended_at}</>}
          </div>
        </div>
        {canWrite && (
          <div className="flex shrink-0 items-center gap-1">
            {p.status === "active" ? (
              <button onClick={() => act(() => offboardPerson(p.id), "Offboarded")} disabled={pending} className="rounded-md p-2 text-warning hover:bg-warning-muted" title="Offboard">
                <UserMinus className="h-4 w-4" />
              </button>
            ) : (
              <button onClick={() => act(() => reactivatePerson(p.id), "Reactivated")} disabled={pending} className="rounded-md p-2 text-success hover:bg-success-muted" title="Reactivate">
                <UserPlus className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => openEdit(p)} disabled={pending} className="rounded-md p-2 hover:bg-secondary" title="Edit">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => remove(p.id)} disabled={pending} className="rounded-md p-2 text-destructive hover:bg-destructive/10" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </ListRow>
    );
  }

  return (
    <ManagerLayout
      toolbar={
        canWrite ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={openBulkAdd} disabled={pending} leftIcon={<Users className="h-4 w-4" />}>
              Bulk add
            </Button>
            <Button variant="accent" onClick={openNew} disabled={pending} leftIcon={<Plus className="h-4 w-4" />}>
              Add person
            </Button>
          </div>
        ) : undefined
      }
    >
      {bulkAdding && canWrite && (
        <PersonnelBulkAdd
          rosterProviders={rosterProviders}
          existingEmails={people.map((p) => p.email).filter((e): e is string => Boolean(e))}
          existingNames={people.map((p) => p.name)}
          onDone={() => setBulkAdding(false)}
        />
      )}

      {editing && (
        <form onSubmit={submit} className="card space-y-4">
          <h2 className="text-sm font-semibold text-foreground">{editing === "new" ? "New person" : "Edit person"}</h2>
          <FormSection label="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                <Input required maxLength={120} value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="Alex Doe" />
              </Field>
              <Field label="Email">
                <Typeahead
                  type="email"
                  maxLength={254}
                  value={form.email}
                  onChange={set("email")}
                  onSelect={(o) => set("email")(o.value)}
                  options={emailOptions()}
                  maxSuggestions={5}
                  placeholder="alex@company.com"
                />
              </Field>
              <Field label="Role / title">
                <Typeahead
                  maxLength={120}
                  value={form.role_title}
                  onChange={set("role_title")}
                  onSelect={(o) => set("role_title")(o.value)}
                  options={roleOptions}
                  placeholder="Start typing — Engineer, Product Manager…"
                />
              </Field>
              <Field label="Start date">
                <Input type="date" value={form.started_at} onChange={(e) => set("started_at")(e.target.value)} />
              </Field>
            </div>
          </FormSection>
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>Save</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {people.length === 0 && !editing && !bulkAdding ? (
        <EmptyState description="No people yet. Add your team so you can track onboarding, offboarding and security-training status." />
      ) : (
        <>
          {active.length > 0 && <ListCard>{active.map(renderRow)}</ListCard>}
          {offboarded.length > 0 && (
            <details className="card p-0">
              <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-muted-foreground">
                Offboarded ({offboarded.length})
              </summary>
              <ul className="divide-y divide-border border-t border-border">{offboarded.map(renderRow)}</ul>
            </details>
          )}
        </>
      )}
    </ManagerLayout>
  );
}
