"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { pullRosterFrom, parseUploadedRosterCsv, type RosterProvider } from "@/app/actions/access-reviews";
import { ROSTER_CSV_TEMPLATE } from "@/lib/validation";

export interface DraftRosterRow {
  subject: string;
  access: string;
}

const NETWORK = "Network problem — check your connection and try again.";

/** Parse a pasted "subject — access" line (em-dash, pipe, spaced hyphen, or
 * comma separate the two; anything else is all subject). */
function parseSubjectLine(line: string): DraftRosterRow {
  for (const sep of [" — ", " | ", " - ", ","]) {
    const i = line.indexOf(sep);
    if (i >= 0) return { subject: line.slice(0, i).trim(), access: line.slice(i + sep.length).trim() };
  }
  return { subject: line.trim(), access: "" };
}

function downloadTemplate() {
  const blob = new Blob([ROSTER_CSV_TEMPLATE], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "access-review-roster-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function SystemRosterEditor({
  systemName,
  provider,
  rows,
  onRowsChange,
}: {
  systemName: string;
  provider: string | null;
  rows: DraftRosterRow[];
  onRowsChange: (rows: DraftRosterRow[]) => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [pulling, setPulling] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function pull() {
    if (!provider) return;
    setPulling(true);
    start(async () => {
      const res = await pullRosterFrom(provider as RosterProvider).catch(() => ({ error: NETWORK }));
      setPulling(false);
      if (!res || "error" in res) {
        toast("error", res?.error ?? NETWORK);
        return;
      }
      onRowsChange([...rows, ...res.rows]);
      toast("success", `Pulled ${res.rows.length} from ${systemName}`);
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
      const res = await parseUploadedRosterCsv(text).catch(() => ({ error: NETWORK }));
      if (inputRef.current) inputRef.current.value = "";
      if (!res || "error" in res) {
        toast("error", res?.error ?? NETWORK);
        return;
      }
      onRowsChange([...rows, ...res.rows]);
      toast("success", `Loaded ${res.rows.length} rows from the file`);
    });
  }

  function applyPaste() {
    const parsed = pasteText.split("\n").map((l) => l.trim()).filter(Boolean).map(parseSubjectLine);
    if (parsed.length === 0) return;
    onRowsChange([...rows, ...parsed]);
    setPasteText("");
  }

  function removeRow(idx: number) {
    onRowsChange(rows.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{systemName}</span>
        <span className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "account" : "accounts"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {provider && (
          <Button
            type="button"
            variant="outline"
            onClick={pull}
            loading={pulling}
            disabled={pending && !pulling}
            leftIcon={<Download className="h-3.5 w-3.5" />}
          >
            Pull roster
          </Button>
        )}
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
          rows={2}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={"Or paste: alice@acme.com — Admin"}
        />
        <Button type="button" variant="outline" onClick={applyPaste}>Add</Button>
      </div>

      {rows.length > 0 && (
        <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
          {rows.map((r, idx) => (
            <li key={idx} className="flex items-center justify-between gap-2 rounded bg-secondary px-2 py-1">
              <span className="truncate">{r.subject}{r.access && ` — ${r.access}`}</span>
              <button type="button" onClick={() => removeRow(idx)} className="text-muted-foreground hover:text-destructive">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
