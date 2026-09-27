"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Trash2 } from "lucide-react";
import { deleteEvidence, getEvidenceUrl } from "@/app/actions/evidence";
import { EvidenceUploader } from "@/components/evidence/EvidenceUploader";
import { useToast } from "@/components/ui/Toast";
import type { MeasureEvidence as MeasureFile } from "@/lib/db/queries";

/**
 * Files attached to a measure. Each one is evidence for every requirement the
 * measure covers, in every framework — uploaded once, the way the work is done
 * once.
 */
export function MeasureEvidence({
  companyId,
  measureId,
  files,
  requirementCount,
  canWrite,
}: {
  companyId: string;
  measureId: string;
  files: MeasureFile[];
  requirementCount: number;
  canWrite: boolean;
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
    if (!confirm(`Delete this file? It stops counting as evidence for all ${requirementCount} requirements.`)) return;
    start(async () => {
      const res = await deleteEvidence(id);
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Evidence deleted");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold">Evidence</div>
      {files.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-foreground">{f.file_name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {new Date(f.created_at).toLocaleDateString()} · counts for all {requirementCount}{" "}
                    {requirementCount === 1 ? "requirement" : "requirements"}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => download(f.id)}
                  disabled={busyId === f.id}
                  className="rounded-md p-1.5 hover:bg-secondary"
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => remove(f.id)}
                    disabled={pending}
                    className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nothing attached yet. Upload it here once and it counts for every requirement below.
        </p>
      )}
      {canWrite && <EvidenceUploader companyId={companyId} measureId={measureId} label="Attach evidence" />}
    </div>
  );
}
