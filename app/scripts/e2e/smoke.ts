/**
 * Whole-app smoke test against a running build (npm run build && npm start):
 * signs in as the test account (RECORDING_EMAIL, passwordless — see
 * scripts/recording/lib.ts), visits every page and reports HTTP errors,
 * uncaught exceptions, console errors and error screens.
 *
 *   npx tsx scripts/e2e/smoke.ts [screenshotDir]
 */
import path from "node:path";
import { mkdirSync } from "node:fs";
import { BASE_URL, launch, signIn } from "../recording/lib";
import { PROVIDERS } from "@/lib/integrations/registry";

const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });

const APP = [
  "/dashboard",
  "/getting-started",
  "/measures",
  "/evidence",
  "/policies",
  "/risks",
  "/vendors",
  "/personnel",
  "/training",
  "/access-reviews",
  "/questionnaires",
  "/reports",
  "/tasks",
  "/activity",
  "/notifications",
  "/settings",
  "/billing",
  "/copilot",
  "/integrations",
  "/integrations/aws",
  "/integrations/aws#people",
  "/integrations/aws#changes",
  "/integrations/aws#backups",
  "/integrations/aws#facts",
  ...PROVIDERS.map((p) => `/integrations/${p.key}`),
];
const PUBLIC = ["/", "/checks", ...PROVIDERS.map((p) => `/checks/${p.key}`), "/aws-checks", "/demo", "/privacy", "/terms", "/login", "/signup", "/forgot-password"];
const ERROR_TEXT = /Something went wrong|Application error|Unhandled Runtime Error|This page could not be found|Internal Server Error/i;
// Third-party noise that isn't ours to fix (analytics blocked offline, etc.).
const IGNORE = /posthog|sentry|favicon|ERR_BLOCKED_BY_CLIENT|Download the React DevTools/i;

interface Finding {
  route: string;
  kind: string;
  detail: string;
}

(async () => {
  const browser = await launch();
  const findings: Finding[] = [];
  const state = await signIn(browser);

  async function visit(route: string, signedIn: boolean) {
    const ctx = await browser.newContext(signedIn ? { storageState: state } : {});
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`exception: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !IGNORE.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
    });
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (u.origin === new URL(BASE_URL).origin && r.status() >= 500) errors.push(`HTTP ${r.status()} ${u.pathname}`);
    });
    const started = Date.now();
    let status = 0;
    try {
      const res = await page.goto(new URL(route, BASE_URL).toString(), { waitUntil: "networkidle", timeout: 45_000 });
      status = res?.status() ?? 0;
    } catch (e) {
      findings.push({ route, kind: "load", detail: (e as Error).message.split("\n")[0] });
    }
    const ms = Date.now() - started;
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 20_000);
    if (status >= 400) findings.push({ route, kind: "status", detail: String(status) });
    if (ERROR_TEXT.test(body)) findings.push({ route, kind: "error screen", detail: body.match(ERROR_TEXT)![0] });
    if (signedIn && /\/login/.test(page.url())) findings.push({ route, kind: "auth", detail: "bounced to login" });
    for (const e of errors) findings.push({ route, kind: "runtime", detail: e });
    if (shots) await page.screenshot({ path: path.join(shots, `${route.replace(/[^a-z0-9]+/gi, "_") || "root"}${signedIn ? "" : "_public"}.png`), fullPage: true }).catch(() => undefined);
    console.log(`${String(status).padEnd(4)} ${String(ms).padStart(6)}ms  ${signedIn ? "app   " : "public"}  ${route}`);
    await ctx.close();
  }

  for (const r of APP) await visit(r, true);
  for (const r of PUBLIC) await visit(r, false);

  // A control detail page, reached the way a user would (controls are listed on the dashboard).
  {
    const ctx = await browser.newContext({ storageState: state });
    const page = await ctx.newPage();
    await page.goto(new URL("/dashboard", BASE_URL).toString(), { waitUntil: "networkidle" });
    const href = await page.locator('a[href^="/controls/"]').first().getAttribute("href").catch(() => null);
    await ctx.close();
    if (href) await visit(href, true);
    else findings.push({ route: "/controls/[id]", kind: "missing", detail: "no control link on /dashboard" });
  }

  await browser.close();
  console.log(`\n${findings.length ? `${findings.length} FINDINGS` : "NO FINDINGS"}`);
  for (const f of findings) console.log(`  ${f.route}  [${f.kind}]  ${f.detail}`);
  process.exit(findings.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
