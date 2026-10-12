/**
 * A sampler of every narrator voice, so a person can pick one by ear:
 *   npx tsx scripts/recording/voices.ts   → recordings/voice-samples.mp3
 * Then set RECORDING_VOICE=<name> in .env.local and re-run stitch.ts.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { execFileSync } from "node:child_process";
import path from "node:path";
import { speak } from "./tts";

const VOICES = ["autumn", "diana", "hannah", "austin", "daniel", "troy"];
const OUT = path.resolve(process.cwd(), "..", "recordings", "voice-samples.mp3");

(async () => {
  const files: string[] = [];
  for (const v of VOICES) {
    const name = v[0].toUpperCase() + v.slice(1);
    files.push(await speak(`This is ${name}. Every morning, ShieldFlow tells you what to fix this week: the exact resource, and the Terraform to fix it.`, v));
  }
  const inputs = files.flatMap((f) => ["-i", f]);
  const pads = files.map((_, i) => `[${i}:a]apad=pad_dur=0.8[p${i}]`);
  const concat = `${files.map((_, i) => `[p${i}]`).join("")}concat=n=${files.length}:v=0:a=1,loudnorm=I=-16:TP=-1.5[out]`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", [...pads, concat].join(";"), "-map", "[out]", "-b:a", "160k", OUT]);
  console.log(`wrote ${OUT}`);
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
