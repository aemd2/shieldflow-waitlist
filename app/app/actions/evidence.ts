"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { evidenceRecordSchema } from "@/lib/validation";

const BUCKET = "evidence";
const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

/**
 * Record an evidence row AFTER the file is already uploaded to Storage by the client.
 * If the DB insert fails, we delete the just-uploaded object so we never leave an
 * orphaned file consuming the storage quota.
 */
export async function recordEvidence(input: {
  controlId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  note?: string;
}) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company: Company | null;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };

  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) {
    // Clean up the object the client already uploaded so we don't orphan it.
    if (typeof input?.storagePath === "string" && input.storagePath.startsWith(`${company.id}/`)) {
      await supabase.storage.from(BUCKET).remove([input.storagePath]);
    }
    return { error: denied };
  }

  // Re-validate everything the client claimed (size, mime, lengths) — the client
  // pre-checks are bypassable. On bad input, remove the uploaded object too.
  const parsed = evidenceRecordSchema.safeParse(input);
  if (!parsed.success) {
    if (typeof input?.storagePath === "string" && input.storagePath.startsWith(`${company.id}/`)) {
      await supabase.storage.from(BUCKET).remove([input.storagePath]);
    }
    return { error: parsed.error.issues[0]?.message ?? "Invalid evidence data." };
  }

  // Verify the path belongs to this company (defense in depth vs. a tampered client).
  if (!parsed.data.storagePath.startsWith(`${company.id}/`)) {
    await supabase.storage.from(BUCKET).remove([parsed.data.storagePath]);
    return { error: "Invalid upload path." };
  }

  const { error } = await supabase.from("evidence").insert({
    company_id: company.id,
    control_id: parsed.data.controlId,
    file_name: parsed.data.fileName,
    storage_path: parsed.data.storagePath,
    mime_type: parsed.data.mimeType,
    size_bytes: parsed.data.sizeBytes,
    note: parsed.data.note || null,
    uploaded_by: user.id,
  });

  if (error) {
    // Compensating cleanup — remove the orphaned object.
    await supabase.storage.from(BUCKET).remove([input.storagePath]);
    return { error: "Could not save the evidence record. Please try again." };
  }

  await logEvent(supabase, company.id, "evidence.uploaded", {
    type: "evidence",
    id: parsed.data.controlId,
    label: parsed.data.fileName,
  });

  revalidatePath(`/controls/${input.controlId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Short-lived signed URL for a private evidence file. */
export async function getEvidenceUrl(evidenceId: string) {
  if (!isUuid(evidenceId)) return { error: "File not found." };

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company: Company | null;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };

  const { data: row, error } = await supabase
    .from("evidence")
    .select("storage_path")
    .eq("company_id", company.id)
    .eq("id", evidenceId)
    .maybeSingle();
  if (error || !row) return { error: "File not found." };

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, 60);
  if (signErr || !signed) return { error: "File is currently unavailable." };

  return { url: signed.signedUrl };
}

export async function deleteEvidence(evidenceId: string, controlId: string) {
  if (!isUuid(evidenceId)) return { error: "File not found." };

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company: Company | null;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };

  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };

  const { data: row } = await supabase
    .from("evidence")
    .select("storage_path, file_name")
    .eq("company_id", company.id)
    .eq("id", evidenceId)
    .maybeSingle();

  const { error } = await supabase
    .from("evidence")
    .delete()
    .eq("company_id", company.id)
    .eq("id", evidenceId);
  if (error) return { error: "Could not delete. Please try again." };

  // Best-effort storage cleanup; the row is already gone so UI stays consistent.
  if (row?.storage_path) {
    await supabase.storage.from(BUCKET).remove([row.storage_path]);
  }

  await logEvent(supabase, company.id, "evidence.deleted", {
    type: "evidence",
    id: controlId,
    label: (row?.file_name as string | undefined) ?? undefined,
  });

  revalidatePath(`/controls/${controlId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
