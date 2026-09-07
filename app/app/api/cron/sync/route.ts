import { NextResponse } from "next/server";
import { createAdminSupabase, isAdminConfigured } from "@/lib/supabase/admin";
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

// Real provider HTTP calls + DB writes — needs the Node runtime and a session-free
// admin client. Never statically rendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Shared secret check. The scheduler (Supabase pg_cron via pg_net, or any caller)
 * must present CRON_SECRET; without it, or without the env set, we refuse. */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

export function GET(req: Request) {
  return run(req);
}

export function POST(req: Request) {
  return run(req);
}

/**
 * Continuous control monitoring. Walks every connected, syncable integration,
 * re-fetches its posture, re-evaluates the automated checks (replacing the prior
 * verdicts while preserving the evidence link), and emits one drift digest per
 * company when a check crosses into or out of "fail". Each integration is isolated:
 * one revoked token flags that integration and the rest still run.
 */
async function run(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "service role not configured" }, { status: 503 });
  }

  const admin = createAdminSupabase();
  const summary = { companies: 0, integrations: 0, synced: 0, internal: 0, drift: 0, failing: 0, errors: 0 };

  const { data: integs } = await admin
    .from("integrations")
    // refresh_token/token_expires_at are Google's; the others ignore them.
    .select("id, company_id, provider, access_token, refresh_token, token_expires_at")
    .eq("status", "connected")
    .in("provider", [...SYNCABLE_PROVIDERS]);

  // Group by company so a drift digest goes out once per workspace, not per check.
  const byCompany = new Map<string, ConnectedIntegration[]>();
  for (const row of (integs ?? []) as ConnectedIntegration[]) {
    const list = byCompany.get(row.company_id) ?? [];
    list.push(row);
    byCompany.set(row.company_id, list);
  }

  // Internal checks need no integration, so the run covers every workspace — not
  // just the ones with something connected. A company that has never connected
  // anything still has an access-review cadence to keep.
  const { data: allCompanies } = await admin.from("companies").select("id");
  const companyIds = new Set<string>((allCompanies ?? []).map((c) => (c as { id: string }).id));
  for (const id of byCompany.keys()) companyIds.add(id);

  for (const companyId of companyIds) {
    summary.companies++;
    let companyDrift = 0;
    let companyFailing = 0;

    for (const integ of byCompany.get(companyId) ?? []) {
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
      (priorInternal ?? []).map((r) => [
        (r as { check_key: string }).check_key,
        (r as { result: string }).result,
      ]),
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
            ? `${companyDrift} automated check(s) changed — ${companyFailing} now failing. Review your dashboard.`
            : `${companyDrift} automated check(s) recovered.`,
        link: "/dashboard",
      });
    }
  }

  return NextResponse.json({ ok: true, ...summary });
}
