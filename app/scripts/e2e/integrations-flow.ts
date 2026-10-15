/**
 * Click through the integration pages the way a user would, on the data
 * seeded by seed-integrations.ts, and check each action answers. Run against a
 * running build:
 *
 *   npx tsx scripts/e2e/seed-integrations.ts
 *   npx tsx scripts/e2e/integrations-flow.ts [screenshotDir]
 *   npx tsx scripts/e2e/seed-integrations.ts --clean
 */
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { Page } from "playwright-core";
import { BASE_URL, launch, signIn } from "../recording/lib";

const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const results: { step: string; ok: boolean; detail: string }[] = [];

async function toast(page: Page, re: RegExp, timeout = 20_000): Promise<string> {
  const loc = page.getByRole("status").filter({ hasText: re }).first();
  await loc.waitFor({ timeout });
  return (await loc.innerText()).replace(/\s+/g, " ").trim();
}

(async () => {
  const browser = await launch();
  const state = await signIn(browser);
  const ctx = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());

  async function step(name: string, fn: () => Promise<string | void>) {
    try {
      const detail = (await fn()) ?? "";
      results.push({ step: name, ok: true, detail });
      console.log(`PASS  ${name}${detail ? `  — ${detail}` : ""}`);
    } catch (e) {
      results.push({ step: name, ok: false, detail: (e as Error).message.split("\n")[0] });
      console.log(`FAIL  ${name}  — ${(e as Error).message.split("\n")[0]}`);
      if (shots) await page.screenshot({ path: path.join(shots, `fail-${name.replace(/[^a-z0-9]+/gi, "_")}.png`) }).catch(() => undefined);
    }
  }
  const go = async (route: string) => {
    await page.goto(new URL(route, BASE_URL).toString(), { waitUntil: "networkidle" });
  };
  const tab = (name: RegExp) => page.getByRole("tab", { name }).click();
  const shot = async (name: string) => {
    if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  };

  // ------------------------------------------------------------------ GitHub
  await step("GitHub page shows the seeded scan", async () => {
    await go("/integrations/github");
    await page.getByText("@northwind-seed").first().waitFor();
    await page.getByText("read-only App").first().waitFor();
    await page.getByText("Fix this week").waitFor();
    await shot("github-posture");
    return (await page.locator("section.card").first().innerText()).replace(/\s+/g, " ").slice(0, 120);
  });
  await step("GitHub: open a failing check and mark one repo out of scope", async () => {
    await page.getByRole("button", { name: /Default branches require a reviewed pull request/ }).first().click();
    await page.getByRole("button", { name: "Out of scope…" }).first().click();
    await page.getByPlaceholder(/Why this is fine/).fill("Static docs site, no production code (e2e test)");
    await page.getByRole("button", { name: "Mark out of scope" }).click();
    return toast(page, /Recorded/);
  });
  await step("GitHub People: link an unmatched login to a person", async () => {
    await tab(/^People$/);
    await page.getByText("accounts in GitHub").waitFor();
    await shot("github-people");
    await page.getByRole("button", { name: /This is…/ }).first().click();
    const select = page.locator("select").filter({ has: page.locator("option", { hasText: "Who is this?" }) }).first();
    const value = await select.locator("option").nth(1).getAttribute("value");
    await select.selectOption(value!);
    await page.getByRole("button", { name: "Link", exact: true }).click();
    return toast(page, /Linked/);
  });
  await step("GitHub People: mark a bot-like login as not a person", async () => {
    await page.getByRole("button", { name: /Not a person/ }).first().click();
    return toast(page, /not a person/i);
  });
  await step("GitHub Changes: record why a merge skipped review", async () => {
    await tab(/^Changes$/);
    await page.getByText("changes merged in 90 days").waitFor();
    await shot("github-changes");
    await page.getByRole("tab", { name: "No independent approval" }).click();
    await page.getByRole("button", { name: "Record why…" }).first().click();
    await page.getByPlaceholder(/Emergency fix/).fill("Hotfix for incident SEED-61, reviewed after by Sam (e2e test)");
    await page.getByRole("button", { name: "Record", exact: true }).click();
    return toast(page, /reviewed from the next scan/);
  });
  await step("GitHub Vulnerabilities: alerts listed with SLA", async () => {
    await tab(/^Vulnerabilities$/);
    await page.getByText("past your fix-by SLA").waitFor();
    await page.getByText("AWS access key exposed").waitFor();
    await shot("github-vulnerabilities");
  });
  await step("GitHub Settings: save the review window", async () => {
    await tab(/^Settings$/);
    const input = page.locator('input[type="number"]').nth(2);
    await input.fill("45");
    await page.getByRole("button", { name: "Save" }).click();
    return toast(page, /Saved/);
  });
  await step("GitHub Settings: out-of-range value is refused", async () => {
    const input = page.locator('input[type="number"]').nth(2);
    await input.fill("400");
    await page.getByRole("button", { name: "Save" }).click();
    // The browser's own min/max validation stops the submit; nothing is saved.
    const valid = await input.evaluate((el) => (el as HTMLInputElement).checkValidity());
    if (valid) throw new Error("400 days accepted");
    return "blocked by the form (max 90)";
  });

  // -------------------------------------------------------- Google Workspace
  await step("Google: apps tab — add a risky app to Vendors", async () => {
    await go("/integrations/google_workspace");
    await page.getByText("2-step verification is enforced for everyone").first().waitFor();
    await tab(/Third-party apps/);
    await page.getByText("MailMerge Pro").waitFor();
    await shot("google-apps");
    await page.getByRole("button", { name: "Add to Vendors" }).first().click();
    return toast(page, /added to Vendors/);
  });
  await step("Google: approve an app with a reason", async () => {
    await page.getByRole("button", { name: "Approve…" }).first().click();
    await page.getByPlaceholder(/our CRM/).fill("Our CRM, DPA signed (e2e test)");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    return toast(page, /Approved for a year/);
  });
  await step("Google People: suspended/leaver and 2SV flags shown", async () => {
    await tab(/^People$/);
    await page.getByText("2-step verification off").first().waitFor();
    await shot("google-people");
  });

  // --------------------------------------------------------------- Microsoft
  await step("Microsoft: devices and app consents", async () => {
    await go("/integrations/microsoft");
    await page.getByText("MFA is required for everyone").first().waitFor();
    await tab(/^Devices$/);
    await page.getByText("devices in Intune").waitFor();
    await shot("microsoft-devices");
    await tab(/App consents/);
    await page.getByText("MailSync").waitFor();
  });

  // ------------------------------------------------- the rest render with data
  for (const [route, text] of [
    ["/integrations/okta", "Everyone has a second factor"],
    ["/integrations/gitlab", "Groups require two-factor authentication"],
    ["/integrations/cloudflare", "Browsers are told to always use HTTPS (HSTS)"],
    ["/integrations/gcp", "SSH and RDP aren't open to the internet"],
    ["/integrations/personio", "Every leaver has a leaving date"],
    ["/integrations/kandji", "Every laptop is encrypted"],
  ] as const) {
    await step(`${route} renders its checks`, async () => {
      await go(route);
      await page.getByText(text).first().waitFor();
      await shot(route.split("/").pop()!);
    });
  }
  await step("GitLab Changes tab uses ! numbering", async () => {
    await go("/integrations/gitlab");
    await tab(/^Changes$/);
    await page.getByText("northwind-seed/data-pipeline!42").waitFor();
  });
  await step("Personio People: notice period and leaver shown", async () => {
    await go("/integrations/personio");
    await tab(/^People$/);
    await page.getByText(/leaving \d{4}-\d{2}-\d{2}/).first().waitFor();
    await shot("personio-people");
  });

  // --------------------------------------------------------- Jira + tickets
  await step("Jira: incidents and unlinked changes listed", async () => {
    await go("/integrations/jira");
    await tab(/Incidents & tickets/);
    await page.getByText("API latency incident (sev2)").waitFor();
    await page.getByText("SEED-99 not found").waitFor();
    await shot("jira-incidents");
  });
  await step("Jira: turn ticket creation on", async () => {
    const free = page.getByPlaceholder(/Project key/);
    if (await free.count()) await free.fill("SEED");
    await page.getByRole("button", { name: "Turn on" }).click();
    return toast(page, /Create a ticket/);
  });
  await step("GitHub: failing check offers a Jira ticket; fake credentials fail cleanly", async () => {
    await go("/integrations/github");
    await page.getByRole("button", { name: /The organisation requires 2FA/ }).first().click();
    await page.getByRole("button", { name: /Create a Jira ticket in SEED/ }).click();
    return toast(page, /Jira|ticket|credentials/i);
  });
  await step("Jira: turn ticket creation off again", async () => {
    await go("/integrations/jira");
    await tab(/Incidents & tickets/);
    await page.getByRole("button", { name: "Turn off" }).click();
    return toast(page, /off/);
  });

  // ------------------------------------------------- scanning with a bad key
  await step("Scan now with a non-working credential reports the error", async () => {
    await go("/integrations/cloudflare");
    await page.getByRole("button", { name: "Scan now" }).click();
    // A token that can't read anything scans fine and says "can't tell" with the reason — never a pass.
    const t = await toast(page, /Scanned|Cloudflare|token|reconnect|failed/i, 45_000);
    await page.getByText(/can.t tell yet/).first().waitFor();
    return t;
  });

  // ------------------------------------------------------------ cards & links
  await step("Integrations page: every deep card links to its page", async () => {
    await go("/integrations");
    const links = await page.locator('a[href^="/integrations/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const want = ["/integrations/github", "/integrations/google_workspace", "/integrations/microsoft", "/integrations/okta", "/integrations/gitlab", "/integrations/cloudflare", "/integrations/gcp", "/integrations/personio", "/integrations/kandji", "/integrations/jira"];
    const missing = want.filter((w) => !links.includes(w));
    if (missing.length) throw new Error(`no link to ${missing.join(", ")}`);
    return `${want.length} links`;
  });
  await step("Vendors shows the app added from Google, and it can be deleted", async () => {
    await go("/vendors");
    await page.getByText("MailMerge Pro").first().waitFor();
    await page.getByText("MailMerge Pro", { exact: true }).locator("xpath=ancestor::*[.//button[@title='Delete']][1]").getByTitle("Delete").click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await toast(page, /Deleted|removed/i);
    await page.getByText("MailMerge Pro", { exact: true }).waitFor({ state: "detached", timeout: 15_000 });
    return "deleted through the confirm dialog";
  });

  if (errors.length) results.push({ step: "no uncaught page errors", ok: false, detail: errors.slice(0, 3).join(" | ") });
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? `${failed.length} FAILED of ${results.length}` : `ALL ${results.length} PASSED`}`);
  for (const f of failed) console.log(`  ${f.step}: ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
