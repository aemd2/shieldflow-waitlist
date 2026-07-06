"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import {
  pullPersonnelFrom,
  parseUploadedPersonnelCsv,
  createPeopleBulk,
} from "@/app/actions/personnel";
import type { RosterProviderInfo } from "@/app/actions/access-reviews";
import { PERSONNEL_CSV_TEMPLATE } from "@/lib/validation";

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
  const inputRef = useRef<HTMLInputElement>(null);

  const existingSet = new Set(existingEmails.map((e) => e.toLowerCase()));
  const isDuplicate = (r: DraftPerson) => Boolean(r.email) && existingSet.has(r.email.toLowerCase());
  const dupeCount = rows.filter(isDuplicate).length;

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
  function save() {
    const toAdd = rows.filter((r) => !isDuplicate(r));
    if (toAdd.length === 0) {
      return toast("error", rows.length > 0 ? "Everyone here is already in Personnel." : "Add at least one person first.");
    }
    start(async () => {
      const res = await createPeopleBulk({ people: toAdd }).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      const skipped = rows.length - toAdd.length;
      toast(
        "success",
        `Added ${toAdd.length} ${toAdd.length === 1 ? "person" : "people"}` +
          (skipped > 0 ? ` (${skipped} already existed, skipped)` : ""),
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
          {dupeCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {dupeCount} {dupeCount === 1 ? "row matches" : "rows match"} someone already in Personnel —
              marked below and skipped automatically, not added twice.
            </p>
          )}
          <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
            {rows.map((r, idx) => {
              const dupe = isDuplicate(r);
              return (
                <li
                  key={idx}
                  className={`flex items-center justify-between gap-2 rounded px-3 py-2 ${dupe ? "bg-warning-muted" : "bg-secondary"}`}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-foreground">{r.name}</span>
                    {r.email && <span className="text-muted-foreground"> · {r.email}</span>}
                    {r.role_title && <span className="text-muted-foreground"> · {r.role_title}</span>}
                    {dupe && <span className="ml-2 text-xs font-medium text-warning">Already in Personnel</span>}
                  </span>
                  <button type="button" onClick={() => removeRow(idx)} className="shrink-0 text-muted-foreground hover:text-destructive">
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="flex gap-2">
        <Button onClick={save} loading={pending} leftIcon={<UserPlus className="h-4 w-4" />}>
          {(() => {
            const n = rows.length - dupeCount;
            return `Add ${n > 0 ? n : ""} ${n === 1 ? "person" : "people"}`;
          })()}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
