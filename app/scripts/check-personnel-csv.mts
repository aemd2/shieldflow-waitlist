// Regression check for the personnel CSV parser against the fixture files in
// docs/test-fixtures/personnel-csv. No test framework in this repo — run:
//   node --experimental-strip-types scripts/check-personnel-csv.mts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePersonnelCsv } from "../lib/csv.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "..", "docs", "test-fixtures", "personnel-csv");
const load = (f: string) => parsePersonnelCsv(readFileSync(join(fixtures, f), "utf8"));

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}`, detail !== undefined ? JSON.stringify(detail, null, 2) : "");
  }
}

console.log("01-template-exact.csv");
{
  const rows = load("01-template-exact.csv");
  check("2 rows", rows.length === 2, rows);
  check("row 1 mapped", rows[0]?.name === "Alice Doe" && rows[0]?.email === "alice@acme.com" && rows[0]?.role_title === "Engineer" && rows[0]?.started_at === "2026-01-15", rows[0]);
}

console.log("02-reordered-columns.csv");
{
  const rows = load("02-reordered-columns.csv");
  check("2 rows", rows.length === 2, rows);
  check("email,role,name order mapped", rows[0]?.name === "Carol King" && rows[0]?.email === "carol@acme.com" && rows[0]?.role_title === "Product Manager", rows[0]);
}

console.log("03-first-last-plus-id.csv");
{
  const rows = load("03-first-last-plus-id.csv");
  check("3 rows", rows.length === 3, rows);
  check("first+last joined", rows[0]?.name === "Erin Malone", rows[0]);
  check("work email header mapped", rows[2]?.email === "grace.hopper@acme.com", rows[2]);
  check("employee_id not used as name", rows.every((r) => !/^\d+$/.test(r.name)), rows);
}

console.log("04-semicolon-eu-excel.csv");
{
  const rows = load("04-semicolon-eu-excel.csv");
  check("2 rows (BOM + ; delimiter)", rows.length === 2, rows);
  check('quoted "Rossi, Marco" intact', rows[0]?.name === "Rossi, Marco" && rows[0]?.email === "marco.rossi@acme.com", rows[0]);
}

console.log("05-quoted-commas.csv");
{
  const rows = load("05-quoted-commas.csv");
  check("2 rows", rows.length === 2, rows);
  check("embedded comma in name", rows[0]?.name === "Doe, Jane" && rows[0]?.role_title === "VP, Engineering", rows[0]);
  check("doubled quotes unescaped", rows[1]?.name === `O'Brien, Patrick "Pat"`, rows[1]);
}

console.log("06-duplicates.csv");
{
  const rows = load("06-duplicates.csv");
  // Parser itself keeps duplicates — dedupe is the UI/server's job (flag + skip).
  check("4 rows parsed (dedupe happens later)", rows.length === 4, rows);
  check("dupe rows identical", rows[0]?.email === rows[1]?.email, rows.slice(0, 2));
}

console.log("07-no-header-messy.csv");
{
  const rows = load("07-no-header-messy.csv");
  check("4 rows (blank lines skipped)", rows.length === 4, rows);
  check("email-first order inferred", rows[0]?.name === "Jack Sparrow" && rows[0]?.email === "jack@acme.com", rows[0]);
  check("bad email cell -> empty email, name kept", rows[1]?.name === "Karen Page" && rows[1]?.email === "", rows[1]);
  check("short name preserved for inline fix", rows[2]?.name === "L", rows[2]);
  check("numeric ID column ignored", rows.every((r) => r.role_title !== "10001" && !/^\d+$/.test(r.name)), rows);
}

console.log("08-dates-mixed.csv");
{
  const rows = load("08-dates-mixed.csv");
  check("ISO date kept", rows[0]?.started_at === "2026-03-01", rows[0]);
  check("15.01.2026 -> 2026-01-15 (day>12 disambiguates)", rows[1]?.started_at === "2026-01-15", rows[1]);
  check("ambiguous 03/04/2026 dropped, row kept", rows[2]?.started_at === "" && rows[2]?.name === "Pia Mia", rows[2]);
  check("2026/07/01 -> 2026-07-01", rows[3]?.started_at === "2026-07-01", rows[3]);
}

console.log("09-international.csv");
{
  const rows = load("09-international.csv");
  check("3 rows (German header dropped)", rows.length === 3, rows);
  check("Vorname+Nachname joined, accents intact", rows[0]?.name === "José García", rows[0]);
  check("Cyrillic name intact", rows[1]?.name === "Иван Петров", rows[1]);
  check("Position header -> role", rows[2]?.role_title === "Designerin", rows[2]);
}

console.log("paste-style inputs (same parser)");
{
  const tabbed = parsePersonnelCsv("Alice Doe\talice@acme.com\tEngineer\nBob Lee\tbob@acme.com\tDesigner");
  check("tab-separated paste", tabbed.length === 2 && tabbed[0]?.email === "alice@acme.com", tabbed);
  const emailFirst = parsePersonnelCsv("alice@acme.com, Alice Doe\nbob@acme.com, Bob Lee");
  check("email-first paste order detected", emailFirst[0]?.name === "Alice Doe" && emailFirst[0]?.email === "alice@acme.com", emailFirst);
  const emailOnly = parsePersonnelCsv("carol.king@acme.com\ndave.grohl@acme.com");
  check("bare email list -> names derived", emailOnly[0]?.name === "Carol King" && emailOnly[0]?.email === "carol.king@acme.com", emailOnly);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
