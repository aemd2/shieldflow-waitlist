import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recordChecksForSyncAdmin,
  recordInternalChecks,
  checkProviderFor,
  INTERNAL_PROVIDER,
} from "@/lib/checks";
import {
  fetchPostureFor,
  isAuthError,
  SYNCABLE_PROVIDERS,
  type ConnectedIntegration,
} from "@/lib/integration-sync";
import { notifyCompanyViaAdmin } from "@/lib/notify";
import { plural, agree } from "@/lib/plural";

export interface CompanySyncSummary {
  integrations: number;
  synced: number;
  internal: number;
  drift: number;
  failing: number;
  errors: number;
}

/**
 * One workspace's continuous monitoring run: re-fetch each connected integration's
 * posture, re-evaluate its checks (replacing the prior verdicts while keeping the
 * evidence link), run the checks derived from our own data, and send one drift
 * digest if any check crossed into or out of "fail". Each integration is isolated:
 * one revoked token flags that integration and the rest still run.
 *
 * Runs in its own function invocation (app/api/cron/sync-company) so a deep AWS
 * scan in one workspace can't eat another workspace's time budget.
 */
export async function syncCompany(admin: SupabaseClient, companyId: string): Promise<CompanySyncSummary> {
  const summary: CompanySyncSummary = { integrations: 0, synced: 0, internal: 0, drift: 0, failing: 0, errors: 0 };

  const { data: integs } = await admin
    .from("integrations")
    // refresh_token/token_expires_at are Google's; the others ignore them.
    .select("id, company_id, provider, access_token, refresh_token, token_expires_at")
    .eq("company_id", companyId)
    .eq("status", "connected")
    .in("provider", [...SYNCABLE_PROVIDERS]);

  let companyDrift = 0;
  let companyFailing = 0;

  for (const integ of (integs ?? []) as ConnectedIntegration[]) {
    summary.integrations++;
    try {
      const posture = await fetchPostureFor(integ, admin);

      // Snapshot prior verdicts + keep the evidence link before re-recording.
      // Read by the name the CHECKS are stored under, not the integration's:
      // Google connects as "google_workspace" but writes checks as "google", so
      // using integ.provider here would find nothing and silently report no
      // drift for Google forever.
      const { data: prior } = await admin
        .from("control_checks")
        .select("check_key, result, evidence_id")
        .eq("company_id", companyId)
        .eq("provider", checkProviderFor(integ.provider));
      const oldByKey = new Map<string, string>();
      let evidenceId: string | null = null;
      for (const r of prior ?? []) {
        oldByKey.set((r as { check_key: string }).check_key, (r as { result: string }).result);
        if (!evidenceId) evidenceId = (r as { evidence_id: string | null }).evidence_id;
      }

      const raw = await recordChecksForSyncAdmin(admin, companyId, integ.provider, posture, evidenceId);
      await admin
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString(), status: "connected" })
        .eq("id", integ.id);
      summary.synced++;

      // Drift = a check whose verdict changed into or out of "fail".
      for (const rc of raw) {
        const old = oldByKey.get(rc.checkKey);
        if (old && old !== rc.result && (rc.result === "fail" || old === "fail")) {
          companyDrift++;
          if (rc.result === "fail") companyFailing++;
        }
      }
    } catch (err) {
      summary.errors++;
      if (isAuthError(err)) {
        await admin.from("integrations").update({ status: "error" }).eq("id", integ.id);
      }
    }
  }

  // Checks derived from our own data. recordInternalChecks never throws, so it
  // sits outside the try/catch above by design.
  const { data: priorInternal } = await admin
    .from("control_checks")
    .select("check_key, result")
    .eq("company_id", companyId)
    .eq("provider", INTERNAL_PROVIDER);
  const oldInternal = new Map<string, string>(
    (priorInternal ?? []).map((r) => [(r as { check_key: string }).check_key, (r as { result: string }).result]),
  );

  const internal = await recordInternalChecks(admin, companyId, { admin: true });
  if (internal.length > 0) summary.internal++;
  for (const rc of internal) {
    const old = oldInternal.get(rc.checkKey);
    if (old && old !== rc.result && (rc.result === "fail" || old === "fail")) {
      companyDrift++;
      if (rc.result === "fail") companyFailing++;
    }
  }

  if (companyDrift > 0) {
    summary.drift += companyDrift;
    summary.failing += companyFailing;
    await notifyCompanyViaAdmin(admin, companyId, {
      type: "integration",
      title: "Automated monitoring update",
      body:
        companyFailing > 0
          ? `${plural(companyDrift, "automated check")} changed — ${companyFailing} now failing. Review your dashboard.`
          : `${plural(companyDrift, "automated check")} ${agree(companyDrift, "has", "have")} recovered.`,
      link: "/dashboard",
    });
  }

  return summary;
}
