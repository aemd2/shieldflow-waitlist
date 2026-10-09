import { NextResponse } from "next/server";
import { createAdminSupabase, isAdminConfigured } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { syncCompany, type CompanySyncSummary } from "@/lib/sync-company";

// Real provider HTTP calls + DB writes — needs the Node runtime and a session-free
// admin client. Never statically rendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET(req: Request) {
  return run(req);
}

export function POST(req: Request) {
  return run(req);
}

const BATCH = 5;

/**
 * Continuous control monitoring — the dispatcher. Every workspace is synced in its
 * own invocation of /api/cron/sync-company, a few at a time, so one company's deep
 * AWS scan can't use up the time budget of the others. If a worker can't be
 * reached at all, the company is synced here instead rather than skipped.
 */
async function run(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "service role not configured" }, { status: 503 });
  }

  const admin = createAdminSupabase();
  // Internal checks need no integration, so every workspace is visited — a
  // company that has never connected anything still has an access-review
  // cadence to keep.
  const { data: companies } = await admin.from("companies").select("id");
  const ids = (companies ?? []).map((c) => (c as { id: string }).id);

  const origin = new URL(req.url).origin;
  const secret = process.env.CRON_SECRET!;
  const total: CompanySyncSummary & { companies: number; workerFallbacks: number } = {
    companies: 0, integrations: 0, synced: 0, internal: 0, drift: 0, failing: 0, errors: 0, workerFallbacks: 0,
  };

  for (let i = 0; i < ids.length; i += BATCH) {
    const results = await Promise.all(
      ids.slice(i, i + BATCH).map(async (companyId): Promise<CompanySyncSummary | null> => {
        try {
          const res = await fetch(`${origin}/api/cron/sync-company`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
            body: JSON.stringify({ companyId }),
          });
          if (!res.ok) return null;
          return (await res.json()) as CompanySyncSummary;
        } catch {
          // The worker was unreachable before doing anything: run it here.
          total.workerFallbacks++;
          return syncCompany(admin, companyId).catch(() => null);
        }
      }),
    );
    for (const r of results) {
      total.companies++;
      if (!r) {
        total.errors++;
        continue;
      }
      for (const k of ["integrations", "synced", "internal", "drift", "failing", "errors"] as const) total[k] += r[k];
    }
  }

  return NextResponse.json({ ok: true, ...total });
}
