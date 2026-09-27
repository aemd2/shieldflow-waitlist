import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listVendors,
  listRisks,
  listTraining,
  getControlChecks,
  listTasks,
  listPolicies,
  listPolicyAcknowledgements,
  getCompanyMemberCount,
  type ControlWithStatus,
} from "@/lib/db/queries";
import { computeAlerts, type Alert } from "@/lib/monitoring";

/**
 * Every alert the dashboard shows, for the places that report them elsewhere —
 * the one-page report and the Slack digest.
 *
 * One loader so they can't disagree. Both used to pass three of computeAlerts'
 * ten inputs, so the report handed to prospects and auditors silently left out
 * failing automated checks (a leaver whose account is still open), risks,
 * training, tasks and policies — while the dashboard showed them all. Keep this
 * in step with the dashboard's own call.
 */
export async function loadAlerts(
  supabase: SupabaseClient,
  companyId: string,
  controls: ControlWithStatus[],
  frameworkProgress: { name: string; pct: number }[],
): Promise<Alert[]> {
  const [vendors, risks, training, checks, tasks, policies, policyAcks, memberCount] = await Promise.all([
    listVendors(supabase, companyId),
    listRisks(supabase, companyId),
    listTraining(supabase, companyId),
    getControlChecks(supabase, companyId),
    listTasks(supabase, companyId),
    listPolicies(supabase, companyId),
    listPolicyAcknowledgements(supabase, companyId),
    getCompanyMemberCount(supabase, companyId),
  ]);
  return computeAlerts(controls, frameworkProgress, vendors, risks, training, checks, tasks, policies, policyAcks, memberCount);
}
