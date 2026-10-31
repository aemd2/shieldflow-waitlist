#!/usr/bin/env node
/**
 * Adding and removing a framework, exercised as a real signed-in user.
 *
 * Every assertion here runs through the ANON key with a real session, never the
 * service role. That distinction is the whole point: this feature shipped
 * broken and an earlier test passed it, because the test used the service role
 * and the service role bypasses RLS — so it validated everything except the
 * thing that was wrong.
 *
 * What was wrong, and what each case now pins down:
 *
 *   1. company_frameworks had no DELETE policy. Under RLS a DELETE matching no
 *      permitted row is not an error: it removes nothing and reports success.
 *      Removal silently did nothing while the UI said it had worked.
 *
 *   2. add_framework_to_company inserted control_status rows with no
 *      ON CONFLICT, and control_status is keyed (company_id, control_id).
 *      Removal keeps those rows on purpose so progress survives — so re-adding
 *      always hit a primary key violation. The Undo button calls that path.
 *
 *   3. Removing must not destroy work: statuses and uploaded evidence have to
 *      survive the round trip, or "your progress on it is kept" is a lie.
 *
 * Usage:  node scripts/framework-scope.test.mjs
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

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const stamp = Date.now();
let failures = 0;
const check = (ok, label, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
};

// Setup is allowed to use the admin client; assertions are not.
async function makeUser(tag) {
  const email = `fw-${tag}-${stamp}@example.com`;
  const password = `Pw-${stamp}-${tag}!x`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${tag}): ${error.message}`);
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn(${tag}): ${sErr.message}`);
  return { id: data.user.id, client };
}

let companyId;
const userIds = [];

try {
  const owner = await makeUser("owner");
  const member = await makeUser("member");
  userIds.push(owner.id, member.id);

  const { data: co, error: coErr } = await admin
    .from("companies").insert({ name: `FW Test ${stamp}`, owner_user_id: owner.id })
    .select("id").single();
  if (coErr) throw new Error(`company: ${coErr.message}`);
  companyId = co.id;
  await admin.from("company_members").insert([
    { company_id: companyId, user_id: owner.id, role: "owner" },
    { company_id: companyId, user_id: member.id, role: "member" },
  ]);

  // Two frameworks that actually have controls, so progress is measurable.
  const { data: fws } = await admin.from("frameworks").select("id, name");
  const withControls = [];
  for (const f of fws ?? []) {
    const { count } = await admin
      .from("controls").select("*", { count: "exact", head: true }).eq("framework_id", f.id);
    if (count > 0) withControls.push({ ...f, count });
    if (withControls.length === 2) break;
  }
  if (withControls.length < 2) throw new Error("need two frameworks with controls");
  const [A, B] = withControls;

  // ---- add, as the owner, through the RPC the app uses ----
  for (const f of [A, B]) {
    const { error } = await owner.client.rpc("add_framework_to_company", {
      p_company_id: companyId, p_framework_id: f.id,
    });
    if (error) throw new Error(`add ${f.name}: ${error.message}`);
  }
  const countStatus = async (fid) => {
    const { data } = await admin
      .from("control_status").select("control_id, controls!inner(framework_id)")
      .eq("company_id", companyId).eq("controls.framework_id", fid);
    return (data ?? []).length;
  };
  check((await countStatus(A.id)) === A.count, `adding ${A.name} creates its control rows`, `${A.count} expected`);

  // ---- do some work on A, and attach a file to one of its controls ----
  const { data: aControls } = await admin.from("controls").select("id").eq("framework_id", A.id).limit(1);
  const workedControl = aControls[0].id;
  const { error: upErr } = await owner.client
    .from("control_status").update({ status: "complete" })
    .eq("company_id", companyId).eq("control_id", workedControl);
  if (upErr) throw new Error(`mark complete: ${upErr.message}`);
  await admin.from("evidence").insert({
    company_id: companyId, control_id: workedControl,
    file_name: "policy.pdf", storage_path: `test/${stamp}.pdf`, uploaded_by: owner.id,
  });

  // ---- 1. a plain member must not be able to remove ----
  const { data: memberDeleted } = await member.client
    .from("company_frameworks").delete()
    .eq("company_id", companyId).eq("framework_id", A.id).select("framework_id");
  check((memberDeleted ?? []).length === 0, "a member cannot remove a framework");
  const { count: stillThere } = await admin
    .from("company_frameworks").select("*", { count: "exact", head: true })
    .eq("company_id", companyId).eq("framework_id", A.id);
  check(stillThere === 1, "...and the framework is still in scope");

  // ---- 2. the owner CAN remove, and the delete actually removes a row ----
  const { data: ownerDeleted, error: delErr } = await owner.client
    .from("company_frameworks").delete()
    .eq("company_id", companyId).eq("framework_id", A.id).select("framework_id");
  check(!delErr && (ownerDeleted ?? []).length === 1, "the owner can remove a framework", delErr?.message ?? "");
  const { count: gone } = await admin
    .from("company_frameworks").select("*", { count: "exact", head: true })
    .eq("company_id", companyId).eq("framework_id", A.id);
  check(gone === 0, "...and it is really gone from the database");

  // ---- 3. removal is non-destructive ----
  check((await countStatus(A.id)) === A.count, "removal keeps the control rows");
  const { data: stillComplete } = await admin
    .from("control_status").select("status").eq("company_id", companyId).eq("control_id", workedControl).single();
  check(stillComplete?.status === "complete", "removal keeps the work done on a control");
  const { count: evidenceLeft } = await admin
    .from("evidence").select("*", { count: "exact", head: true })
    .eq("company_id", companyId).eq("control_id", workedControl);
  check(evidenceLeft === 1, "removal keeps uploaded evidence files");

  // ---- 4. re-adding works (this is what Undo does) and restores the work ----
  const { error: readdErr } = await owner.client.rpc("add_framework_to_company", {
    p_company_id: companyId, p_framework_id: A.id,
  });
  check(!readdErr, "re-adding the framework succeeds", readdErr?.message ?? "");
  const { data: afterReadd } = await admin
    .from("control_status").select("status").eq("company_id", companyId).eq("control_id", workedControl).single();
  check(afterReadd?.status === "complete", "re-adding restores progress rather than resetting it");
  check((await countStatus(A.id)) === A.count, "re-adding does not duplicate control rows");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
} catch (err) {
  console.error(`\nERROR: ${err.message}`);
  failures++;
} finally {
  if (companyId) await admin.from("companies").delete().eq("id", companyId);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  console.log("cleaned up throwaway users and company");
}

process.exit(failures === 0 ? 0 : 1);
