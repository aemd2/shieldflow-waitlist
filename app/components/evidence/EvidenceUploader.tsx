"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { recordEvidence } from "@/app/actions/evidence";
import { useToast } from "@/components/ui/Toast";
import { MAX_EVIDENCE_BYTES, ALLOWED_EVIDENCE_MIME, sanitizeFileName } from "@/lib/validation";

function uuid(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

export function EvidenceUploader({
  companyId,
  controlId,
}: {
  companyId: string;
  controlId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation (mirrors bucket-level enforcement).
    if (file.size === 0) {
      toast("error", "That file is empty.");
      reset();
      return;
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      toast("error", "File is larger than 10MB.");
      reset();
      return;
    }
    if (!ALLOWED_EVIDENCE_MIME.includes(file.type as (typeof ALLOWED_EVIDENCE_MIME)[number])) {
      toast("error", "Unsupported file type. Use PDF, image, CSV, or Word.");
      reset();
      return;
    }

    setBusy(true);
    const supabase = createBrowserSupabase();
    const path = `${companyId}/${controlId}/${uuid()}-${sanitizeFileName(file.name)}`;

    const { error: upErr } = await supabase.storage
      .from("evidence")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (upErr) {
      // Distinguish the failure the user can't fix (project storage full) from
      // transient ones, so they don't retry forever against a hard limit.
      const msg = upErr.message?.toLowerCase() ?? "";
      if (msg.includes("quota") || msg.includes("exceeded") || msg.includes("payload too large")) {
        toast("error", "Storage is full. Please contact support.");
      } else if (msg.includes("already exists") || msg.includes("duplicate")) {
        toast("error", "Upload collision — please try again.");
      } else {
        toast("error", "Upload failed. Please try again.");
      }
      setBusy(false);
      reset();
      return;
    }

    const res = await recordEvidence({
      controlId,
      storagePath: path,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });

    setBusy(false);
    reset();

    if (res?.error) toast("error", res.error);
    else {
      toast("success", "Evidence uploaded");
      router.refresh();
    }
  }

  function reset() {
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ALLOWED_EVIDENCE_MIME.join(",")}
        onChange={onPick}
        disabled={busy}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="btn-accent"
      >
        <Upload className="mr-2 h-4 w-4" />
        {busy ? "Uploading..." : "Upload evidence"}
      </button>
      <p className="mt-2 text-xs text-muted-foreground">
        PDF, PNG, JPEG, CSV, or Word · max 10MB
      </p>
    </div>
  );
}
