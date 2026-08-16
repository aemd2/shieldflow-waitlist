"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { logEvent } from "@/lib/audit";
import { getCompanyForUser } from "@/lib/db/queries";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { isValidTrialCodeFormat, normalizeTrialCode, trialCodeSeq } from "@/lib/trial";
import { trialDaysLeft } from "@/lib/plan";

// The RPC returns machine-readable reasons; users get sentences.
const REASONS: Record<string, string> = {
  not_authenticated: "Please sign in first, then open your trial link again.",
  no_company: "Create your workspace first — your trial starts as soon as it exists.",
  invalid_code: "This trial link isn't valid. Ask whoever sent it for a fresh one.",
  link_expired: "This trial link has expired. Ask whoever sent it for a fresh one.",
  already_used: "This trial link has already been used.",
};

export interface RedeemResult {
  error?: string;
  ok?: true;
  /** Whole days the trial has left (14 on a fresh redemption). */
  daysLeft?: number | null;
  /** True when this workspace was already on a trial — a harmless repeat click. */
  already?: boolean;
}

/**
 * Claim a Tester-plan invite for the caller's workspace.
 *
 * All the real checks (owner-only, one trial per workspace, use count, link
 * expiry) live inside the redeem_trial_invite() SECURITY DEFINER function so
 * they run atomically under a row lock — two tabs racing can't mint two trials.
 */
export async function redeemTrial(rawCode: string): Promise<RedeemResult> {
  const code = normalizeTrialCode(String(rawCode ?? ""));
  if (!isValidTrialCodeFormat(code)) return { error: REASONS.invalid_code };

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: REASONS.not_authenticated };

  // Codes are unguessable but short — rate limit so nobody brute-forces the space.
  if (!checkRateLimit(`trial:${user.id}`, 10, 60_000)) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const { data, error } = await supabase.rpc("redeem_trial_invite", { p_code: code });
  if (error) {
    return { error: "We couldn't start your trial. Please try again in a moment." };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    already?: boolean;
    trial_ends_at?: string;
  };

  if (!result.ok) {
    return { error: REASONS[result.error ?? ""] ?? REASONS.invalid_code };
  }

  // Best-effort trail entry — never block the trial on it.
  if (!result.already) {
    try {
      const company = await getCompanyForUser(supabase, user.id);
      if (company) {
        await logEvent(supabase, company.id, "trial.started", {
          type: "company",
          id: company.id,
          label: company.name,
          metadata: { code, recipient: trialCodeSeq(code), endsAt: result.trial_ends_at },
        });
      }
    } catch {
      // Ignored on purpose.
    }
  }

  // The plan is derived on every render, so busting the shell cache is enough
  // for the whole app to switch to Tester immediately.
  revalidatePath("/", "layout");

  return {
    ok: true,
    already: result.already,
    daysLeft: trialDaysLeft(result.trial_ends_at ?? null),
  };
}
