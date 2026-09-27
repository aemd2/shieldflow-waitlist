/**
 * Shared plumbing for recording product clips with Playwright + the Edge that
 * ships with Windows. See docs/VIDEO_PLAN.md for what each clip shows.
 *
 * Each clip is recorded once, with no captions baked in. Captions are drawn on
 * afterwards by ffmpeg, so every clip comes out twice from identical footage:
 *
 *   recordings/clean/      no text — for voice-over
 *   recordings/captioned/  captions — for silent autoplay and social
 *
 * Nothing here is used by the app itself.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";

export const BASE_URL = process.env.RECORDING_BASE_URL ?? "http://localhost:3001";

/** 720p: small enough to autoplay on a homepage, and the app's UI reads large
 *  at this width, which is what keeps it legible when shrunk onto a phone. */
export const SIZE = { width: 1280, height: 720 };

export const OUT_DIR = path.resolve(process.cwd(), "..", "recordings");

/** Who the footage shows as signed in: the persona, not the test account. */
const SHOWN_AS = "sam@northwind.test";

export async function launch(): Promise<Browser> {
  return chromium.launch({ channel: "msedge", headless: true });
}

/**
 * Sign in as the recording account without a password: ask the Supabase admin
 * API for a one-time magic-link token (which sends no email) and spend it
 * straight away on the app's own /api/auth/confirm route. The token is never
 * printed. Returns cookies so each clip starts already signed in.
 */
export async function signIn(browser: Browser) {
  const email = process.env.RECORDING_EMAIL;
  if (!email) throw new Error("Set RECORDING_EMAIL in .env.local");

  const { createAdminSupabase } = await import("@/lib/supabase/admin");
  const { data, error } = await createAdminSupabase().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) throw new Error("Could not mint a sign-in token");

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const url = new URL("/api/auth/confirm", BASE_URL);
  url.searchParams.set("token_hash", data.properties.hashed_token);
  url.searchParams.set("type", "magiclink");
  url.searchParams.set("next", "/dashboard");
  await page.goto(url.toString());
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/* ---------- overlays filmed with the page ---------- */

const CURSOR_CSS = `
  #rec-cursor { position: fixed; z-index: 2147483647; pointer-events: none;
    width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%;
    background: rgba(52, 211, 153, .30); border: 2.5px solid #10b981;
    box-shadow: 0 0 0 5px rgba(16,185,129,.14), 0 2px 10px rgba(0,0,0,.25);
    transition: left .6s cubic-bezier(.4,0,.2,1), top .6s cubic-bezier(.4,0,.2,1), transform .15s; }
  #rec-cursor[data-down="1"] { transform: scale(.65); }
  /* The Next.js route announcer and any dev overlays have no place on camera. */
  nextjs-portal { display: none !important; }
`;

/**
 * Runs in every page before the app does: swaps the test account's address for
 * the persona's wherever it's rendered (the header shows the signed-in email),
 * and keeps doing so as React re-renders. Also carries the cursor's styles.
 *
 * Built as a string on purpose. tsx compiles helper functions with a `__name`
 * wrapper for stack traces; Playwright ships a function to the browser via
 * toString(), where `__name` doesn't exist, so a function-based init script
 * throws silently and nothing — no email swap, no visible cursor — happens.
 */
function initScript(hideEmail: string, shownAs: string, css: string): string {
  return `(() => {
    const HIDE = ${JSON.stringify(hideEmail)};
    const SHOW = ${JSON.stringify(shownAs)};
    const CSS = ${JSON.stringify(css)};
    function scrub(node) {
      if (!node) return;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let t;
      while ((t = walker.nextNode())) {
        if (t.nodeValue && t.nodeValue.indexOf(HIDE) !== -1) t.nodeValue = t.nodeValue.split(HIDE).join(SHOW);
      }
    }
    function start() {
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.appendChild(style);
      scrub(document.body);
      new MutationObserver(function (muts) {
        for (const m of muts) {
          if (m.type === "characterData") scrub(m.target.parentNode || m.target);
          m.addedNodes.forEach(scrub);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  })();`;
}

async function ensureCursor(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById("rec-cursor")) return;
    const k = document.createElement("div");
    k.id = "rec-cursor";
    k.style.left = `${Math.round(window.innerWidth * 0.62)}px`;
    k.style.top = `${Math.round(window.innerHeight * 0.58)}px`;
    document.body.appendChild(k);
  });
}

async function moveCursor(page: Page, x: number, y: number) {
  await ensureCursor(page);
  await page.evaluate(([cx, cy]) => {
    const k = document.getElementById("rec-cursor")!;
    k.style.left = `${cx}px`;
    k.style.top = `${cy}px`;
  }, [x, y]);
  await page.waitForTimeout(700);
}

/** Headless recordings have no pointer; glide a visible dot to the target, press, click. */
export async function visibleClick(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Click target not visible");
  await moveCursor(page, box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => { document.getElementById("rec-cursor")!.dataset.down = "1"; });
  await page.waitForTimeout(130);
  await target.click();
  await page.evaluate(() => { const k = document.getElementById("rec-cursor"); if (k) k.dataset.down = "0"; });
}

/** Glide the dot to something without clicking — to point at a result. */
export async function pointAt(page: Page, target: Locator, xFraction = 0.5) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) return;
  await moveCursor(page, box.x + Math.min(box.width * xFraction, 140), box.y + box.height / 2);
}

/** Scroll the app's own scroll container (the shell scrolls <main>, not the body). */
export async function scrollTo(page: Page, target: Locator, offsetFromTop = 90) {
  await target.evaluate((el, off) => {
    let p: HTMLElement | null = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
    const scroller = p ?? document.scrollingElement!;
    const top = el.getBoundingClientRect().top - (p ? p.getBoundingClientRect().top : 0) + scroller.scrollTop - off;
    scroller.scrollTo({ top, behavior: "smooth" });
  }, offsetFromTop);
  await page.waitForTimeout(900);
}

/* ---------- a take: one recording, with its cues and cuts ---------- */

export class Take {
  readonly dir: string;
  ctx!: BrowserContext;
  page!: Page;
  private videoStart = 0;
  private sceneStart = 0;
  private cues: { at: number; text: string; lift: number }[] = [];
  private cuts: { from: number; to: number }[] = [];

  constructor(readonly name: string) {
    this.dir = path.join(OUT_DIR, ".tmp", name);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
  }

  async open(browser: Browser, state: Awaited<ReturnType<typeof signIn>>) {
    this.ctx = await browser.newContext({
      storageState: state,
      viewport: SIZE,
      recordVideo: { dir: this.dir, size: SIZE },
    });
    await this.ctx.addInitScript({ content: initScript(process.env.RECORDING_EMAIL!, SHOWN_AS, CURSOR_CSS) });
    this.page = await this.ctx.newPage();
    this.page.on("dialog", (d) => d.accept());
    this.videoStart = Date.now();
    return this.page;
  }

  /** Everything before this is set-up and gets trimmed off. */
  async action() {
    await ensureCursor(this.page);
    await this.page.waitForTimeout(400);
    this.sceneStart = Date.now();
  }

  private now() { return (Date.now() - this.sceneStart) / 1000; }

  /** A caption from this moment until the next one. `lift` raises it (px) when
   *  something that matters — a toast — is at the bottom of the screen. */
  cue(text: string, lift = 0) { this.cues.push({ at: this.now(), text, lift }); }

  /** Remove a stretch (a spinner, an AI call) from the finished clip. */
  cutFrom() { this.cuts.push({ from: this.now(), to: Number.NaN }); }
  cutTo() { const c = this.cuts[this.cuts.length - 1]; c.to = this.now(); }

  async hold(seconds: number) { await this.page.waitForTimeout(seconds * 1000); }

  async finish() {
    const endAt = this.now();
    await this.ctx.close();
    const webm = readdirSync(this.dir).find((f) => f.endsWith(".webm"));
    if (!webm) throw new Error(`No video written for ${this.name}`);

    const trim = (this.sceneStart - this.videoStart) / 1000;
    // Map a scene time onto the finished (cut) timeline.
    const shift = (t: number) =>
      t - this.cuts.filter((c) => c.to <= t).reduce((s, c) => s + (c.to - c.from), 0);
    const length = shift(endAt);

    const cutFilter = this.cuts.length
      ? `select='not(${this.cuts.map((c) => `between(t,${c.from.toFixed(2)},${c.to.toFixed(2)})`).join("+")})',setpts=N/(30*TB),`
      : "";
    const base = `fps=30,${cutFilter}format=yuv420p`;

    copyFileSync("C:/Windows/Fonts/segoeuib.ttf", path.join(this.dir, "font.ttf"));
    const captions = this.cues.map((c, i) => {
      writeFileSync(path.join(this.dir, `cap${i}.txt`), c.text, "utf8");
      const from = shift(c.at);
      const to = i + 1 < this.cues.length ? shift(this.cues[i + 1].at) : length;
      return (
        `drawtext=fontfile=font.ttf:textfile=cap${i}.txt:fontsize=34:fontcolor=white:` +
        `box=1:boxcolor=0x0A1120@0.86:boxborderw=22:` +
        `x=(w-text_w)/2:y=h-text_h-${58 + c.lift}:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'`
      );
    });

    const encode = (filters: string, out: string) =>
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-ss", trim.toFixed(2), "-i", webm,
        "-t", length.toFixed(2),
        "-vf", filters,
        "-c:v", "libx264", "-preset", "slow", "-crf", "23",
        "-movflags", "+faststart", "-an", out,
      ], { cwd: this.dir });

    for (const sub of ["clean", "captioned"]) mkdirSync(path.join(OUT_DIR, sub), { recursive: true });
    const clean = path.join(OUT_DIR, "clean", `${this.name}.mp4`);
    const captioned = path.join(OUT_DIR, "captioned", `${this.name}.mp4`);
    encode(base, clean);
    encode([base, ...captions].join(","), captioned);
    rmSync(this.dir, { recursive: true, force: true });
    return { clean, captioned, seconds: length, cues: this.cues.map((c) => ({ at: shift(c.at), text: c.text })) };
  }
}
