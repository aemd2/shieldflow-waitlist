"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Upload, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { pullRosterFrom, parseUploadedRosterCsv, type RosterProvider } from "@/app/actions/access-reviews";
import { ROSTER_CSV_TEMPLATE } from "@/lib/validation";

export interface DraftRosterRow {
  subject: string;
  access: string;
}

/** A company personnel record, offered as a click-to-fill suggestion — the
 * fastest way to add a known person without typing their email by hand. */
export interface PersonSuggestion {
  name: string;
  email: string;
  role: string | null;
}

const NETWORK = "Network problem — check your connection and try again.";

/** Parse a pasted "subject — access" line. Recognizes a tab first (pasting
 * two columns straight from Excel/Sheets is the fastest bulk-entry path, and
 * a tab is never meaningfully part of a name), then em-dash, pipe, spaced
 * hyphen, or comma; anything else is all subject. */
function parseSubjectLine(line: string): DraftRosterRow {
  for (const sep of ["\t", " — ", " | ", " - ", ","]) {
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
  suggestions = [],
}: {
  systemName: string;
  provider: string | null;
  rows: DraftRosterRow[];
  onRowsChange: (rows: DraftRosterRow[]) => void;
  suggestions?: PersonSuggestion[];
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [pulling, setPulling] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addedEmails = new Set(rows.map((r) => r.subject.toLowerCase()));
  const matches =
    query.trim().length === 0
      ? []
      : suggestions
          .filter((p) => !addedEmails.has(p.email.toLowerCase()))
          .filter(
            (p) =>
              p.name.toLowerCase().includes(query.toLowerCase()) ||
              p.email.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, 6);

  function addPerson(p: PersonSuggestion) {
    onRowsChange([...rows, { subject: p.email, access: p.role ?? "" }]);
    setQuery("");
    setShowSuggestions(false);
  }

  /** Enter with no dropdown match just adds whatever was typed, same as the
   * paste box below — suggestions speed things up but never gate manual entry. */
  function submitQuery() {
    const parsed = parseSubjectLine(query.trim());
    if (!parsed.subject) return;
    onRowsChange([...rows, parsed]);
    setQuery("");
    setShowSuggestions(false);
  }

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

  /** Pasting a multi-line list (e.g. two columns copied from Excel/Sheets) adds
   * every row immediately — no separate "Add" click for the common bulk case.
   * A single-line paste (finishing one entry while typing) is left alone. */
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    e.preventDefault();
    const parsed = text.split("\n").map((l) => l.trim()).filter(Boolean).map(parseSubjectLine);
    if (parsed.length === 0) return;
    onRowsChange([...rows, ...parsed]);
    toast("success", `Added ${parsed.length} ${parsed.length === 1 ? "row" : "rows"}`);
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

      {suggestions.length > 0 && (
        <div className="relative">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (matches.length > 0) addPerson(matches[0]);
                  else submitQuery();
                }
              }}
              placeholder="Start typing a name or email — pick a person, or keep typing to add them as-is"
            />
            <Button type="button" variant="outline" leftIcon={<UserPlus className="h-3.5 w-3.5" />} onClick={submitQuery}>
              Add
            </Button>
          </div>
          {showSuggestions && matches.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-background shadow-md">
              {matches.map((p) => (
                <li key={p.email}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addPerson(p)}
                    className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-secondary"
                  >
                    <span className="font-medium text-foreground">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.email}
                      {p.role && ` · ${p.role}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Textarea
          rows={4}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          onPaste={handlePaste}
          placeholder={"Paste a whole list at once — one per line, or two columns copied straight from Excel/Sheets:\nalice@acme.com — Admin\nbob@acme.com\tMember"}
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
