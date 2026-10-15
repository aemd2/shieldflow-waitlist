import type { SupabaseClient } from "@supabase/supabase-js";
import { newUuid } from "@/lib/uuid";

/**
 * File a generated CSV as evidence on a measure — the populations an auditor
 * samples (merged pull requests, who can reach production, devices, leavers).
 * At most once a day per file name, so syncing twice doesn't stack duplicates.
 * Works with a user session (manual sync) or the service role (cron).
 */
export async function fileMeasureCsv(
  db: SupabaseClient,
  companyId: string,
  userId: string | null,
  measureKey: string,
  fileName: string,
  csv: string,
  note: string,
): Promise<boolean> {
  const { data: measure } = await db.from("measures").select("id").eq("key", measureKey).maybeSingle();
  if (!measure) return false;
  const { count } = await db
    .from("evidence")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("file_name", fileName);
  if (count) return false;
  const path = `${companyId}/integrations/${newUuid()}-${fileName}`;
  const { error } = await db.storage.from("evidence").upload(path, new Blob([csv], { type: "text/csv" }), { contentType: "text/csv" });
  if (error) return false;
  const { error: insErr } = await db.from("evidence").insert({
    company_id: companyId,
    measure_id: measure.id,
    file_name: fileName,
    storage_path: path,
    mime_type: "text/csv",
    size_bytes: csv.length,
    note,
    uploaded_by: userId,
  });
  return !insErr;
}

/** RFC-4180 CSV cell; neutralises spreadsheet formulas in anything external. */
export function csvCell(v: string | number | boolean | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvRow = (...cells: (string | number | boolean | null | undefined)[]) => cells.map(csvCell).join(",");
