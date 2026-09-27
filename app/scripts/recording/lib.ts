/**
 * Shared plumbing for recording product clips with Playwright + the Edge that
 * ships with Windows. See docs/VIDEO_PLAN.md for what each clip shows.
 *
 * Nothing here is used by the app itself.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";

export const BASE_URL = process.env.RECORDING_BASE_URL ?? "http://localhost:3001";

/** 720p: small enough to autoplay on a homepage, and the app's UI reads large
 *  at this width, which is what makes it legible when shrunk onto a phone. */
export const SIZE = { width: 1280, height: 720 };

export const OUT_DIR = path.resolve(process.cwd(), "..", "recordings");

export async function launch(): Promise<Browser> {
  return chromium.launch({ channel: "msedge", headless: true });
}

/**
 * Sign in as the recording account without a password: ask the Supabase admin
 * API for a one-time magic-link token (which sends no email) and spend it
 * straight away on the app's own /api/auth/confirm route. The token is never
 * printed. Returns the resulting cookies so each clip starts already signed in,
 * with no login screen in the footage.
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

export async function recordingContext(
  browser: Browser,
  storageState: Awaited<ReturnType<typeof signIn>>,
  dir: string,
): Promise<BrowserContext> {
  return browser.newContext({
    storageState,
    viewport: SIZE,
    recordVideo: { dir, size: SIZE },
    reducedMotion: "no-preference",
  });
}

/* ---------- on-screen overlays, injected into the page so they're filmed ---------- */

const OVERLAY_CSS = `
  #rec-caption { position: fixed; left: 50%; bottom: 42px; transform: translateX(-50%);
    z-index: 2147483647; pointer-events: none; max-width: 80%;
    background: rgba(8, 14, 28, 0.88); color: #fff; border-radius: 12px;
    padding: 14px 26px; font: 700 26px/1.25 system-ui, -apple-system, "Segoe UI", sans-serif;
    letter-spacing: -0.01em; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,.35);
    transition: opacity .35s ease; }
  #rec-caption[data-hidden="1"] { opacity: 0; }
  #rec-cursor { position: fixed; z-index: 2147483647; pointer-events: none;
    width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
    background: rgba(52, 211, 153, .35); border: 2px solid #10b981;
    box-shadow: 0 0 0 4px rgba(16,185,129,.15);
    transition: left .55s cubic-bezier(.4,0,.2,1), top .55s cubic-bezier(.4,0,.2,1), transform .15s; }
  #rec-cursor[data-down="1"] { transform: scale(.7); }
`;

async function ensureOverlays(page: Page) {
  await page.evaluate((css) => {
    if (!document.getElementById("rec-style")) {
      const s = document.createElement("style");
      s.id = "rec-style";
      s.textContent = css;
      document.head.appendChild(s);
    }
    if (!document.getElementById("rec-caption")) {
      const c = document.createElement("div");
      c.id = "rec-caption";
      c.dataset.hidden = "1";
      document.body.appendChild(c);
    }
    if (!document.getElementById("rec-cursor")) {
      const k = document.createElement("div");
      k.id = "rec-cursor";
      k.style.left = `${window.innerWidth * 0.6}px`;
      k.style.top = `${window.innerHeight * 0.55}px`;
      document.body.appendChild(k);
    }
  }, OVERLAY_CSS);
}

/** Show a caption (or hide it with null). Survives nothing — re-call after navigation. */
export async function caption(page: Page, text: string | null) {
  await ensureOverlays(page);
  await page.evaluate((t) => {
    const c = document.getElementById("rec-caption")!;
    if (t === null) {
      c.dataset.hidden = "1";
    } else {
      c.textContent = t;
      c.dataset.hidden = "0";
    }
  }, text);
}

/**
 * Headless recordings have no mouse pointer, so a click just "happens". Glide a
 * visible dot to the target first, press it, then click — the viewer sees where
 * the action is.
 */
export async function visibleClick(page: Page, target: Locator) {
  await ensureOverlays(page);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Target not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(([cx, cy]) => {
    const k = document.getElementById("rec-cursor")!;
    k.style.left = `${cx}px`;
    k.style.top = `${cy}px`;
  }, [x, y]);
  await page.waitForTimeout(650);
  await page.evaluate(() => { document.getElementById("rec-cursor")!.dataset.down = "1"; });
  await page.waitForTimeout(120);
  await target.click();
  await page.evaluate(() => { const k = document.getElementById("rec-cursor"); if (k) k.dataset.down = "0"; });
}

/** Glide the dot somewhere without clicking — to point at a result. */
export async function pointAt(page: Page, target: Locator) {
  await ensureOverlays(page);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) return;
  await page.evaluate(([cx, cy]) => {
    const k = document.getElementById("rec-cursor")!;
    k.style.left = `${cx}px`;
    k.style.top = `${cy}px`;
  }, [box.x + Math.min(box.width / 2, 60), box.y + box.height / 2]);
  await page.waitForTimeout(650);
}

/* ---------- export ---------- */

/**
 * Close the context (which flushes Playwright's WebM), then trim the page-load
 * lead-in off the front and re-encode to H.264 MP4 with ffmpeg: small, and
 * plays everywhere.
 */
export async function finish(ctx: BrowserContext, tmpDir: string, name: string, trimStartSec: number) {
  await ctx.close();
  const webm = readdirSync(tmpDir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error(`No video written for ${name}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${name}.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", trimStartSec.toFixed(2),
    "-i", path.join(tmpDir, webm),
    "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-an",
    out,
  ]);
  rmSync(tmpDir, { recursive: true, force: true });
  return out;
}

export function tmpDirFor(name: string) {
  const dir = path.join(OUT_DIR, ".tmp", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

export { renameSync };
