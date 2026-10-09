import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabase, isAdminConfigured } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { syncCompany } from "@/lib/sync-company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One workspace's monitoring run, called by the /api/cron/sync dispatcher. */
export async function POST(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "service role not configured" }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const parsed = z.object({ companyId: z.string().uuid() }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const summary = await syncCompany(createAdminSupabase(), parsed.data.companyId);
  return NextResponse.json(summary);
}
