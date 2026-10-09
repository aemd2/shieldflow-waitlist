import { NextResponse } from "next/server";
import { createServerSupabase, getRequestUser } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { loadAwsFacts } from "@/lib/aws/facts";
import { EU_REGIONS, STORE_LABEL } from "@/lib/aws/stores";

/**
 * The supplier data sheet a DORA or NIS2 customer's procurement team asks for:
 * where data is hosted and by whom, what protects it, and the subprocessors —
 * every AWS line verified by the last scan, dated. CSV so it pastes straight
 * into their spreadsheet.
 */

// Quote every cell; neutralise spreadsheet formulas in anything we didn't write.
function cell(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
const row = (...cells: (string | number | null | undefined)[]) => cells.map(cell).join(",");

export async function GET() {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const supabase = await createServerSupabase();
  const company = await getCompanyForUser(supabase, user.id);
  if (!company) return NextResponse.json({ error: "No company." }, { status: 404 });

  const [facts, { data: subs }] = await Promise.all([
    loadAwsFacts(supabase, company.id).catch(() => null),
    supabase.from("subprocessors").select("name, purpose, location, url").eq("company_id", company.id).order("name"),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    row(`${company.name} — supplier security data sheet`),
    row(`Generated ${today} by ShieldFlow.${facts?.verifiedAt ? ` AWS facts verified by a read-only scan on ${facts.verifiedAt.slice(0, 10)}.` : ""}`),
    "",
    row("Topic", "Statement", "Status", "Verified by"),
  ];
  if (facts) {
    for (const f of facts.facts) {
      lines.push(row(f.title, f.statement, f.ok === true ? "Verified" : f.ok === false ? "Not met" : "Not verified", f.proof.join("; ")));
    }
  } else {
    lines.push(row("AWS", "No production AWS account connected or scanned yet.", "Not verified", ""));
  }

  // Counts per kind, not resource names: this sheet leaves the company.
  lines.push("", row("Data location", "Location", "Inside the EU", "What is stored there"));
  for (const r of facts?.regions ?? []) {
    const counts = new Map<string, number>();
    for (const s of r.stores) {
      const n = s.kind === "ebs" ? Number.parseInt(s.id, 10) || 1 : 1;
      counts.set(STORE_LABEL[s.kind], (counts.get(STORE_LABEL[s.kind]) ?? 0) + n);
    }
    const what = [...counts.entries()].map(([k, n]) => `${n} × ${k}`).join("; ");
    lines.push(row(r.region, r.name, EU_REGIONS.includes(r.region) ? "Yes" : "No", what));
  }

  lines.push("", row("Subprocessor", "Purpose", "Location", "Website"));
  for (const s of (subs ?? []) as { name: string; purpose: string | null; location: string | null; url: string | null }[]) {
    lines.push(row(s.name, s.purpose, s.location, s.url));
  }

  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="supplier-data-sheet-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
