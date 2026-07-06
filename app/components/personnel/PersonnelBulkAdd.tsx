"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, UserPlus, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import {
  pullPersonnelFrom,
  parseUploadedPersonnelCsv,
  createPeopleBulk,
} from "@/app/actions/personnel";
import type { RosterProviderInfo } from "@/app/actions/access-reviews";
import { PERSONNEL_CSV_TEMPLATE, personnelBulkRowSchema } from "@/lib/validation";

const NETWORK = "Network problem — check your connection and try again.";

interface DraftPerson {
  name: string;
  email: string;
  role_title: string;
}

/** Parse a pasted "name, email, role" line — comma, tab, or pipe separated,
 * matching the roster-paste convention used elsewhere in this app. */
function parsePersonLine(line: string): DraftPerson | null {
  const parts = line.split(/\t|,|\|/).map((p) => p.trim());
  const [name, email = "", role_title = ""] = parts;
  if (!name) return null;
  return { name, email, role_title };
}

function downloadTemplate() {
  const blob = new Blob([PERSONNEL_CSV_TEMPLATE], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "personnel-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function PersonnelBulkAdd({
  rosterProviders,
  existingEmails = [],
  onDone,
}: {
  rosterProviders: RosterProviderInfo[];
  existingEmails?: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [pulling, setPulling] = useState<string | null>(null);
  const [rows, setRows] = useState<DraftPerson[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingSet = new Set(existingEmails.map((e) => e.toLowerCase()));
  const isDuplicate = (r: DraftPerson) => Boolean(r.email) && existingSet.has(r.email.toLowerCase());
  const dupeCount = rows.filter(isDuplicate).length;

  // Secureframe's bulk-import shows validation errors inline and lets you fix
  // a cell in place before committing, rather than silently rejecting or
  // failing the whole batch on one bad row — same idea here.
  function rowError(r: DraftPerson): string | null {
    const parsed = personnelBulkRowSchema.safeParse({ ...r, started_at: "" });
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Fix this row");
  }
  const invalidCount = rows.filter((r) => !isDuplicate(r) && rowError(r) !== null).length;

  function updateRow(idx: number, patch: Partial<DraftPerson>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function pull(provider: RosterProviderInfo) {
    setPulling(provider.provider);
    start(async () => {
      const res = await pullPersonnelFrom(provider.provider).catch(() => ({ error: NETWORK }));
      setPulling(null);
      if (!res || "error" in res) {
        toast("error", res?.error ?? NETWORK);
        return;
      }
      setRows((prev) => [...prev, ...res.rows]);
      toast("success", `Pulled ${res.rows.length} from ${provider.label}`);
    });
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    start(async () => {
      const text = await file.text().catch(() => null);
      if (text == null) {
        toast("error", "Couldn't read that file.");
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
      const res = await parseUploadedPersonnelCsv(text).catch(() => ({ error: NETWORK }));
      if (inputRef.current) inputRef.current.value = "";
      if (!res || "error" in res) {
        toast("error", res?.error ?? NETWORK);
        return;
      }
      setRows((prev) => [...prev, ...res.rows]);
      toast("success", `Loaded ${res.rows.length} rows from the file`);
    });
  }

  function applyPaste() {
    const parsed = pasteText.split("\n").map((l) => l.trim()).filter(Boolean).map(parsePersonLine).filter((p): p is DraftPerson => p !== null);
    if (parsed.length === 0) return;
    setRows((prev) => [...prev, ...parsed]);
    setPasteText("");
  }

  /** Pasting a multi-line list adds every row immediately, matching the
   * access-review roster box — no extra click for the common bulk case. */
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    e.preventDefault();
    const parsed = text.split("\n").map((l) => l.trim()).filter(Boolean).map(parsePersonLine).filter((p): p is DraftPerson => p !== null);
    if (parsed.length === 0) return;
    setRows((prev) => [...prev, ...parsed]);
    toast("success", `Added ${parsed.length} ${parsed.length === 1 ? "row" : "rows"}`);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  // Matches the pattern Drata's own vendor bulk-import uses: dedupe by a
  // stable key (there, name/website; here, email) instead of trusting the
  // caller to have already checked, and never silently create a duplicate.
  // Invalid rows are excluded the same way — fix them inline instead, or
  // they're left in the list (not added) so nothing is lost silently.
  function save() {
    const toAdd = rows.filter((r) => !isDuplicate(r) && rowError(r) === null);
    if (toAdd.length === 0) {
      return toast(
        "error",
        rows.length > 0 ? "Fix the flagged rows (or remove them) before adding." : "Add at least one person first.",
      );
    }
    start(async () => {
      const res = await createPeopleBulk({ people: toAdd }).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      const skipped = rows.length - toAdd.length;
      toast(
        "success",
        `Added ${toAdd.length} ${toAdd.length === 1 ? "person" : "people"}` +
          (skipped > 0 ? ` (${skipped} skipped — duplicate or needs a fix)` : ""),
      );
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4">
      <h2 className="text-sm font-semibold text-foreground">Bulk add people</h2>

      <div className="flex flex-wrap items-center gap-2">
        {rosterProviders.map((p) => (
          <Button
            key={p.provider}
            type="button"
            variant="outline"
            onClick={() => pull(p)}
            loading={pulling === p.provider}
            disabled={pending && pulling !== p.provider}
            leftIcon={<Download className="h-3.5 w-3.5" />}
          >
            Pull from {p.label}
          </Button>
        ))}
        <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onUpload} disabled={pending} />
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          loading={pending && !pulling}
          leftIcon={<Upload className="h-3.5 w-3.5" />}
        >
          Upload CSV
        </Button>
        <button type="button" onClick={downloadTemplate} className="text-xs text-muted-foreground underline hover:text-foreground">
          Download template
        </button>
      </div>

      <div className="flex gap-2">
        <Textarea
          rows={4}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          onPaste={handlePaste}
          placeholder={"Paste a whole list at once — one per line:\nAlice Doe, alice@acme.com, Engineer\nBob Lee, bob@acme.com, Designer"}
        />
        <Button type="button" variant="outline" onClick={applyPaste}>Add</Button>
      </div>

      {rows.length > 0 && (
        <>
          {(dupeCount > 0 || invalidCount > 0) && (
            <p className="text-xs text-muted-foreground">
              {dupeCount > 0 && `${dupeCount} already in Personnel`}
              {dupeCount > 0 && invalidCount > 0 && " · "}
              {invalidCount > 0 && `${invalidCount} need${invalidCount === 1 ? "s" : ""} a fix`}
              {" — click "}
              <Pencil className="inline h-3 w-3 align-text-top" /> to edit a row in place before adding.
            </p>
          )}
          <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
            {rows.map((r, idx) => {
              const dupe = isDuplicate(r);
              const error = !dupe ? rowError(r) : null;

              if (editingIdx === idx) {
                return (
                  <li key={idx} className="space-y-2 rounded border border-border bg-background p-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input value={r.name} placeholder="Name" onChange={(e) => updateRow(idx, { name: e.target.value })} />
                      <Input value={r.email} placeholder="Email" onChange={(e) => updateRow(idx, { email: e.target.value })} />
                      <Input value={r.role_title} placeholder="Role" onChange={(e) => updateRow(idx, { role_title: e.target.value })} />
                    </div>
                    {rowError(r) && <p className="text-xs text-destructive">{rowError(r)}</p>}
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => setEditingIdx(null)} leftIcon={<Check className="h-3.5 w-3.5" />}>
                        Done
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => removeRow(idx)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              }

              return (
                <li
                  key={idx}
                  className={`flex items-center justify-between gap-2 rounded px-3 py-2 ${error ? "bg-destructive/10" : dupe ? "bg-warning-muted" : "bg-secondary"}`}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-foreground">{r.name || "(no name)"}</span>
                    {r.email && <span className="text-muted-foreground"> · {r.email}</span>}
                    {r.role_title && <span className="text-muted-foreground"> · {r.role_title}</span>}
                    {dupe && <span className="ml-2 text-xs font-medium text-warning">Already in Personnel</span>}
                    {error && <span className="ml-2 text-xs font-medium text-destructive">{error}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => setEditingIdx(idx)} className="text-muted-foreground hover:text-foreground" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => removeRow(idx)} className="text-muted-foreground hover:text-destructive" title="Remove">
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="flex gap-2">
        <Button onClick={save} loading={pending} leftIcon={<UserPlus className="h-4 w-4" />}>
          {(() => {
            const n = rows.filter((r) => !isDuplicate(r) && rowError(r) === null).length;
            return `Add ${n > 0 ? n : ""} ${n === 1 ? "person" : "people"}`;
          })()}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
