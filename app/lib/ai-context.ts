import type { SupabaseClient } from "@supabase/supabase-js";
import { listVendors } from "@/lib/db/queries";
import { CHECK_PROVIDER_LABELS } from "@/lib/checks";
import { sanitizeForPrompt } from "@/lib/validation";
import { redactedText } from "@/lib/redact";

/**
 * What the company has actually done, as prompt lines for the AI features
 * (questionnaire drafting, Co-Pilot). Without this they only see requirement
 * statuses, and answer "not specified" about work the workspace plainly records.
 *
 * Aggregate by design: catalogue names (measures, checks), titles of the
 * company's own documents, counts and dates — never a person's name or email.
 * A check's detail goes along only when it is a bare coverage figure
 * (COVERAGE_DETAIL): every other detail names the people involved. See
 * lib/redact.ts for why that boundary matters.
 */

/** Check details that are only a coverage figure, matched to the exact sentences
 *  lib/checks.ts writes, so nothing with a name in it can ever match. */
const COVERAGE_DETAIL =
  /^\d+\/\d+ (?:users have 2-step verification|active users have MFA enrolled) \(\d+%\)\.?$/;

type CheckRow = { check_key: string; provider: string; result: string; detail: string | null };

/** "Google Workspace offboarding drift: fail" — a readable name, never the raw
 *  key, because the model repeats whatever it's given. */
function describeCheck(c: CheckRow): string {
  const what = (c.check_key.split(".")[1] ?? c.check_key).replace(/_/g, " ");
  // "13/14 users have 2-step verification (93%)." — without the figure, a pass
  // reads as total coverage and a draft says "all users".
  const figure = c.detail && COVERAGE_DETAIL.test(c.detail) ? ` (${c.detail.replace(/\.$/, "")})` : "";
  return `${CHECK_PROVIDER_LABELS[c.provider] ?? c.provider} ${what}: ${c.result}${figure}`;
}

export async function workspaceFacts(supabase: SupabaseClient, companyId: string): Promise<string[]> {
  const [vendors, measures, checks, evidence, reviews] = await Promise.all([
    listVendors(supabase, companyId),
    supabase.from("measure_status").select("status, measures(name)").eq("company_id", companyId).neq("status", "not_started"),
    supabase.from("control_checks").select("check_key, provider, result, detail").eq("company_id", companyId),
    supabase.from("evidence").select("file_name").eq("company_id", companyId).order("created_at", { ascending: false }).limit(200),
    supabase.from("access_reviews").select("completed_at").eq("company_id", companyId).eq("status", "completed")
      .order("completed_at", { ascending: false }).limit(1),
  ]);

  const measureRows = (measures.data ?? []) as unknown as { status: string; measures: { name: string } | null }[];
  const measuresBy = (status: string) =>
    measureRows.filter((m) => m.status === status && m.measures).map((m) => m.measures!.name).slice(0, 40);

  // One line per check (a check is stored once per control it maps to), failing first.
  const byKey = new Map<string, CheckRow>();
  for (const c of (checks.data ?? []) as CheckRow[]) byKey.set(c.check_key, c);
  const order = { fail: 0, inconclusive: 1, pass: 2 } as Record<string, number>;
  const checkLines = [...byKey.values()]
    .sort((a, b) => (order[a.result] ?? 3) - (order[b.result] ?? 3))
    .map(describeCheck);

  const documents = [...new Set(((evidence.data ?? []) as { file_name: string }[]).map((e) => e.file_name))]
    .slice(0, 25)
    .map((n) => sanitizeForPrompt(redactedText(n), 120));

  const reviewed = vendors.filter((v) => v.reviewed_at).length;
  const soc2OnFile = vendors.filter((v) => v.soc2_status === "on_file").length;
  const lastReview = (reviews.data?.[0] as { completed_at: string | null } | undefined)?.completed_at;

  const list = (xs: string[], none: string) => (xs.length ? xs.join("; ") : none);
  return [
    `Security measures the company has marked complete: ${list(measuresBy("complete"), "none yet")}`,
    `Security measures in progress: ${list(measuresBy("in_progress"), "none")}`,
    `Automated checks, latest result (failing first): ${list(checkLines, "none run yet")}`,
    `Evidence documents on file: ${list(documents, "none yet")}`,
    `Third-party vendors tracked: ${vendors.length} (${reviewed} with a recorded security review, ${soc2OnFile} with a SOC 2 report on file)`,
    `Last completed user access review: ${lastReview ? lastReview.slice(0, 10) : "none completed yet"}`,
  ];
}
