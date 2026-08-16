// Server-only reads of the Tester-invite table.
//
// trial_invites has NO authenticated RLS policies on purpose — it holds who each
// link was sent to, which is internal sales data. Every read goes through the
// service-role client here, and only the two harmless fields (is it valid, how
// many days) are ever returned toward a page an anonymous visitor can see.
import "server-only";
import { createAdminSupabase, isAdminConfigured } from "@/lib/supabase/admin";
import { isValidTrialCodeFormat, normalizeTrialCode } from "@/lib/trial";
import { TESTER_TRIAL_DAYS } from "@/lib/plan";

export type TrialInviteState =
  | { status: "valid"; code: string; days: number }
  | { status: "used"; code: string }
  | { status: "expired"; code: string }
  | { status: "unknown" };

export interface TrialInvite {
  code: string;
  seq: number;
  label: string | null;
  recipient_email: string | null;
  note: string | null;
  trial_days: number;
  max_uses: number;
  used_count: number;
  active: boolean;
  expires_at: string | null;
  created_at: string;
}

/**
 * Look up a code for the public /trial/[code] page. Deliberately does NOT return
 * the label or recipient email — a stranger with a guessed code must not learn
 * who it was addressed to.
 */
export async function lookupTrialInvite(raw: string): Promise<TrialInviteState> {
  const code = normalizeTrialCode(raw);
  if (!isValidTrialCodeFormat(code)) return { status: "unknown" };
  if (!isAdminConfigured()) return { status: "unknown" };

  try {
    const admin = createAdminSupabase();
    const { data } = await admin
      .from("trial_invites")
      .select("code, trial_days, max_uses, used_count, active, expires_at")
      .eq("code", code)
      .maybeSingle();

    if (!data) return { status: "unknown" };
    const inv = data as Pick<
      TrialInvite,
      "code" | "trial_days" | "max_uses" | "used_count" | "active" | "expires_at"
    >;

    if (!inv.active) return { status: "expired", code };
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
      return { status: "expired", code };
    }
    if (inv.used_count >= inv.max_uses) return { status: "used", code };

    return { status: "valid", code, days: inv.trial_days ?? TESTER_TRIAL_DAYS };
  } catch {
    return { status: "unknown" };
  }
}
