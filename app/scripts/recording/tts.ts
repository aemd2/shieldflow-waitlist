/**
 * The narrator's voice: Groq's Orpheus text-to-speech, one sentence at a time.
 *
 * Every sentence is cached by (voice, text) under recordings/.tts-cache, so
 * re-stitching after a re-take costs nothing and an unchanged line always
 * sounds the same. Needs GROQ_API_KEY, and the Orpheus terms accepted once in
 * the Groq console by the account owner.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const CACHE = path.resolve(process.cwd(), "..", "recordings", ".tts-cache");
const MODEL = "canopylabs/orpheus-v1-english";
export const VOICE = process.env.RECORDING_VOICE ?? "troy";

export class TtsUnavailable extends Error {}

function key(): string {
  const k = (process.env.GROQ_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  if (!k) throw new TtsUnavailable("GROQ_API_KEY isn't set in .env.local");
  return k;
}

export function audioSeconds(file: string): number {
  return Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim(),
  );
}

/** A wav of `text` spoken by the narrator; returns its path. */
export async function speak(text: string, voice = VOICE): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const id = createHash("sha256").update(`${MODEL}|${voice}|${text}`).digest("hex").slice(0, 20);
  const file = path.join(CACHE, `${id}.wav`);
  if (existsSync(file)) return file;

  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, voice, input: text, response_format: "wav" }),
    });
    if (res.ok) {
      const raw = path.join(CACHE, `${id}.raw.wav`);
      writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
      // One format for everything downstream: 48 kHz mono, trimmed of edge silence.
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error", "-i", raw,
        "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse",
        "-ar", "48000", "-ac", "1", file,
      ]);
      return file;
    }
    const body = await res.text();
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 0) * 1000 || 4000 * (attempt + 1);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (/model_terms_required/.test(body)) {
      throw new TtsUnavailable(
        "Groq needs the Orpheus terms accepted once: https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english",
      );
    }
    throw new TtsUnavailable(`Groq text-to-speech failed (${res.status}): ${body.slice(0, 200)}`);
  }
  throw new TtsUnavailable("Groq kept rate-limiting the voice; try again in a minute.");
}
