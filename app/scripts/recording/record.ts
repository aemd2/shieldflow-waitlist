/**
 * Record the tier-1 product clips from docs/VIDEO_PLAN.md.
 *
 *   npx tsx scripts/recording/record.ts            all clips
 *   npx tsx scripts/recording/record.ts 01 04      just those
 *
 * Needs the app running in production mode on RECORDING_BASE_URL (the
 * `shieldflow-prod` launch config), a seeded workspace (seed.ts) and a saved
 * scene (scene.ts save). Restores the scene before and after every take, so the
 * workspace is always left the way it was found.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser } from "playwright-core";
import { BASE_URL, OUT_DIR, Take, launch, pointAt, scrollTo, signIn, visibleClick } from "./lib";
import { CLIP_QUESTIONNAIRE, recordingCompanyId, restoreScene } from "./scene";

type State = Awaited<ReturnType<typeof signIn>>;
type Clip = { name: string; run: (b: Browser, s: State) => Promise<Take> };

/* ---------- 01 · do the work once ---------- */
const clip01: Clip = {
  name: "01-work-once",
  async run(browser, state) {
    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/measures`);
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/Search measures/i).fill("Encrypt data at rest");
    await page.waitForTimeout(600);
    const row = page
      .locator("div, li, article")
      .filter({ has: page.getByText("Encrypt data at rest", { exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Complete", exact: true }) })
      .last();
    const counter = page.getByText(/framework requirement links/).first();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await scrollTo(page, counter, 110);

    const before = (await counter.textContent()) ?? "";

    await t.action();
    t.cue("Do the work once.");
    await pointAt(page, row, 0.3);
    await t.hold(0.4);
    await visibleClick(page, row.getByRole("button", { name: "Complete", exact: true }));
    await t.hold(0.25);
    // Cut the save round-trip: the number that appears next is the real one.
    t.cutFrom();
    for (let i = 0; i < 80 && ((await counter.textContent()) ?? "") === before; i++) {
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(250);
    t.cutTo();
    t.cue("Every framework gets the credit.");
    await pointAt(page, counter, 0.55);
    await t.hold(2.6);
    return t;
  },
};

/* ---------- 02 · add a framework, and find it part-done ---------- */
const clip02: Clip = {
  name: "02-add-framework",
  async run(browser, state) {
    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState("networkidle");

    await t.action();
    t.cue("Already doing SOC 2 and ISO 27001?");
    await pointAt(page, page.getByText("ISO 27001", { exact: true }).first(), 0.3);
    await t.hold(1.0);
    await visibleClick(page, page.getByRole("button", { name: /Add framework/i }));
    await t.hold(0.5);
    await page.locator("select").filter({ has: page.locator("option", { hasText: "NIS2" }) }).first()
      .selectOption({ label: "NIS2" });
    await t.hold(0.8);
    t.cue("Add NIS2.");
    await visibleClick(page, page.getByRole("button", { name: "Add", exact: true }));
    await t.hold(0.2);
    // Cut the spinner: the next frame is the finished result.
    t.cutFrom();
    const toast = page.getByText(/NIS2 added/).first();
    await toast.waitFor({ timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    t.cutTo();
    // Raised: the confirmation toast sits bottom-right, where captions go.
    t.cue("It starts with your existing work already credited.", 110);
    await pointAt(page, toast, 0.3);
    await t.hold(2.0);
    await pointAt(page, page.getByText("NIS2", { exact: true }).first(), 0.3);
    await t.hold(2.4);
    return t;
  },
};

/* ---------- 03 · the checks, including the one that won't pass ---------- */
const clip03: Clip = {
  name: "03-checks",
  async run(browser, state) {
    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState("networkidle");
    const summary = page.getByText("Automated monitoring", { exact: true }).first();
    await scrollTo(page, summary, 150);

    await t.action();
    t.cue("It checks your stack every day.");
    await pointAt(page, page.getByText(/\d+ passing/).first(), 0.5);
    await t.hold(1.0);
    await pointAt(page, page.getByText(/\d+ failing/).first(), 0.5);
    await t.hold(1.0);
    await pointAt(page, page.getByText(/\d+ inconclusive/).first(), 0.5);
    t.cue("And says so when it can't tell.");
    await t.hold(1.6);
    const detail = page.getByText(/their account is still open/).first();
    await scrollTo(page, page.getByText(/Automated check failing/).first(), 160);
    t.cue("When something fails, it tells you exactly what.");
    await pointAt(page, detail, 0.62);
    await t.hold(3.0);
    return t;
  },
};

/* ---------- 04 · the leaver ---------- */
const clip04: Clip = {
  name: "04-leaver",
  async run(browser, state) {
    const { createAdminSupabase } = await import("@/lib/supabase/admin");
    const { data: cc63 } = await createAdminSupabase()
      .from("controls").select("id, frameworks!inner(name)").eq("code", "CC6.3").eq("frameworks.name", "SOC 2").single();

    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/controls/${cc63!.id}`);
    await page.waitForLoadState("networkidle");

    await t.action();
    t.cue("Priya left Northwind in August.");
    await pointAt(page, page.getByRole("heading", { name: /Access Removal/i }).first(), 0.3);
    await t.hold(1.4);
    const fail = page.getByText(/their account is still open/).first();
    await scrollTo(page, fail, 200);
    await pointAt(page, fail, 0.62);
    t.cue("Their account is still open.");
    await t.hold(3.2);
    return t;
  },
};

/* ---------- 05 · the alert email ---------- */
const clip05: Clip = {
  name: "05-alert",
  async run(browser, state) {
    // The real template from lib/notify.ts, in a plain mail-client frame. It
    // deliberately imitates no real mail product.
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;font:20px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:#eef1f5;color:#1f2937}
      .app{display:grid;grid-template-columns:430px 1fr;height:100vh}
      .list{background:#fff;border-right:1px solid #e3e7ee}
      .bar{padding:24px 26px;font-weight:700;font-size:24px;border-bottom:1px solid #e3e7ee;display:flex;justify-content:space-between;align-items:baseline}
      .bar span{color:#6b7280;font-weight:500;font-size:16px}
      .row{padding:20px 26px;border-bottom:1px solid #eef1f5;color:#6b7280;font-size:18px}
      .row b{display:block;color:#374151;font-weight:600;font-size:20px;margin-bottom:2px}
      .new{background:#ecfdf5;border-left:4px solid #10b981;opacity:0;transform:translateY(-12px);transition:all .5s}
      .new.in{opacity:1;transform:none}
      .new b{color:#111827}
      .read{padding:44px 52px;opacity:0;transition:opacity .45s}
      .read.in{opacity:1}
      .meta{color:#6b7280;font-size:17px;margin-bottom:32px;border-bottom:1px solid #dde2ea;padding-bottom:22px}
      .meta div:first-child{color:#111827;font-weight:700;font-size:30px;margin-bottom:8px}
      .mail{background:#fff;border-radius:14px;padding:40px;max-width:640px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    </style>
    <div class="app">
      <div class="list">
        <div class="bar">Inbox <span>sam@northwind.test</span></div>
        <div class="row new" id="new"><b>ShieldFlow</b>Automated monitoring update</div>
        <div class="row"><b>Julia Novak</b>Re: Munich questionnaire — any update?</div>
        <div class="row"><b>Daniel Weber</b>Q4 roadmap</div>
        <div class="row"><b>Tom Hughes</b>Onboarding call notes</div>
        <div class="row"><b>Ellen Byrne</b>September invoices</div>
      </div>
      <div class="read" id="read">
        <div class="meta"><div>Automated monitoring update</div>ShieldFlow &lt;noreply@shieldflow.cloud&gt; · to sam@northwind.test</div>
        <div class="mail"><div style="font-family:system-ui,-apple-system,sans-serif">
          <h2 style="margin:0 0 12px;font-size:26px">Automated monitoring update</h2>
          <p style="color:#444;margin:0 0 24px;font-size:21px">1 automated check changed — 1 now failing. Review your dashboard.</p>
          <a style="display:inline-block;background:#0b1f3a;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-size:19px">Open ShieldFlow</a>
        </div></div>
      </div>
    </div>`;
    const file = path.join(OUT_DIR, ".tmp", "email.html");
    writeFileSync(file, html);

    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`file:///${file.replace(/\\/g, "/")}`);

    await t.action();
    await t.hold(0.6);
    await page.evaluate(() => document.getElementById("new")!.classList.add("in"));
    t.cue("When a check changes, you get an email.");
    await t.hold(1.4);
    await visibleClick(page, page.locator("#new"));
    await page.evaluate(() => document.getElementById("read")!.classList.add("in"));
    await t.hold(1.0);
    await pointAt(page, page.getByText(/now failing/), 0.4);
    t.cue("No need to log in and look.");
    await t.hold(2.8);
    return t;
  },
};

/* ---------- 06 · answer a questionnaire ---------- */
const QUESTIONS = [
  "Do you enforce multi-factor authentication for all users?",
  "How quickly is access removed when an employee leaves?",
  "Is customer data encrypted at rest?",
  "Do you maintain a documented incident response plan?",
  "Is your information security policy approved by management?",
  "How often are user access rights reviewed?",
  "Do you hold a current SOC 2 Type II report?",
  "Do you run annual penetration tests with an independent firm?",
  "Do you assess the security of your own suppliers?",
];

const clip06: Clip = {
  name: "06-questionnaire",
  async run(browser, state) {
    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/questionnaires`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /New questionnaire/i }).click();
    await page.getByPlaceholder(/Acme Corp security review/i).fill(CLIP_QUESTIONNAIRE);
    await page.locator("textarea").first().fill(QUESTIONS.join("\n"));
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const draft = page.getByRole("button", { name: "Draft with AI" });
    await draft.waitFor({ timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await t.action();
    t.cue("Paste in the customer's questionnaire.");
    await pointAt(page, page.getByText(QUESTIONS[0]).first(), 0.3);
    await t.hold(1.4);
    await visibleClick(page, draft);
    await t.hold(0.2);
    t.cutFrom();
    // Wait until the AI's answers are actually in the fields.
    await page.getByText(/^Drafted \d+ answers?$/).waitFor({ timeout: 90_000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll("textarea")].some((a) => a.value.trim().length > 20),
      undefined,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(500);
    t.cutTo();
    t.cue("It drafts answers from your workspace.");
    await pointAt(page, page.locator("textarea").first(), 0.5);
    await t.hold(2.2);

    // Keep what the AI wrote: the questionnaire is deleted when the scene is
    // restored, and these answers must be checked before the clip is used.
    const answers = await page.locator("textarea").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
    const badges = await page.locator(".card .flex.items-start").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    writeFileSync(
      path.join(OUT_DIR, "06-answers.json"),
      JSON.stringify(QUESTIONS.map((q, i) => ({ q, a: answers[i] ?? "", row: badges[i] ?? "" })), null, 2),
    );

    const flaggedCount = page.getByText(/\d+ need review/).first();
    if (await flaggedCount.count()) {
      // The badge, not the "Needs review" <option> every row's status select has.
      const badge = page.locator("span", { hasText: /^Needs review$/ });
      const firstFlag = page.locator(".card").filter({ has: badge }).first();
      await scrollTo(page, firstFlag, 140);
      t.cue("And flags what it can't back up.");
      await pointAt(page, firstFlag.locator("span", { hasText: /^Needs review$/ }).first(), 0.5);
      await t.hold(3.0);
    }
    return t;
  },
};

/** Wait for the page to finish a server round-trip we triggered, off camera. */
async function offCamera(t: Take, work: () => Promise<unknown>) {
  t.cutFrom();
  await work();
  await t.page.waitForLoadState("networkidle");
  await t.page.waitForTimeout(250);
  t.cutTo();
}

/** Resolve once `read()` has stopped changing for `quietMs` — a streamed answer. */
async function untilStill(read: () => Promise<string>, quietMs = 1500, maxMs = 90_000) {
  const start = Date.now();
  let last = await read();
  let since = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 250));
    const now = await read();
    if (now !== last) { last = now; since = Date.now(); }
    else if (last.length > 0 && Date.now() - since >= quietMs) return last;
  }
  return last;
}

/* ---------- 07 · access review ---------- */
const CLIP_REVIEW = "Q3 2026 — Google Workspace access review";
/** In the order the page lists them (alphabetical), so the cursor works down. */
const REVIEW_ROWS = [
  { subject: "amara@northwind.test", access: "Admin — user management", decide: "Keep" },
  { subject: "daniel@northwind.test", access: "Super admin", decide: "Keep" },
  { subject: "priya@northwind.test", access: "User", decide: "Revoke" },
  { subject: "sam@northwind.test", access: "Super admin", decide: "Keep" },
] as const;

const clip07: Clip = {
  name: "07-access-review",
  async run(browser, state) {
    // The review is set up off camera, as if Sam had started it earlier.
    const { createAdminSupabase } = await import("@/lib/supabase/admin");
    const db = createAdminSupabase();
    const companyId = await recordingCompanyId(db);
    const { data: review } = await db.from("access_reviews")
      .insert({ company_id: companyId, name: CLIP_REVIEW, reviewer_email: "sam@northwind.test" })
      .select("id").single();
    const { data: sys } = await db.from("access_review_systems")
      .insert({ review_id: review!.id, company_id: companyId, name: "Google Workspace", provider: "google" })
      .select("id").single();
    await db.from("access_review_items").insert(REVIEW_ROWS.map((r) => ({
      review_id: review!.id, system_id: sys!.id, company_id: companyId, subject: r.subject, access: r.access,
    })));

    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/access-reviews`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: CLIP_REVIEW }).waitFor();
    // Lift the rows clear of where captions sit.
    await scrollTo(page, page.getByRole("heading", { name: CLIP_REVIEW }), 24);

    await t.action();
    t.cue("Review who still needs access.");
    for (const r of REVIEW_ROWS) {
      const row = page.locator("li").filter({ hasText: r.subject });
      const button = row.getByRole("button", { name: r.decide });
      const handle = await button.elementHandle();
      await visibleClick(page, button);
      // Decisions round-trip to the server before the row turns; cut the wait.
      await offCamera(t, () => page.waitForFunction(
        (el) => /bg-(success-muted|destructive)/.test(el!.className),
        handle,
        { timeout: 15_000 },
      ));
      await t.hold(0.25);
    }
    const complete = page.getByRole("button", { name: /Complete & file evidence/ });
    await visibleClick(page, complete);
    await offCamera(t, () => page.getByText("Review completed — evidence filed").waitFor({ timeout: 20_000 }));
    t.cue("Signed and filed as evidence.");
    await pointAt(page, page.getByText(/attestations were filed as evidence/), 0.4);
    await t.hold(3.0);
    return t;
  },
};

/* ---------- 08 · policy ---------- */
const clip08: Clip = {
  name: "08-policy",
  async run(browser, state) {
    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/policies`);
    await page.waitForLoadState("networkidle");

    await t.action();
    t.cue("Need a policy? Pick one.");
    await visibleClick(page, page.getByRole("button", { name: /New policy/ }));
    await t.hold(0.4);
    await page.locator("select").filter({ has: page.locator("option", { hasText: "Access Control Policy" }) }).first()
      .selectOption({ label: "Access Control Policy" });
    await t.hold(0.7);
    await visibleClick(page, page.getByRole("button", { name: /Generate with AI/ }));
    await offCamera(t, async () => {
      await page.getByText("Policy generated").waitFor({ timeout: 90_000 });
      await page.getByRole("button", { name: "Approve", exact: true }).waitFor({ timeout: 20_000 });
    });
    t.cue("A first draft in seconds.");
    const body = page.locator("main h1, main h2, main h3").filter({ hasText: /purpose|scope/i }).first();
    if (await body.count()) await pointAt(page, body, 0.3);
    await t.hold(2.2);

    // Keep the text: it has to be read before the clip is used.
    const text = await page.locator("main").innerText();
    writeFileSync(path.join(OUT_DIR, "08-policy.txt"), text);

    await visibleClick(page, page.getByRole("button", { name: "Approve", exact: true }));
    await offCamera(t, () => page.getByText("Policy approved").waitFor({ timeout: 20_000 }));
    t.cue("You read it, then approve it.");
    await pointAt(page, page.getByText(/Approved — publish it/), 0.4);
    await t.hold(2.8);
    return t;
  },
};

/* ---------- 09 · trust center ---------- */
const clip09: Clip = {
  name: "09-trust-center",
  async run(browser) {
    const { createAdminSupabase } = await import("@/lib/supabase/admin");
    const db = createAdminSupabase();
    const { data: co } = await db.from("companies").select("trust_slug").eq("id", await recordingCompanyId(db)).single();

    // What a prospect sees: signed out.
    const t = new Take(this.name);
    const page = await t.open(browser, { cookies: [], origins: [] });
    await page.goto(`${BASE_URL}/trust/${co!.trust_slug}`);
    await page.waitForLoadState("networkidle");

    await t.action();
    t.cue("Send prospects a live page, not a PDF.");
    await pointAt(page, page.getByText("Overall compliance readiness"), 0.4);
    await t.hold(1.6);
    await pointAt(page, page.getByText("Frameworks", { exact: true }), 0.3);
    await t.hold(1.0);
    await page.mouse.wheel(0, 380);
    await t.hold(1.0);
    t.cue("It updates itself as you work.");
    await pointAt(page, page.getByRole("button", { name: /Request access/ }).or(page.getByText("Request access")).first(), 0.5);
    await t.hold(2.6);
    return t;
  },
};

/* ---------- 10 · the 14-day sprint ---------- */
const clip10: Clip = {
  name: "10-sprint",
  async run(browser, state) {
    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/getting-started`);
    await page.waitForLoadState("networkidle");

    await t.action();
    t.cue("Four phases to Type I readiness.");
    await pointAt(page, page.getByText(/phases done/).first(), 0.3);
    await t.hold(1.4);
    await scrollTo(page, page.getByText("Work through your measures"), 200);
    await pointAt(page, page.getByText("Work through your measures"), 0.3);
    await t.hold(1.0);
    t.cue("Each one opens up on real progress.");
    await scrollTo(page, page.getByText("Document & sign off"), 260);
    await pointAt(page, page.getByText("Finish the mandatory measures"), 0.3);
    await t.hold(1.2);
    await pointAt(page, page.getByText("Document & sign off"), 0.3);
    await t.hold(2.0);
    return t;
  },
};

/* ---------- 11 · evidence ---------- */
const clip11: Clip = {
  name: "11-evidence",
  async run(browser, state) {
    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/evidence`);
    await page.waitForLoadState("networkidle");

    await t.action();
    t.cue("Every document, dated.");
    await pointAt(page, page.getByText(/ago$/).first(), 0.5);
    await t.hold(1.2);
    const mfa = page.getByText(/Password and MFA Standard/).first();
    await scrollTo(page, mfa, 160);
    t.cue("And linked to what it proves.");
    await pointAt(page, page.getByText(/linked to CC6\.1/).first(), 0.6);
    await t.hold(1.2);
    await pointAt(page, page.getByText(/linked to A\.8\.5/).first(), 0.6);
    await t.hold(2.2);
    return t;
  },
};

/* ---------- 12 · report ---------- */
const clip12: Clip = {
  name: "12-report",
  async run(browser, state) {
    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/reports`);
    await page.waitForLoadState("networkidle");

    await t.action();
    t.cue("One page for prospects and auditors.");
    await pointAt(page, page.getByText("Overall readiness"), 0.4);
    await t.hold(1.2);
    await scrollTo(page, page.getByText(/framework progress/i).first(), 120);
    await pointAt(page, page.getByText(/framework progress/i).first(), 0.3);
    await t.hold(1.4);
    await scrollTo(page, page.getByText("Audit report", { exact: true }), 40);
    t.cue("Saved as a PDF in one click.");
    await pointAt(page, page.getByRole("button", { name: /Print \/ Save as PDF/ }), 0.5);
    await t.hold(2.6);
    return t;
  },
};

/* ---------- 13 · co-pilot ---------- */
const clip13: Clip = {
  name: "13-copilot",
  async run(browser, state) {
    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/copilot`);
    await page.waitForLoadState("networkidle");
    const ask = page.getByRole("button", { name: "What should I prioritize this week?" });
    await ask.waitFor();

    await t.action();
    t.cue("Ask what to do next.");
    await pointAt(page, ask, 0.5);
    await t.hold(0.6);
    await visibleClick(page, ask);
    await t.hold(0.6);
    // The answer streams in; show it arriving briefly, cut the rest of the wait.
    // The assistant's bubble inside the chat panel (not any other flex row).
    const answer = page.locator("div.overflow-y-auto > div.flex.justify-start > div").last();
    const read = async () => {
      const s = (await answer.innerText().catch(() => "")).trim();
      return s === "Thinking…" ? "" : s;
    };
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll("div.overflow-y-auto > div.flex.justify-start > div")].pop();
      return !!b && (b.textContent ?? "").trim().length > 30;
    }, undefined, { timeout: 60_000 });
    await t.hold(1.2);
    let text = "";
    await offCamera(t, async () => { text = await untilStill(read); });
    writeFileSync(path.join(OUT_DIR, "13-copilot.txt"), text);
    t.cue("Answered from your own workspace.");
    await pointAt(page, answer, 0.5);
    await t.hold(3.4);
    return t;
  },
};

/* ---------- 14 · vendors & risks ---------- */
const clip14: Clip = {
  name: "14-vendors-risks",
  async run(browser, state) {
    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/vendors`);
    await page.waitForLoadState("networkidle");

    await t.action();
    t.cue("Every vendor, its risk and its last review.");
    await pointAt(page, page.getByText("SOC 2 on file").first(), 0.5);
    await t.hold(1.0);
    await pointAt(page, page.getByText(/reviewed 2026-03-10/).first(), 0.7);
    await t.hold(1.4);
    await visibleClick(page, page.getByRole("link", { name: "Risk Register" }));
    await offCamera(t, async () => {
      await page.waitForURL(/\/risks/);
      await page.getByText("Risk heat-map").waitFor();
    });
    t.cue("Every risk, and what you're doing about it.");
    await pointAt(page, page.getByText("Risk heat-map"), 0.3);
    await t.hold(1.2);
    const risk = page.getByText("A leaver keeps access to production");
    await scrollTo(page, risk, 200);
    await pointAt(page, page.getByText("Mitigating").first(), 0.5);
    await t.hold(2.4);
    return t;
  },
};

/* ---------- 15 · activity log ---------- */
const clip15: Clip = {
  name: "15-activity",
  async run(browser, state) {
    const t = new Take(this.name);
    const page = await t.open(browser, state);
    await page.goto(`${BASE_URL}/activity`);
    await page.waitForLoadState("networkidle");

    await t.action();
    t.cue("Every change: who, what and when.");
    const firstEntry = page.locator("main li").first();
    await pointAt(page, firstEntry, 0.4);
    await t.hold(1.4);
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 320);
    await t.hold(1.4);
    await page.mouse.wheel(0, -320);
    await t.hold(0.6);
    t.cue("Nobody on the team can edit it.");
    await pointAt(page, page.getByText(/access review completed/).first(), 0.4);
    await t.hold(2.6);
    return t;
  },
};

const ALL = [clip01, clip02, clip03, clip04, clip05, clip06, clip07, clip08, clip09, clip10, clip11, clip12, clip13, clip14, clip15];

async function main() {
  const wanted = process.argv.slice(2);
  const clips = wanted.length ? ALL.filter((c) => wanted.some((w) => c.name.startsWith(w))) : ALL;
  const browser = await launch();
  const state = await signIn(browser);
  try {
    for (const clip of clips) {
      await restoreScene();
      process.stdout.write(`${clip.name} … `);
      try {
        const take = await clip.run(browser, state);
        const out = await take.finish();
        console.log(`${out.seconds.toFixed(1)}s  ${out.cues.map((c) => `[${c.at.toFixed(1)}s] ${c.text}`).join("  ")}`);
      } catch (e) {
        // One broken clip shouldn't cost the rest of the batch.
        console.log(`FAILED: ${((e as Error).message ?? String(e)).split("\n")[0]}`);
        process.exitCode = 1;
      }
    }
  } finally {
    await restoreScene();
    await browser.close();
  }
}

main().catch((e) => { console.error("\n", e.message ?? e); process.exit(1); });
