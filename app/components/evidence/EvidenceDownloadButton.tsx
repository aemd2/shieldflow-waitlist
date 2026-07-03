"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { getEvidenceUrl } from "@/app/actions/evidence";
import { useToast } from "@/components/ui/Toast";

/** Download button for evidence rows outside a control page (e.g. the company-wide vault). */
export function EvidenceDownloadButton({ evidenceId }: { evidenceId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    const res = await getEvidenceUrl(evidenceId);
    setBusy(false);
    if (res?.error || !res?.url) {
      toast("error", res?.error ?? "File unavailable.");
      return;
    }
    window.open(res.url, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
      title="Download"
    >
      <Download className="h-4 w-4" />
    </button>
  );
}
