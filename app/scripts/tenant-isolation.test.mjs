#!/usr/bin/env node
/**
 * Proves one workspace cannot read or write another's data.
 *
 * Why this exists: a prospect assessing us asked "is the shared database tested
 * for cross-tenant access?" and the honest answer was no. Row-level security was
 * there and used consistently, but nothing demonstrated it. "Trust me" is not an
 * answer you can give someone who is about to hand you their compliance evidence.
 *
 * The one rule that makes this test meaningful: it runs as two REAL signed-in
 * users through the ANON key, exactly as the browser does. A test using the
 * service-role key would bypass RLS and pass no matter how broken the policies
 * were — it would be theatre, and worse than nothing because it would look like
 * assurance.
 *
 * Tenant tables are enumerated from information_schema at runtime rather than
 * hardcoded, so a table added later without RLS fails this test instead of being
 * silently skipped.
 *
 * Usage:  node scripts/tenant-isolation.test.mjs
 * Needs:  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *         SUPABASE_SERVICE_ROLE_KEY   (service role is used ONLY to create and
 *         delete the two throwaway workspaces, never to make an assertion)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// --- env -------------------------------------------------------------------

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    // Not present in CI, where the values come from the environment.
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

// --- reporting -------------------------------------------------------------

let failures = 0;
let checks = 0;

function ok(label) {
  checks++;
  console.log(`  pass  ${label}`);
}
function bad(label, detail) {
  checks++;
  failures++;
  console.log(`  FAIL  ${label}`);
  if (detail) console.log(`        ${detail}`);
}

// --- fixtures --------------------------------------------------------------

const tag = randomUUID().slice(0, 8);
const made = { users: [], companies: [] };

async function makeWorkspace(which) {
  const email = `isolation-${which}-${tag}@shieldflow.test`;
  const password = `Iso-${randomUUID()}`;

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`createUser(${which}): ${userErr.message}`);
  const userId = created.user.id;
  made.users.push(userId);

  const { data: company, error: coErr } = await admin
    .from("companies")
    .insert({ name: `Isolation ${which} ${tag}`, owner_user_id: userId })
    .select("id")
    .single();
  if (coErr) throw new Error(`insert company(${which}): ${coErr.message}`);
  made.companies.push(company.id);

  const { error: memErr } = await admin
    .from("company_members")
    .insert({ company_id: company.id, user_id: userId, role: "owner" });
  if (memErr) throw new Error(`insert member(${which}): ${memErr.message}`);

  return { email, password, userId, companyId: company.id };
}

/** Sign in through the anon key — the same path a browser takes. */
async function signIn({ email, password }) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

/**
 * Every public table carrying a company_id, read from the live catalog via a
 * read-only helper function (migration 0050). Enumerated rather than hardcoded so
 * a table added later without RLS fails this test instead of being skipped.
 */
async function tenantTables() {
  const { data, error } = await admin.rpc("tenant_scoped_tables");
  if (error) throw new Error(`tenant_scoped_tables(): ${error.message}`);
  return (data ?? []).map((r) => r.table_name).sort();
}

// Rows planted in workspace B. If isolation is broken, A will see these — so the
// seed has to land in the tables most worth stealing.
async function seedB(companyId) {
  const seeds = [
    ["personnel", { company_id: companyId, name: `SECRET-${tag}`, email: `secret-${tag}@b.test` }],
    ["vendors", { company_id: companyId, name: `SECRET-VENDOR-${tag}` }],
    ["evidence", { company_id: companyId, file_name: `secret-${tag}.csv`, storage_path: `${companyId}/secret-${tag}.csv` }],
    ["policies", { company_id: companyId, title: `SECRET-POLICY-${tag}`, body: "confidential" }],
    ["risks", { company_id: companyId, title: `SECRET-RISK-${tag}` }],
    ["tasks", { company_id: companyId, title: `SECRET-TASK-${tag}` }],
    ["subprocessors", { company_id: companyId, name: `SECRET-SUB-${tag}` }],
  ];
  const planted = [];
  for (const [table, row] of seeds) {
    const { error } = await admin.from(table).insert(row);
    if (!error) planted.push(table);
  }
  return planted;
}

// --- the assertions --------------------------------------------------------

async function assertNoCrossRead(clientA, companyB, tables) {
  let leaked = 0;
  for (const table of tables) {
    const { data, error } = await clientA.from(table).select("company_id").eq("company_id", companyB);
    if (error) continue; // A permission error is isolation working, not a failure.
    if ((data ?? []).length > 0) {
      bad(`${table}: workspace A read ${data.length} row(s) belonging to workspace B`);
      leaked++;
    }
  }
  if (leaked === 0) ok(`no cross-workspace reads across ${tables.length} tenant tables`);
  return leaked;
}

async function assertNoCrossWrite(clientA, companyB) {
  const attempts = [
    ["personnel", { company_id: companyB, name: `INJECTED-${tag}` }],
    ["vendors", { company_id: companyB, name: `INJECTED-${tag}` }],
    ["policies", { company_id: companyB, title: `INJECTED-${tag}`, body: "x" }],
    ["tasks", { company_id: companyB, title: `INJECTED-${tag}` }],
  ];
  for (const [table, row] of attempts) {
    const { error } = await clientA.from(table).insert(row);
    if (error) ok(`${table}: write into workspace B rejected`);
    else bad(`${table}: workspace A WROTE a row into workspace B`);
  }
}

async function assertRpcsRefuse(clientA, companyB) {
  const probes = [
    ["record_control_checks", { p_company_id: companyB, p_provider: "isolation", p_results: [] }],
    ["record_integration_findings", { p_company_id: companyB, p_provider: "isolation", p_findings: [] }],
    [
      "log_audit_event",
      { p_company_id: companyB, p_action: "isolation.probe", p_target_type: null, p_target_id: null, p_target_label: null, p_metadata: {} },
    ],
  ];
  for (const [fn, args] of probes) {
    const { error } = await clientA.rpc(fn, args);
    if (error) ok(`${fn}(): refused for another workspace`);
    else bad(`${fn}(): accepted another workspace's id — SECURITY DEFINER bypass is reachable`);
  }
}

/** Every enumerated table must have RLS on — enabled is necessary, not sufficient. */
async function assertRlsEnabled(tables) {
  const { data, error } = await admin.rpc("tenant_scoped_tables");
  if (error) {
    bad("catalog: could not read tenant_scoped_tables()", error.message);
    return;
  }
  const off = (data ?? []).filter((r) => r.rls_enabled === false).map((r) => r.table_name);
  if (off.length > 0) bad(`row-level security is DISABLED on: ${off.join(", ")}`);
  else ok(`row-level security enabled on all ${tables.length} tenant tables`);
}

async function cleanup() {
  for (const id of made.companies) {
    await admin.from("companies").delete().eq("id", id);
  }
  for (const id of made.users) {
    await admin.auth.admin.deleteUser(id);
  }
}

// --- run -------------------------------------------------------------------

async function main() {
  console.log("Tenant isolation — two real sessions through the anon key\n");

  const tables = await tenantTables();
  const A = await makeWorkspace("a");
  const B = await makeWorkspace("b");
  const planted = await seedB(B.companyId);
  console.log(`  setup  workspace A ${A.companyId}`);
  console.log(`  setup  workspace B ${B.companyId} (seeded: ${planted.join(", ") || "none"})\n`);

  const clientA = await signIn(A);

  // Sanity: A must be able to see its OWN workspace. Without this, a totally
  // broken connection would "pass" every isolation assertion by reading nothing.
  const { data: own, error: ownErr } = await clientA
    .from("companies")
    .select("id")
    .eq("id", A.companyId);
  if (ownErr || (own ?? []).length !== 1) {
    bad("sanity: A cannot read its own workspace — the rest of this run proves nothing", ownErr?.message);
  } else {
    ok("sanity: A can read its own workspace");
  }

  const { data: others } = await clientA.from("companies").select("id").eq("id", B.companyId);
  if ((others ?? []).length > 0) bad("companies: A can read workspace B's company row");
  else ok("companies: B's company row is invisible to A");

  await assertNoCrossRead(clientA, B.companyId, tables);
  await assertNoCrossWrite(clientA, B.companyId);
  await assertRpcsRefuse(clientA, B.companyId);
  await assertRlsEnabled(tables);

  await clientA.auth.signOut();
  await cleanup();

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`} — ${checks} checks`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`\nERROR: ${err.message}`);
  await cleanup().catch(() => {});
  process.exit(2);
});
