import type { SupabaseClient } from "@supabase/supabase-js";

/** Optional details about the entity an event acted on. */
export type AuditTarget = {
  /** e.g. "control" | "evidence" | "vendor" | "risk" | "policy" | "member" | "integration" | "setting" | "company" | "framework" */
  type?: string;
  /** id of the affected entity (text — not every target is a uuid) */
  id?: string;
  /** human-readable snapshot: control code, vendor name, policy title, … */
  label?: string;
  /** small structured extras, e.g. { from: "not_started", to: "complete" } */
  metadata?: Record<string, unknown>;
};

/**
 * Append one row to the company's activity trail.
 *
 * Deliberately fail-safe: it swallows every error. Audit logging must NEVER
 * break the user's primary action, so call it *after* the mutation has already
 * succeeded. The actor (user id + email) is derived server-side inside the
 * log_audit_event() SECURITY DEFINER function from auth.uid(), so nothing here
 * can be spoofed by a tampered client.
 */
export async function logEvent(
  supabase: SupabaseClient,
  companyId: string,
  action: string,
  target: AuditTarget = {},
): Promise<void> {
  try {
    await supabase.rpc("log_audit_event", {
      p_company_id: companyId,
      p_action: action,
      p_target_type: target.type ?? null,
      p_target_id: target.id ?? null,
      p_target_label: target.label ?? null,
      p_metadata: target.metadata ?? {},
    });
  } catch {
    // Intentionally ignored — logging is best-effort and must not surface to the user.
  }
}
