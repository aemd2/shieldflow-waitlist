"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Download, Trash2 } from "lucide-react";
import { getEvidenceUrl, deleteEvidence } from "@/app/actions/evidence";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import type { Evidence } from "@/lib/db/queries";

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EvidenceList({
  items,
  controlId,
  canWrite = true,
}: {
  items: Evidence[];
  controlId: string;
  canWrite?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function download(id: string) {
    setBusyId(id);
    const res = await getEvidenceUrl(id);
    setBusyId(null);
    if (res?.error || !res?.url) {
      toast("error", res?.error ?? "File unavailable.");
      return;
    }
    window.open(res.url, "_blank", "noopener,noreferrer");
  }

  function remove(id: string) {
    if (!confirm("Delete this evidence file? This cannot be undone.")) return;
    start(async () => {
      const res = await deleteEvidence(id, controlId);
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Evidence deleted");
        router.refresh();
      }
    });
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No evidence attached yet.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {items.map((ev) => (
        <li key={ev.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{ev.file_name}</span>
                {ev.source === "integration" && (
                  <Badge variant="info" className="shrink-0">Auto</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {ev.source === "integration" ? "From an integration sync · " : ""}
                {formatSize(ev.size_bytes)} · {new Date(ev.created_at).toLocaleDateString()}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => download(ev.id)}
              disabled={busyId === ev.id}
              className="rounded-md p-2 hover:bg-secondary"
              title="Download"
            >
              <Download className="h-4 w-4" />
            </button>
            {/* Integration reports are auto-managed (and FK-referenced by checks),
                so they can't be deleted by hand here — only manual uploads can. */}
            {canWrite && ev.source !== "integration" && (
              <button
                onClick={() => remove(ev.id)}
                disabled={pending}
                className="rounded-md p-2 text-destructive hover:bg-destructive/10"
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
