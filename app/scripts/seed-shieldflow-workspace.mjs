#!/usr/bin/env node
/**
 * Create ShieldFlow's own workspace, so we run ShieldFlow on ShieldFlow.
 *
 * Why: a reviewer pointed out that customers have to vet us as a vendor — we
 * hold their evidence and their integration tokens — and we had no SOC 2 report,
 * no security page and no trust centre of our own. /security answers part of it.
 * The rest is doing the work in the product and publishing the trust centre the
 * product already renders.
 *
 * WHAT THIS SCRIPT DOES: the part that is factually derivable from this
 * repository, so nobody has to retype it —
 *   - the workspace, with SOC 2 and GDPR selected
 *   - the subprocessor list, matching privacy/page.tsx section 5 exactly
 *   - the matching vendor register entries
 *   - a risk register seeded ONLY with limitations this repo actually documents
 *     (see security/page.tsx section 8). Every one of these is already public,
 *     so none of it is a new admission.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   - invent personnel, policies, or a control status we haven't earned
 *   - connect integrations (needs real credentials)
 *   - publish the trust centre
 *
 * That last one matters. A trust centre showing 15% complete is worse than no
 * trust centre: it advertises that we don't do the thing we sell. Publish only
 * when it reflects real work.
 *
 * Idempotent — safe to re-run; it upserts by name and never duplicates.
 *
 * Usage:  node scripts/seed-shieldflow-workspace.mjs <owner-email> [--apply]
 *         Without --apply it prints what it would do and changes nothing.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* env may come from the environment instead */
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const ownerEmail = process.argv[2];
const apply = process.argv.includes("--apply");
if (!ownerEmail || !ownerEmail.includes("@")) {
  console.error("Usage: node scripts/seed-shieldflow-workspace.mjs <owner-email> [--apply]");
  process.exit(2);
}

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const COMPANY_NAME = "ShieldFlow";

// Exactly the list in app/app/privacy/page.tsx section 5. If that page changes,
// change this with it — two lists that disagree is the problem we just fixed on
// the marketing side.
const SUBPROCESSORS = [
  { name: "Supabase", purpose: "Database, authentication and file storage — where customer compliance data lives at rest.", location: "European Union (eu-west-1)", url: "https://supabase.com/privacy" },
  { name: "Vercel", purpose: "Application hosting and delivery.", location: "Global edge; EU region for compute", url: "https://vercel.com/legal/privacy-policy" },
  { name: "Groq", purpose: "AI inference for the Co-Pilot, policy generation and questionnaire drafting. Zero Data Retention enabled; aggregate context only.", location: "United States", url: "https://groq.com/privacy-policy/" },
  { name: "Stripe", purpose: "Payment processing. Card details are never seen or stored by ShieldFlow.", location: "United States / European Union", url: "https://stripe.com/privacy" },
  { name: "Resend", purpose: "Transactional email — sign-in links and notifications.", location: "United States", url: "https://resend.com/legal/privacy-policy" },
];

const VENDORS = [
  { name: "Supabase", website: "https://supabase.com", category: "Infrastructure", risk_level: "critical", data_sensitivity: "pii", soc2_status: "on_file", notes: "Holds all customer compliance data and evidence files. EU region." },
  { name: "Vercel", website: "https://vercel.com", category: "Infrastructure", risk_level: "high", data_sensitivity: "internal", soc2_status: "on_file", notes: "Application hosting. Processes requests but does not store customer data." },
  { name: "Groq", website: "https://groq.com", category: "AI / subprocessor", risk_level: "medium", data_sensitivity: "internal", soc2_status: "requested", notes: "Zero Data Retention enabled. Receives aggregate context plus user-typed text with identifiers redacted." },
  { name: "Stripe", website: "https://stripe.com", category: "Payments", risk_level: "medium", data_sensitivity: "none", soc2_status: "on_file", notes: "PCI DSS Level 1. ShieldFlow never handles card data." },
  { name: "Resend", website: "https://resend.com", category: "Email", risk_level: "low", data_sensitivity: "pii", soc2_status: "requested", notes: "Email addresses only." },
  { name: "GitHub", website: "https://github.com", category: "Source control", risk_level: "high", data_sensitivity: "internal", soc2_status: "on_file", notes: "Source code and CI." },
];

// Only limitations this repo already publishes on /security. Nothing new is
// being admitted here — it is the same list, in the register where it belongs.
const RISKS = [
  { title: "Encryption key held in the server environment, not a managed KMS", description: "Integration tokens are AES-256-GCM encrypted with a key from SHIELDFLOW_ENCRYPTION_KEY. Rotation is scripted (scripts/reencrypt-secrets.mjs) but manual, and there is no automatic rotation or hardware-backed key store.", category: "Technical", likelihood: "low", impact: "high", status: "accepted", treatment: "Accepted for now and disclosed publicly on /security. Revisit with a managed KMS before the first enterprise customer." },
  { title: "No SOC 2 report or penetration test for ShieldFlow itself", description: "Customers must vet us as a vendor because we hold their evidence and tokens, and we have neither an audit report nor an external test to show them.", category: "Compliance", likelihood: "high", impact: "medium", status: "mitigating", treatment: "Published /security and /checks as an interim answer. Running ShieldFlow through ShieldFlow; commission an external test and a Type I audit." },
  { title: "Known dependency advisory: zod below 4.6.6", description: "Memory exhaustion when validating oversized constrained collections. Fixing it requires the zod 3 to 4 migration across every validation schema. CI blocks on critical and reports high, so this stays visible.", category: "Technical", likelihood: "low", impact: "medium", status: "open", treatment: "Migrate to zod 4, then tighten the CI audit gate from critical to high." },
  { title: "Single-operator company — concentration of knowledge and access", description: "One person operates the service, holds production access and is the only one who can respond to an incident.", category: "Operational", likelihood: "medium", impact: "high", status: "open", treatment: "Documented runbooks; a second trusted operator before taking on customers with uptime commitments." },
  { title: "Audit trail cannot be exported", description: "The per-workspace audit trail is readable and filterable in the app, but there is no file export to hand to an auditor.", category: "Compliance", likelihood: "medium", impact: "low", status: "open", treatment: "Add a CSV export of the activity trail." },
];

async function main() {
  console.log(`${apply ? "APPLYING" : "DRY RUN (pass --apply to write)"}\n`);

  const { data: list, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw new Error(`listUsers: ${listErr.message}`);
  const owner = list.users.find((u) => u.email?.toLowerCase() === ownerEmail.toLowerCase());
  if (!owner) {
    console.error(
      `No account found for ${ownerEmail}.\n` +
        "Sign up at /signup with that address first — the workspace needs a real\n" +
        "account that can log in and do the work, not one created behind its back.",
    );
    process.exit(1);
  }

  const { data: already } = await db.from("companies").select("id").eq("name", COMPANY_NAME).maybeSingle();
  let companyId = already?.id;

  // Refuse only if the owner belongs to a DIFFERENT workspace. Owning the
  // ShieldFlow one already is the normal state on every run after the first —
  // treating that as a conflict would make the "idempotent" claim above false.
  const { data: memberships } = await db
    .from("company_members")
    .select("company_id, companies(name)")
    .eq("user_id", owner.id);
  const elsewhere = (memberships ?? []).filter((m) => m.company_id !== companyId);
  if (elsewhere.length > 0) {
    const names = elsewhere.map((m) => m.companies?.name ?? m.company_id).join(", ");
    console.error(
      `${ownerEmail} already belongs to a different workspace (${names}).\n` +
        "getCompanyForUser resolves one company per user by oldest membership, so\n" +
        "adding a second would be ambiguous. Use a dedicated address for ShieldFlow's\n" +
        "own workspace.",
    );
    process.exit(1);
  }

  if (!companyId) {
    console.log(`  + company "${COMPANY_NAME}" owned by ${ownerEmail}`);
    if (apply) {
      const { data, error } = await db
        .from("companies")
        .insert({ name: COMPANY_NAME, owner_user_id: owner.id })
        .select("id")
        .single();
      if (error) throw new Error(`insert company: ${error.message}`);
      companyId = data.id;
      const { error: memErr } = await db
        .from("company_members")
        .insert({ company_id: companyId, user_id: owner.id, role: "owner" });
      if (memErr) throw new Error(`insert member: ${memErr.message}`);
    }
  } else {
    console.log(`  = company "${COMPANY_NAME}" already exists (${companyId})`);
  }

  const { data: frameworks } = await db.from("frameworks").select("id, name");
  const { data: selected } = companyId
    ? await db.from("company_frameworks").select("framework_id").eq("company_id", companyId)
    : { data: [] };
  const selectedIds = new Set((selected ?? []).map((r) => r.framework_id));
  for (const want of ["SOC 2", "GDPR"]) {
    const fw = frameworks.find((f) => f.name === want);
    if (!fw) {
      console.log(`  ! framework "${want}" not found — skipped`);
      continue;
    }
    console.log(`  ${selectedIds.has(fw.id) ? "=" : "+"} framework ${want}`);
    if (apply && companyId) {
      await db.from("company_frameworks").upsert(
        { company_id: companyId, framework_id: fw.id },
        { onConflict: "company_id,framework_id" },
      );
      // add_framework_to_company() does TWO things: the company_frameworks row
      // and a control_status row per control. It can't be called from here
      // because it derives the actor from auth.uid() and this runs as the
      // service role — so both halves have to be done by hand.
      //
      // Doing only the first half is what happened the first time this ran:
      // SOC 2 and GDPR appeared in scope with zero controls and a bar stuck at
      // 0%, because a framework with no control_status rows has nothing to
      // measure. A framework in scope without its controls is not a framework.
      const { data: ctrls } = await db.from("controls").select("id").eq("framework_id", fw.id);
      const rows = (ctrls ?? []).map((c) => ({
        company_id: companyId,
        control_id: c.id,
        status: "not_started",
        updated_by: owner.id,
      }));
      if (rows.length > 0) {
        // ignoreDuplicates so a re-run never resets work already done.
        const { error } = await db
          .from("control_status")
          .upsert(rows, { onConflict: "company_id,control_id", ignoreDuplicates: true });
        if (error) console.log(`    ! control_status: ${error.message}`);
        else console.log(`      ${rows.length} controls`);
      }
    }
  }

  for (const [table, rows, label] of [
    ["subprocessors", SUBPROCESSORS, "subprocessor"],
    ["vendors", VENDORS, "vendor"],
    ["risks", RISKS, "risk"],
  ]) {
    for (const row of rows) {
      const key = row.name ?? row.title;
      const column = row.name ? "name" : "title";
      const { data: found } = companyId
        ? await db.from(table).select("id").eq("company_id", companyId).eq(column, key).maybeSingle()
        : { data: null };
      if (found) {
        console.log(`  = ${label}: ${key}`);
        continue;
      }
      console.log(`  + ${label}: ${key}`);
      if (apply && companyId) {
        const payload = { company_id: companyId, ...row };
        if (table === "vendors") payload.status = "active";
        const { error } = await db.from(table).insert(payload);
        if (error) console.log(`    ! ${error.message}`);
      }
    }
  }

  console.log(`\n${apply ? "Done." : "Nothing written."}`);
  console.log(`
Still yours to do, and deliberately not faked here:
  1. Connect ShieldFlow's own AWS, GitHub and Google Workspace — the checks then
     run against us, which is the actual proof the product works.
  2. Generate and approve the policies.
  3. Add the people, with start dates.
  4. Work the controls honestly. Anything not done stays not done.
  5. Only then publish the trust centre, and link it from /security and the footer.

Publishing it at 15% would advertise that we don't do the thing we sell.`);
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(2);
});
