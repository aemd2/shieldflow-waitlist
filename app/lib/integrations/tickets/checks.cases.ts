/**
 * Cases for the change → ticket check and the Slack texts.
 * Run with:  npx tsx lib/integrations/tickets/checks.cases.ts
 */
import { evaluateTracker } from "@/lib/integrations/tickets/scan";
import { redChecksText, slackSettings } from "@/lib/slack-alerts";

const NOW = new Date("2026-10-15T12:00:00Z");
let failures = 0;
function expect(label: string, got: unknown, want: unknown) {
  const pass = got === want;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  -> ${String(got)}${pass ? "" : ` (wanted ${String(want)})`}`);
}

const change = (n: number, over: Partial<{ ticket: string | null; ticket_checked_at: string | null; ticket_title: string | null; merged_at: string; provider: string }> = {}) => ({
  provider: "github", repo: "acme/api", number: n, title: `change ${n}`, ticket: "ENG-1", merged_at: "2026-10-10T00:00:00Z",
  ticket_checked_at: "2026-10-11T00:00:00Z", ticket_title: "Fix login", ...over,
});
const run = (rows: ReturnType<typeof change>[]) => evaluateTracker("jira", rows, [], NOW);

expect("no code changes → no check at all", run([]).length, 0);
expect("every change has a real ticket → pass", run([change(1), change(2)])[0].result, "pass");
expect("a change with no ticket ID fails", run([change(1), change(2, { ticket: null })])[0].result, "fail");
expect("a ticket ID that doesn't exist fails", run([change(1, { ticket_title: null })])[0].result, "fail");
expect("a ticket not looked up yet → must NOT pass", run([change(1, { ticket_checked_at: null, ticket_title: null })])[0].result, "inconclusive");
expect("changes older than 30 days don't count", run([change(1, { ticket: null, merged_at: "2026-08-01T00:00:00Z" })])[0].result, "pass");
expect("GitLab changes are named with !", run([change(7, { ticket: null, provider: "gitlab" })])[0].resources[0]?.label.startsWith("acme/api!7") ? "yes" : "no", "yes");

expect("Slack alerts on by default", slackSettings(null).alerts, true);
expect("…and can be switched off", slackSettings({ slack: { alerts: false } }).alerts, false);
expect("weekly digest on by default", slackSettings({ slack: { alerts: false } }).weekly, true);
const text = redChecksText("Acme", [{ checkKey: "github.branch_protection", detail: "acme/api accepts direct pushes" }]);
expect("the alert names the provider and the check", text.includes("GitHub") && text.includes("Default branches require a reviewed pull request") ? "yes" : "no", "yes");
expect("…and links to its page", text.includes("/integrations/github|") ? "yes" : "no", "yes");
const many = redChecksText("Acme", Array.from({ length: 10 }, (_, i) => ({ checkKey: `aws.check_${i}`, detail: "x" })));
expect("long lists are cut at 8", many.includes("…and 2 more") ? "yes" : "no", "yes");

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
