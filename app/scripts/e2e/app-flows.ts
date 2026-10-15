/**
 * Core flows outside the integration pages, against a running build, as the
 * test account. Anything it creates it deletes again.
 *
 *   npx tsx scripts/e2e/app-flows.ts [screenshotDir]
 */
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { Page, Request as PwRequest } from "playwright-core";
import { BASE_URL, launch, signIn } from "../recording/lib";

const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const results: { step: string; ok: boolean; detail: string }[] = [];

(async () => {
  const browser = await launch();
  const state = await signIn(browser);
  const ctx = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  let page: Page = await ctx.newPage();
  const errors: string[] = [];
  const watch = (p: Page) => p.on("pageerror", (e) => errors.push(e.message));
  watch(page);

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
  const go = (route: string) => page.goto(new URL(route, BASE_URL).toString(), { waitUntil: "networkidle" });
  const toast = async (re: RegExp, timeout = 20_000) => {
    const loc = page.getByRole("status").filter({ hasText: re }).first();
    await loc.waitFor({ timeout });
    return (await loc.innerText()).replace(/\s+/g, " ").trim();
  };

  await step("Access review: pull the GitHub roster (from the last scan)", async () => {
    await go("/access-reviews");
    await page.getByRole("button", { name: /New review/ }).click();
    await page.getByLabel("GitHub (organisation members)").check();
    await page.getByRole("button", { name: "Pull roster" }).click();
    await page.getByText(/[1-9]\d* accounts/).first().waitFor({ timeout: 20_000 });
    return (await page.getByText(/\d+ accounts/).first().innerText()).trim();
  });

  await step("Personnel: add a person, then delete them", async () => {
    await go("/personnel");
    await page.getByRole("button", { name: "Add person" }).click();
    await page.getByPlaceholder("Alex Doe").fill("E2E Test Person");
    await page.getByPlaceholder("alex@company.com").fill("e2e.test.person@northwind.test");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("E2E Test Person").first().waitFor();
    // The row's own Delete button: the nearest ancestor of the name that holds one.
    await page.getByText("E2E Test Person", { exact: true }).locator("xpath=ancestor::*[.//button[@title='Delete']][1]").getByTitle("Delete").click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await toast(/Deleted/);
    await page.getByText("E2E Test Person").first().waitFor({ state: "detached", timeout: 15_000 });
    return "added and removed";
  });

  await step("Dashboard: the add-framework picker offers frameworks", async () => {
    await go("/dashboard");
    const add = page.getByRole("button", { name: /Add framework/i }).first();
    if (!(await add.count())) return "all frameworks already added";
    await add.click();
    const options = await page.locator("select option").count();
    if (!options) throw new Error("no framework options");
    return `${options} options`;
  });

  await step("Evidence: a file downloads", async () => {
    await go("/evidence");
    const btn = page.getByTitle("Download").first();
    if (!(await btn.count())) return "no evidence files to download";
    // The file opens in a new tab as an attachment (the tab closes itself): check the signed request instead.
    const signed: Promise<PwRequest> = ctx.waitForEvent("request", (r: PwRequest) => r.url().includes("/storage/v1/object/sign/"));
    await btn.click();
    const req = await signed;
    const res = await req.response();
    if (!res || res.status() >= 400) throw new Error(`storage answered ${res?.status() ?? "nothing"}`);
    return `signed download answered ${res.status()}`;
  });

  await step("Copilot answers a question", async () => {
    await go("/copilot");
    // The page's own chat (the header's co-pilot panel has the same box).
    const box = page.locator("main").getByPlaceholder("Ask a question…").first();
    if (!(await box.count())) return "AI not configured here";
    // The conversation is kept, so wait for one more mention of "access" than before.
    const count = () => page.evaluate(() => (document.querySelector("main")?.textContent?.match(/access/gi) ?? []).length);
    const before = await count();
    await box.fill("In one sentence: what does SOC 2 CC6.1 cover?");
    await page.locator("main").getByRole("button", { name: "Send" }).first().click();
    await page.waitForFunction((n) => (document.querySelector("main")?.textContent?.match(/access/gi) ?? []).length > n, before, { timeout: 60_000 });
    return "answer streamed";
  });

  await step("Mobile: the menu opens, and closes after navigating", async () => {
    const m = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page = await m.newPage();
    watch(page);
    await go("/dashboard");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "Close menu" }).waitFor();
    await page.getByRole("link", { name: "Personnel" }).last().click();
    await page.waitForURL(/\/personnel/);
    await page.getByRole("button", { name: "Close menu" }).waitFor({ state: "detached", timeout: 10_000 });
    if (shots) await page.screenshot({ path: path.join(shots, "mobile-personnel.png") });
    await m.close();
    return "drawer closed on route change";
  });

  await step("Public checks pages link to each other", async () => {
    const pub = await browser.newContext();
    page = await pub.newPage();
    watch(page);
    await go("/checks");
    await page.getByRole("link", { name: /GitHub/ }).click();
    await page.waitForURL(/\/checks\/github/);
    await page.getByText("What we never read or do").waitFor();
    await pub.close();
  });

  await step("Signed-out visitors are sent to log in", async () => {
    const anon = await browser.newContext();
    page = await anon.newPage();
    await go("/integrations/github");
    await page.waitForURL(/\/login/);
    await anon.close();
    return "redirected to /login";
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
