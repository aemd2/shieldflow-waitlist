/**
 * Branch cases for lib/identity-checks.ts. Run with:  npx tsx lib/identity-checks.cases.ts
 *
 * Not wired into a test runner because this repo has none. It is kept anyway
 * because the failure mode these functions guard against is a check that
 * WRONGLY PASSES — telling a customer their leavers are deprovisioned when the
 * directory was only half read. Every "must NOT pass" case below exists because
 * that bug would be invisible in the UI and expensive at audit.
 *
 * Nothing imports this file, so it ships no code; tsc still typechecks it.
 */

import {
  evaluateOffboardingDrift,
  evaluateUntrackedAccounts,
  type PersonRecord,
  type IdentityAccount,
} from "@/lib/identity-checks";

const NOW = new Date("2026-09-07T12:00:00Z");
const GRACE = 7;

function person(p: Partial<PersonRecord>): PersonRecord {
  return { name: "X", email: null, status: "active", ended_at: null, ...p };
}
function acct(email: string, active = true): IdentityAccount {
  return { email, active };
}
/** Entra-shaped: one account reachable at both `mail` and the sign-on UPN. */
function dual(mail: string, upn: string, active = true): IdentityAccount {
  return { email: mail, active, aliases: [upn] };
}

let failures = 0;
function expect(label: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  -> ${got}${ok ? "" : ` (wanted ${want})`}`);
}

console.log("--- offboarding drift ---");

expect(
  "no roster (provider unreadable)",
  evaluateOffboardingDrift({ roster: null, truncated: false, people: [], graceDays: GRACE, now: NOW }).result,
  "inconclusive",
);

expect(
  "nobody offboarded",
  evaluateOffboardingDrift({
    roster: [acct("a@x.com")], truncated: false,
    people: [person({ name: "A", email: "a@x.com" })], graceDays: GRACE, now: NOW,
  }).result,
  "inconclusive",
);

expect(
  "offboarded but inside grace",
  evaluateOffboardingDrift({
    roster: [acct("b@x.com")], truncated: false,
    people: [person({ name: "B", email: "b@x.com", status: "offboarded", ended_at: "2026-09-05" })],
    graceDays: GRACE, now: NOW,
  }).result,
  "inconclusive",
);

expect(
  "offboarded, no leaving date",
  evaluateOffboardingDrift({
    roster: [acct("b@x.com")], truncated: false,
    people: [person({ name: "B", email: "b@x.com", status: "offboarded" })],
    graceDays: GRACE, now: NOW,
  }).result,
  "inconclusive",
);

expect(
  "past grace, no email recorded",
  evaluateOffboardingDrift({
    roster: [acct("b@x.com")], truncated: false,
    people: [person({ name: "B", status: "offboarded", ended_at: "2026-01-01" })],
    graceDays: GRACE, now: NOW,
  }).result,
  "inconclusive",
);

const drifted = evaluateOffboardingDrift({
  roster: [acct("gone@x.com", true)], truncated: false,
  people: [person({ name: "Gone Person", email: "gone@x.com", status: "offboarded", ended_at: "2026-08-01" })],
  graceDays: GRACE, now: NOW,
});
expect("past grace, account still open", drifted.result, "fail");
console.log(`      detail: ${drifted.detail}`);

expect(
  "past grace, account deprovisioned",
  evaluateOffboardingDrift({
    roster: [acct("gone@x.com", false)], truncated: false,
    people: [person({ name: "G", email: "gone@x.com", status: "offboarded", ended_at: "2026-08-01" })],
    graceDays: GRACE, now: NOW,
  }).result,
  "pass",
);

expect(
  "clean but truncated directory -> must NOT pass",
  evaluateOffboardingDrift({
    roster: [acct("gone@x.com", false)], truncated: true,
    people: [person({ name: "G", email: "gone@x.com", status: "offboarded", ended_at: "2026-08-01" })],
    graceDays: GRACE, now: NOW,
  }).result,
  "inconclusive",
);

expect(
  "email case/whitespace mismatch still matches",
  evaluateOffboardingDrift({
    roster: [acct("  GONE@X.com ", true)], truncated: false,
    people: [person({ name: "G", email: "gone@x.com", status: "offboarded", ended_at: "2026-08-01" })],
    graceDays: GRACE, now: NOW,
  }).result,
  "fail",
);

expect(
  "account absent from directory entirely = access removed",
  evaluateOffboardingDrift({
    roster: [acct("someone.else@x.com")], truncated: false,
    people: [person({ name: "G", email: "gone@x.com", status: "offboarded", ended_at: "2026-08-01" })],
    graceDays: GRACE, now: NOW,
  }).result,
  "pass",
);

const mixed = evaluateOffboardingDrift({
  roster: [acct("a@x.com", false)], truncated: false,
  people: [
    person({ name: "A", email: "a@x.com", status: "offboarded", ended_at: "2026-08-01" }),
    person({ name: "NoEmail", status: "offboarded", ended_at: "2026-08-01" }),
  ],
  graceDays: GRACE, now: NOW,
});
expect("one leaver has no email — others still evaluated", mixed.result, "pass");
console.log(`      detail: ${mixed.detail}`);

console.log("\n--- untracked accounts ---");

expect(
  "no roster",
  evaluateUntrackedAccounts({ roster: null, truncated: false, people: [], dismissed: [] }).result,
  "inconclusive",
);

expect(
  "empty personnel -> must not fire 40 alerts on day one",
  evaluateUntrackedAccounts({
    roster: [acct("a@x.com"), acct("b@x.com")], truncated: false, people: [], dismissed: [],
  }).result,
  "inconclusive",
);

expect(
  "more than half unmatched -> roster is what's broken",
  evaluateUntrackedAccounts({
    roster: [acct("a@x.com"), acct("b@x.com"), acct("c@x.com")], truncated: false,
    people: [person({ name: "A", email: "a@x.com" })], dismissed: [],
  }).result,
  "inconclusive",
);

const orphan = evaluateUntrackedAccounts({
  roster: [acct("a@x.com"), acct("b@x.com"), acct("svc-deploy@x.com")], truncated: false,
  people: [person({ name: "A", email: "a@x.com" }), person({ name: "B", email: "b@x.com" })],
  dismissed: [],
});
expect("one orphan out of three", orphan.result, "fail");
console.log(`      detail: ${orphan.detail}`);
console.log(`      subjects: ${JSON.stringify(orphan.subjects)}`);

expect(
  "same orphan, dismissed",
  evaluateUntrackedAccounts({
    roster: [acct("a@x.com"), acct("b@x.com"), acct("svc-deploy@x.com")], truncated: false,
    people: [person({ name: "A", email: "a@x.com" }), person({ name: "B", email: "b@x.com" })],
    dismissed: ["SVC-Deploy@X.com"],
  }).result,
  "pass",
);

expect(
  "offboarded person's lingering account is drift's finding, not untracked",
  evaluateUntrackedAccounts({
    roster: [acct("a@x.com"), acct("gone@x.com")], truncated: false,
    people: [
      person({ name: "A", email: "a@x.com" }),
      person({ name: "G", email: "gone@x.com", status: "offboarded", ended_at: "2026-08-01" }),
    ],
    dismissed: [],
  }).result,
  "pass",
);

expect(
  "suspended orphan is not a finding",
  evaluateUntrackedAccounts({
    roster: [acct("a@x.com"), acct("old@x.com", false)], truncated: false,
    people: [person({ name: "A", email: "a@x.com" })], dismissed: [],
  }).result,
  "pass",
);

expect(
  "Entra account known by its UPN only — must NOT be reported as an orphan",
  evaluateUntrackedAccounts({
    roster: [acct("a@x.com"), dual("b@x.com", "b@x.onmicrosoft.com")], truncated: false,
    people: [
      person({ name: "A", email: "a@x.com" }),
      person({ name: "B", email: "b@x.onmicrosoft.com" }),
    ],
    dismissed: [],
  }).result,
  "pass",
);

expect(
  "clean but truncated -> must NOT pass",
  evaluateUntrackedAccounts({
    roster: [acct("a@x.com")], truncated: true,
    people: [person({ name: "A", email: "a@x.com" })], dismissed: [],
  }).result,
  "inconclusive",
);

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
