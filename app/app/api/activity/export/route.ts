import { NextResponse } from "next/server";
import { createServerSupabase, getRequestUser } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";

/**
 * The activity trail as a CSV an auditor can keep.
 *
 * A reviewer assessing us put it plainly: an audit trail you can only scroll
 * through in the vendor's own UI is not evidence, because it leaves with the
 * vendor. /security listed "audit trail cannot be exported" as a known gap and
 * it sat in our own risk register. This closes it.
 *
 * Reads through the signed-in user's session client, never the service role, so
 * row-level security decides what comes out — the export cannot widen what the
 * person could already see, and cannot cross a workspace boundary.
 *
 * Honours the same ?type= filter as the Activity page, so "export what I'm
 * looking at" does what it says.
 */

// Quote every cell; neutralise spreadsheet formulas in anything we didn't
// write. Target labels carry customer- and provider-supplied text (repo names,
// vendor names, emails), which is exactly where a leading = + - @ comes from.
function cell(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
const row = (...cells: (string | number | null | undefined)[]) => cells.map(cell).join(",");

// PostgREST caps a single response, so the trail is read in batches. The
// ceiling exists so one enormous workspace can't hold a request open forever;
// if it is ever hit the file says so rather than ending early and looking
// complete, which would be the one truly dangerous outcome for an audit file.
const BATCH = 1000;
const MAX_ROWS = 50_000;

interface AuditRow {
  created_at: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_label: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
}

export async function GET(request: Request) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = await createServerSupabase();
  const company = await getCompanyForUser(supabase, user.id);
  if (!company) return NextResponse.json({ error: "No company." }, { status: 404 });

  const targetType = new URL(request.url).searchParams.get("type") ?? undefined;

  const rows: AuditRow[] = [];
  let truncated = false;
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    let query = supabase
      .from("audit_events")
      .select("created_at, actor_email, action, target_type, target_label, target_id, metadata")
      .eq("company_id", company.id);
    if (targetType) query = query.eq("target_type", targetType);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(from, from + BATCH - 1);
    if (error) return NextResponse.json({ error: "Could not read the trail." }, { status: 500 });

    const batch = (data ?? []) as AuditRow[];
    rows.push(...batch);
    if (batch.length < BATCH) break;
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const scope = targetType ? `${targetType} events only` : "all events";
  const lines: string[] = [
    row(`${company.name} — activity trail`),
    row(
      `Generated ${today} by ShieldFlow. ${rows.length} ${scope}.` +
        " Every actor is recorded server-side from the authenticated session, not from the browser.",
    ),
  ];
  if (truncated) {
    lines.push(
      row(
        `TRUNCATED: this export stops at the ${MAX_ROWS.toLocaleString()} most recent events.` +
          " Older events exist and are not in this file.",
      ),
    );
  }
  lines.push("", row("When (UTC)", "Who", "Action", "Target type", "Target", "Target ID", "Details"));

  for (const r of rows) {
    lines.push(
      row(
        r.created_at,
        r.actor_email,
        r.action,
        r.target_type,
        r.target_label,
        r.target_id,
        r.metadata && Object.keys(r.metadata).length > 0 ? JSON.stringify(r.metadata) : "",
      ),
    );
  }

  // Exporting the trail is itself an auditable act — who took a copy of the
  // record, and when, is exactly the sort of thing the record should contain.
  await logEvent(supabase, company.id, "activity.exported", {
    type: "company",
    id: company.id,
    label: company.name,
    metadata: { rows: rows.length, filter: targetType ?? "all", truncated },
  });

  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="activity-trail-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
