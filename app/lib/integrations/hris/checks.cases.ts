/**
 * Branch cases for the HR integrations: the Personnel sync plan and the checks.
 * Run with:  npx tsx lib/integrations/hris/checks.cases.ts
 */
import { planPersonnelSync, type PersonnelRow } from "@/lib/integrations/hris/sync";
import { evaluateHris, employeeResource, type HrisEvaluateOptions } from "@/lib/integrations/hris/evaluate";
import { hrState, normalizeBambooSubdomain, type HrEmployee } from "@/lib/integrations/hris/clients";
import { ok, denied, type CheckOutcome } from "@/lib/checks-core";

const TODAY = "2026-10-15";
const NOW = new Date(`${TODAY}T12:00:00Z`);
let failures = 0;
function expect(label: string, got: unknown, want: unknown) {
  const pass = got === want;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  -> ${String(got)}${pass ? "" : ` (wanted ${String(want)})`}`);
}
const get = (rs: CheckOutcome[], key: string) => {
  const r = rs.find((x) => x.key === key);
  if (!r) throw new Error(`no result for ${key}`);
  return r;
};

const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee => ({
  externalId: id, name: `Person ${id}`, email: `p${id}@acme.com`, title: "Engineer", startDate: "2024-01-10", endDate: null, active: true, ...over,
});
const row = (id: string, over: Partial<PersonnelRow> = {}): PersonnelRow => ({
  id, name: `Person ${id}`, email: `p${id}@acme.com`, role_title: "Engineer", status: "active", started_at: "2024-01-10", ended_at: null, source: null, external_id: null, ...over,
});

// ------------------------------------------------------------------ state
expect("no end date, active → active", hrState(emp("1"), TODAY), "active");
expect("end date in the future → leaving (notice period)", hrState(emp("1", { endDate: "2026-11-30" }), TODAY), "leaving");
expect("end date today → left", hrState(emp("1", { endDate: TODAY }), TODAY), "left");
expect("inactive without a date → left", hrState(emp("1", { active: false }), TODAY), "left");

// ------------------------------------------------------------- sync plan
const adopt = planPersonnelSync("personio", [emp("1")], [row("a", { email: "P1@ACME.com" })], TODAY);
expect("a hand-made row is adopted by email, not duplicated", adopt.inserts.length, 0);
expect("…and tagged with the HR source", adopt.updates[0]?.patch.source, "personio");
const fresh = planPersonnelSync("personio", [emp("2")], [], TODAY);
expect("a new joiner is added", fresh.inserts.length, 1);
const leaving = planPersonnelSync("personio", [emp("1", { endDate: "2026-11-30" })], [row("a", { source: "personio", external_id: "1" })], TODAY);
expect("notice period: stays active…", leaving.updates[0]?.patch.status ?? "unchanged", "unchanged");
expect("…with the leaving date set", leaving.updates[0]?.patch.ended_at, "2026-11-30");
const left = planPersonnelSync("personio", [emp("1", { endDate: "2026-09-30", active: false })], [row("a", { source: "personio", external_id: "1" })], TODAY);
expect("a leaver is offboarded", left.updates[0]?.patch.status, "offboarded");
expect("…and reported as offboarded", left.updates[0]?.offboarded, true);
const ancient = planPersonnelSync("personio", [emp("9", { endDate: "2023-01-31", active: false })], [], TODAY);
expect("a leaver gone 2+ years who was never in Personnel isn't imported", ancient.inserts.length, 0);
const recentLeaver = planPersonnelSync("personio", [emp("9", { endDate: "2026-06-30", active: false })], [], TODAY);
expect("a recent leaver is imported (for the leaver checks)", recentLeaver.inserts[0]?.status, "offboarded");
const keepEmail = planPersonnelSync("personio", [emp("1", { email: null })], [row("a", { source: "personio", external_id: "1" })], TODAY);
expect("HR without an email never blanks Personnel's", "email" in (keepEmail.updates[0]?.patch ?? {}) ? "blanked" : "kept", "kept");
const same = planPersonnelSync("personio", [emp("1")], [row("1", { source: "personio", external_id: "1" })], TODAY);
expect("nothing changed → no update", same.updates.length, 0);
const rehire = planPersonnelSync("personio", [emp("1")], [row("a", { source: "personio", external_id: "1", status: "offboarded", ended_at: "2025-01-01" })], TODAY);
expect("a rehire is made active again", rehire.updates[0]?.patch.status, "active");
const twoRecords = planPersonnelSync("personio", [emp("1"), emp("2", { email: "p1@acme.com" })], [row("a")], TODAY);
expect("two HR records with one email don't both claim the same person", twoRecords.updates.length + twoRecords.inserts.length, 2);
const manualOnly = planPersonnelSync("personio", [emp("1")], [row("a"), row("contractor", { email: "c@agency.com" })], TODAY);
expect("people not in HR (contractors) are left alone", manualOnly.updates.every((u) => u.id !== "contractor") ? "untouched" : "touched", "untouched");

// ----------------------------------------------------------------- checks
const opts: HrisEvaluateOptions = { now: NOW, exceptions: [], training: [{ email: "p1@acme.com", completed: true }], trainingDays: 30 };
const run = (list: HrEmployee[], o: Partial<HrisEvaluateOptions> = {}, truncated = false, missing: string[] = []) => evaluateHris("personio", ok(list), truncated, missing, { ...opts, ...o });
const clean = run([emp("1")]);
expect("clean: all pass", ["personio.records_complete", "personio.leaving_dates", "personio.joiners_training"].filter((k) => get(clean, k).result !== "pass").join(",") || "all pass", "all pass");
expect("an employee without a work email fails", get(run([emp("1"), emp("2", { email: null })]), "personio.records_complete").result, "fail");
expect("a leaver's missing email doesn't matter", get(run([emp("1"), emp("2", { email: null, endDate: "2026-01-01", active: false })]), "personio.records_complete").result, "pass");
expect("a leaver without a leaving date fails", get(run([emp("1"), emp("2", { active: false })]), "personio.leaving_dates").result, "fail");
expect("termination field unreadable → must NOT pass", get(run([emp("1")], {}, false, ["termination_date"]), "personio.leaving_dates").result, "inconclusive");
expect("email field unreadable → must NOT pass", get(run([emp("1")], {}, false, ["email"]), "personio.records_complete").result, "inconclusive");
expect("more people than read → must NOT pass", get(run([emp("1")], {}, true), "personio.records_complete").result, "inconclusive");
const joiner = emp("3", { startDate: "2026-08-01" });
expect("a joiner 75 days in without training fails", get(run([joiner]), "personio.joiners_training").result, "fail");
expect("a joiner inside the 30 days isn't due yet", get(run([emp("4", { startDate: "2026-10-01" })]), "personio.joiners_training").result, "pass");
expect("a joiner with training done passes", get(run([joiner], { training: [{ email: "p3@acme.com", completed: true }] }), "personio.joiners_training").result, "pass");
expect("training assigned but not completed still fails", get(run([joiner], { training: [{ email: "p3@acme.com", completed: false }] }), "personio.joiners_training").result, "fail");
expect("training unreadable → must NOT pass", get(run([joiner], { training: null }), "personio.joiners_training").result, "inconclusive");
expect("joiner without email → must NOT pass", get(run([emp("5", { startDate: "2026-08-01", email: null })]), "personio.joiners_training").result, "inconclusive");
expect("long-tenured people are the annual training's job, not this check", get(run([emp("6", { startDate: "2020-01-01" })]), "personio.joiners_training").result, "pass");
const excepted = run([joiner], { exceptions: [{ checkKey: "personio.joiners_training", resourceId: employeeResource("personio", joiner).id, reason: "on parental leave since week 2", expiresAt: null }] });
expect("an exception accepts the joiner", get(excepted, "personio.joiners_training").result, "pass");
expect("employees unreadable → must NOT pass", get(evaluateHris("personio", denied("employees"), false, [], opts), "personio.records_complete").result, "inconclusive");

// -------------------------------------------------------------- BambooHR
expect("subdomain from a full URL", normalizeBambooSubdomain("https://acme.bamboohr.com/home"), "acme");
expect("plain subdomain", normalizeBambooSubdomain("acme-eu"), "acme-eu");
expect("path traversal rejected", normalizeBambooSubdomain("../evil"), null);

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
