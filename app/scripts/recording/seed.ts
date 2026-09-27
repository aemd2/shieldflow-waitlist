/**
 * Seed the recording workspace with the sample company used in the product
 * videos (docs/VIDEO_PLAN.md). Run from app/:
 *
 *   npx tsx scripts/recording/seed.ts
 *
 * Targets the workspace owned by RECORDING_EMAIL in .env.local — never a
 * hard-coded address, because this repo is public.
 *
 * Idempotent: re-running adds nothing twice. It only ever ADDS — existing
 * people, vendors and progress in the workspace are left as they are.
 *
 * Everything here is invented: Northwind Analytics, its people, its numbers.
 * The identity-check results are produced by the real evaluators
 * (recordChecksForSyncAdmin) over a sample directory, so what appears on screen
 * is exactly what the product would show for a company in this state — only
 * the company isn't real. The videos say so.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const COMPANY_NAME = "Northwind Analytics";

/** Framework the workspace should already have. NIS2 is left out on purpose —
 *  clip 2 adds it on camera to show existing work being credited. */
const FRAMEWORKS = ["SOC 2", "ISO 27001"];

/** Measures a person would have done by now. "Encrypt data at rest" is left
 *  undone on purpose — clip 1 completes it on camera. */
const DONE_MEASURES = [
  "security-policies",
  "asset-inventory",
  "incident-response-plan",
  "incident-log",
  "vendor-reviews",
  "vendor-contracts",
  "data-inventory",
];

const LEAVER = { name: "Priya Nair", email: "priya@northwind.test", role: "Senior Engineer", ended: "2026-08-19" };

const PEOPLE: { name: string; email: string; role: string; started: string }[] = [
  { name: "Sam Okafor", email: "sam@northwind.test", role: "Head of Platform", started: "2023-03-06" },
  { name: "Daniel Weber", email: "daniel@northwind.test", role: "CTO", started: "2022-01-10" },
  { name: "Amara Osei", email: "amara@northwind.test", role: "Senior Engineer", started: "2023-06-19" },
  { name: "Lukas Brandt", email: "lukas@northwind.test", role: "Engineer", started: "2024-02-05" },
  { name: "Sofia Marín", email: "sofia@northwind.test", role: "Product Manager", started: "2023-09-11" },
  { name: "Tom Hughes", email: "tom@northwind.test", role: "Customer Success", started: "2024-05-20" },
  { name: "Mei Chen", email: "mei@northwind.test", role: "Product Designer", started: "2023-11-01" },
  { name: "Omar Haddad", email: "omar@northwind.test", role: "Engineer", started: "2025-01-13" },
  { name: "Julia Novak", email: "julia@northwind.test", role: "Head of Sales", started: "2022-08-22" },
  { name: "Ravi Patel", email: "ravi@northwind.test", role: "Data Engineer", started: "2024-07-08" },
  { name: "Ellen Byrne", email: "ellen@northwind.test", role: "Finance & Operations", started: "2022-04-04" },
  { name: "Noah Kim", email: "noah@northwind.test", role: "Engineer", started: "2025-03-03" },
];

/** A live account with no person behind it — the untracked-accounts finding. */
const ORPHAN = "ci-deploy@northwind.test";

const VENDORS = [
  { name: "Amazon Web Services", website: "https://aws.amazon.com", category: "Infrastructure", risk_level: "critical", data_sensitivity: "pii", soc2_status: "on_file" },
  { name: "GitHub", website: "https://github.com", category: "Source control", risk_level: "high", data_sensitivity: "internal", soc2_status: "on_file" },
  { name: "Google Workspace", website: "https://workspace.google.com", category: "Identity & email", risk_level: "high", data_sensitivity: "pii", soc2_status: "on_file" },
  { name: "Slack", website: "https://slack.com", category: "Communication", risk_level: "medium", data_sensitivity: "internal", soc2_status: "on_file" },
  { name: "Stripe", website: "https://stripe.com", category: "Payments", risk_level: "high", data_sensitivity: "pii", soc2_status: "requested" },
];

const RISKS = [
  { title: "A leaver keeps access to production", category: "Access", likelihood: "medium", impact: "high", status: "mitigating", treatment: "Daily offboarding check against the Personnel register." },
  { title: "One engineer holds the AWS root credentials", category: "Access", likelihood: "low", impact: "high", status: "open", treatment: "Move root to a hardware key held by two people." },
  { title: "Database restore has never been tested", category: "Resilience", likelihood: "medium", impact: "high", status: "open", treatment: "Quarterly restore drill into a staging account." },
];

async function main() {
  const email = process.env.RECORDING_EMAIL;
  if (!email) throw new Error("Set RECORDING_EMAIL in .env.local");

  const { createAdminSupabase } = await import("@/lib/supabase/admin");
  const { propagateMeasuresToControls } = await import("@/lib/measures");
  const { recordChecksForSyncAdmin } = await import("@/lib/checks");
  const db = createAdminSupabase();

  // --- find the workspace ---------------------------------------------------
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const user = users?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No user for ${email}`);
  const { data: member } = await db
    .from("company_members").select("company_id").eq("user_id", user.id).eq("role", "owner").single();
  const companyId = member!.company_id as string;
  const log = (s: string) => console.log(`  ${s}`);
  console.log(`Seeding ${companyId}`);

  await db.from("companies").update({ name: COMPANY_NAME }).eq("id", companyId);
  log(`name → ${COMPANY_NAME}`);

  // --- frameworks: mirror what add_framework_to_company does -------------------
  for (const name of FRAMEWORKS) {
    const { data: fw } = await db.from("frameworks").select("id").eq("name", name).single();
    const { data: has } = await db
      .from("company_frameworks").select("framework_id").eq("company_id", companyId).eq("framework_id", fw!.id).maybeSingle();
    if (has) { log(`${name} already on`); continue; }
    await db.from("company_frameworks").insert({ company_id: companyId, framework_id: fw!.id });
    const { data: controls } = await db.from("controls").select("id").eq("framework_id", fw!.id);
    await db.from("control_status").upsert(
      (controls ?? []).map((c) => ({ company_id: companyId, control_id: c.id, status: "not_started" })),
      { onConflict: "company_id,control_id", ignoreDuplicates: true },
    );
    log(`${name} switched on (${controls?.length} requirements)`);
  }

  // --- people --------------------------------------------------------------
  const { data: existingPeople } = await db.from("personnel").select("email").eq("company_id", companyId);
  const known = new Set((existingPeople ?? []).map((p) => (p.email ?? "").toLowerCase()));
  const newPeople = [
    ...PEOPLE.map((p) => ({ name: p.name, email: p.email, role_title: p.role, started_at: p.started, status: "active", ended_at: null })),
    { name: LEAVER.name, email: LEAVER.email, role_title: LEAVER.role, started_at: "2023-02-13", status: "offboarded", ended_at: LEAVER.ended },
  ].filter((p) => !known.has(p.email));
  if (newPeople.length) await db.from("personnel").insert(newPeople.map((p) => ({ ...p, company_id: companyId })));
  log(`${newPeople.length} people added`);

  // --- vendors & risks -------------------------------------------------------
  const { data: existingVendors } = await db.from("vendors").select("name").eq("company_id", companyId);
  const haveVendor = new Set((existingVendors ?? []).map((v) => v.name));
  const newVendors = VENDORS.filter((v) => !haveVendor.has(v.name));
  if (newVendors.length) {
    await db.from("vendors").insert(newVendors.map((v) => ({ ...v, company_id: companyId, status: "active", review_cadence_months: 12 })));
  }
  log(`${newVendors.length} vendors added`);

  const { data: existingRisks } = await db.from("risks").select("title").eq("company_id", companyId);
  const haveRisk = new Set((existingRisks ?? []).map((r) => r.title));
  const newRisks = RISKS.filter((r) => !haveRisk.has(r.title));
  if (newRisks.length) await db.from("risks").insert(newRisks.map((r) => ({ ...r, company_id: companyId })));
  log(`${newRisks.length} risks added`);

  // --- measures a person would have done --------------------------------------
  const { data: measures } = await db.from("measures").select("id, key").in("key", DONE_MEASURES);
  const measureIds = (measures ?? []).map((m) => m.id as string);
  await db.from("measure_status").upsert(
    measureIds.map((id) => ({
      company_id: companyId,
      measure_id: id,
      status: "complete",
      notes: "Sample data for the product recording.",
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "company_id,measure_id" },
  );
  const advanced = await propagateMeasuresToControls(db, companyId, measureIds, null);
  log(`${measureIds.length} measures complete → ${advanced} requirements advanced`);

  // --- identity checks, through the real evaluators ---------------------------
  const roster = [
    ...PEOPLE.map((p) => ({ primaryEmail: p.email, suspended: false })),
    { primaryEmail: LEAVER.email, suspended: false }, // left in August, account still live
    { primaryEmail: ORPHAN, suspended: false },       // nobody behind it
  ];
  const posture = {
    total: roster.length,
    with2fa: roster.length - 1,
    admins: 2,
    suspended: 0,
    roster,
    truncated: false,
  };
  const checks = await recordChecksForSyncAdmin(db, companyId, "google", posture, null);
  for (const c of checks) log(`check ${c.checkKey}: ${c.result}`);

  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
