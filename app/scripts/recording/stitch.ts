/**
 * Join the recorded clips into finished videos, in two versions of each cut:
 *
 *   <cut>-voice.mp4      an AI narrator (Groq Orpheus) reads the script
 *   <cut>-subtitles.mp4  the same script as subtitles, no sound — for autoplay
 *
 *   npx tsx scripts/recording/stitch.ts
 *
 * Both are timed from the narrator's real speech: each clip's last frame is held
 * until its line has been said, so picture and words never drift apart. If the
 * voice isn't available (no Groq key, terms not accepted), the subtitles version
 * is still built from an estimated reading pace and the voice version is skipped.
 *
 * Cuts:
 *   walkthrough  the pitch — clips 1–6
 *   aws          ShieldFlow for AWS — clips 16–20
 *   full-tour    every clip, 1–20
 *   one-minute/  eight videos under a minute, one per selling point
 *
 *   npx tsx scripts/recording/stitch.ts one-minute   just those (or any cut name)
 *
 * Also writes <cut>.srt (closed captions for YouTube/LinkedIn uploads) and
 * VOICEOVER.md (the script with the second each line starts).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { audioSeconds, isCached, speak, TtsUnavailable, VOICE } from "./tts";

const OUT_DIR = path.resolve(process.cwd(), "..", "recordings");
const TMP = path.join(OUT_DIR, ".tmp", "stitch");
const FADE = 0.4;
const NAVY = "0x0B1F3A";
/** Speech starts this long into a segment (after the cross-fade), and ends this long before it. */
const LEAD = 0.55;
const TAIL = 0.6;
/** Pause between sentences. */
const GAP = 0.28;
/** Reading pace used when there's no voice to time against. */
const WORDS_PER_SECOND = 2.6;

type Card = { lines: { text: string; size: number; color: string }[]; seconds: number };
type Segment = {
  /** A recorded clip's name, or a card drawn here. */
  clip?: string;
  card?: Card;
  /** What's said — and shown as subtitles. */
  say: string;
  /** How the narrator should say it, when the spelling would trip it up (e.g. "ISO 27001"). */
  voice?: string;
};

const SAMPLE_NOTE = "Recorded in the real product · Northwind Analytics is a sample company";

const TITLE: Segment = {
  card: {
    seconds: 4.5,
    lines: [
      { text: "ShieldFlow", size: 84, color: "white" },
      { text: "Do the work once.", size: 40, color: "0x34D399" },
      { text: SAMPLE_NOTE, size: 22, color: "0x94A3B8" },
    ],
  },
  say: "This is ShieldFlow — the real product, with a made-up company called Northwind.",
};

const TITLE_AWS: Segment = {
  card: {
    seconds: 4.5,
    lines: [
      { text: "ShieldFlow for AWS", size: 72, color: "white" },
      { text: "Read-only. Every account. Every morning.", size: 38, color: "0x34D399" },
      { text: `${SAMPLE_NOTE} · AWS example accounts`, size: 22, color: "0x94A3B8" },
    ],
  },
  say: "This is ShieldFlow for AWS, shown on Northwind — a made-up company, using AWS's own example accounts.",
};

const END: Segment = {
  card: {
    seconds: 4.0,
    lines: [
      { text: "Do the work once.", size: 64, color: "white" },
      { text: "shieldflow.cloud", size: 40, color: "0x34D399" },
    ],
  },
  say: "ShieldFlow. Do the work once. Find us at shieldflow.cloud.",
  voice: "ShieldFlow. Do the work once. Find us at shieldflow dot cloud.",
};

/** Clips 1–6 — the pitch. */
const PITCH: Segment[] = [
  { clip: "01-work-once", say: "Do the work once — like encrypting data at rest — and every framework that needs it gets the credit." },
  {
    clip: "02-add-framework",
    say: "Northwind already works toward SOC 2 and ISO 27001. When they add NIS2, it doesn't start at zero — the work they've done counts straight away.",
    voice: "Northwind already works toward SOC two and ISO twenty-seven-oh-oh-one. When they add NIS two, it doesn't start at zero — the work they've done counts straight away.",
  },
  { clip: "03-checks", say: "Every day, ShieldFlow checks the tools you've connected. It shows what passes, what fails, and what it can't tell. When something fails, it says exactly what." },
  { clip: "04-leaver", say: "Like this: Priya left Northwind in August, and her account is still open. ShieldFlow catches it." },
  { clip: "05-alert", say: "And you don't have to go looking. When a check changes, you get an email." },
  { clip: "06-questionnaire", say: "A customer sends a security questionnaire? Paste it in. ShieldFlow drafts the answers from your workspace, and flags the ones it can't back up." },
];

/** Clips 7–15 — the rest of the product. */
const MORE: Segment[] = [
  { clip: "07-access-review", say: "Access reviews: go down the list, keep or revoke. When you're done, ShieldFlow files the signed record as evidence." },
  { clip: "08-policy", say: "Need a policy? Pick one, and you get a first draft in seconds. You read it, edit it, and approve it." },
  { clip: "09-trust-center", say: "Your Trust Center is a live page you send to prospects. It updates itself as you work." },
  {
    clip: "10-sprint",
    say: "New to all this? The 14-day sprint breaks it into four phases, and each one opens up as you make real progress.",
    voice: "New to all this? The fourteen-day sprint breaks it into four phases, and each one opens up as you make real progress.",
  },
  { clip: "11-evidence", say: "Evidence works the same way. Attach a document to the measure once, and it counts for every requirement it covers — in every framework." },
  { clip: "12-report", say: "The report puts it all on one page for a prospect or an auditor — open problems included — and saves as a PDF." },
  { clip: "13-copilot", say: "Not sure what to do next? Ask the Co-Pilot. It answers from your own workspace — starting with what's actually broken." },
  { clip: "14-vendors-risks", say: "Vendors and risks live here too: each vendor with its risk and last review, each risk with what you're doing about it." },
  { clip: "15-activity", say: "And every change is logged — who did what, and when. Nobody on the team can edit it." },
];

/** Clips 16–20 — AWS. */
const AWS: Segment[] = [
  {
    clip: "16-aws-connect",
    say: "Connecting AWS takes one read-only role. No keys change hands, and the role is blocked from reading your data — the full list is public.",
    voice: "Connecting A W S takes one read-only role. No keys change hands, and the role is blocked from reading your data — the full list is public.",
  },
  {
    clip: "17-aws-fix-this-week",
    say: "Every morning, ShieldFlow tells you what to fix this week: the exact resource, and the Terraform to fix it. It even shows what outdated databases are costing you.",
  },
  {
    clip: "18-aws-people",
    say: "It shows who can reach production, and how. Priya left in August — but she's still an AWS admin.",
    voice: "It shows who can reach production, and how. Priya left in August — but she's still an A W S admin.",
  },
  { clip: "19-aws-changes", say: "Changes made by hand in the console show up too. Record why, and that's your change-management evidence." },
  {
    clip: "20-aws-facts",
    say: "And it turns all of this into facts you can tell customers. Promised EU hosting? It found a backup copy in Virginia. What's true goes on your Trust Center.",
    voice: "And it turns all of this into facts you can tell customers. Promised E U hosting? It found a backup copy in Virginia. What's true goes on your Trust Center.",
  },
];

/* ---------- one-minute videos, one per selling point ---------- */

/** A selling point's opening card: what it is, the promise, and the sample-company note. */
function opener(headline: string, promise: string, say: string, voice?: string): Segment {
  return {
    card: {
      seconds: 3.2,
      lines: [
        { text: headline, size: 64, color: "white" },
        { text: promise, size: 34, color: "0x34D399" },
        { text: SAMPLE_NOTE, size: 20, color: "0x94A3B8" },
      ],
    },
    say,
    voice,
  };
}

const SHORT_END: Segment = {
  card: {
    seconds: 3.0,
    lines: [
      { text: "ShieldFlow", size: 64, color: "white" },
      { text: "shieldflow.cloud", size: 40, color: "0x34D399" },
    ],
  },
  say: "ShieldFlow — at shieldflow.cloud.",
  voice: "ShieldFlow — at shieldflow dot cloud.",
};

const SHORTS: { name: string; title: string; segments: Segment[] }[] = [
  {
    name: "1-do-the-work-once",
    title: "Do the work once — cross-framework credit",
    segments: [
      opener("Do the work once", "One piece of work, credit in every framework.", "Running SOC 2 and ISO 27001 side by side? You shouldn't do the work twice.", "Running SOC two and ISO twenty-seven-oh-oh-one side by side? You shouldn't do the work twice."),
      { clip: "01-work-once", say: "Complete a measure once — like encrypting data at rest — and every framework that needs it gets the credit." },
      { clip: "02-add-framework", say: "Add NIS2 later, and it doesn't start at zero: the work you've already done counts straight away.", voice: "Add NIS two later, and it doesn't start at zero: the work you've already done counts straight away." },
      { clip: "11-evidence", say: "Evidence works the same way. Attach a document once, and it covers every requirement it proves, in every framework." },
      SHORT_END,
    ],
  },
  {
    name: "2-checks-that-run-themselves",
    title: "Checks that run themselves",
    segments: [
      opener("Checks that run themselves", "Every day, in the tools you already use.", "Compliance should stay true after the audit — not just on audit day."),
      { clip: "03-checks", say: "Every day, ShieldFlow checks the tools you've connected: what passes, what fails, and what it honestly can't tell." },
      { clip: "04-leaver", say: "When something fails, it names it. Priya left Northwind in August — and her account is still open." },
      { clip: "05-alert", say: "And you don't have to go looking: when a check changes, you get an email." },
      SHORT_END,
    ],
  },
  {
    name: "3-win-the-security-review",
    title: "Win the security review",
    segments: [
      opener("Win the security review", "Questionnaires, Trust Center, report.", "A customer sends a security questionnaire, and the deal waits on you."),
      { clip: "06-questionnaire", say: "Paste it in. ShieldFlow drafts every answer from the work you've actually done — and flags the ones it can't back up." },
      { clip: "09-trust-center", say: "Send prospects your Trust Center: a live page that updates itself as you work." },
      { clip: "12-report", say: "And when an auditor asks, the report puts everything on one page — open problems included." },
      SHORT_END,
    ],
  },
  {
    name: "4-aws-fix-this-week",
    title: "AWS — what to fix this week",
    segments: [
      opener("Your AWS, every morning", "Read-only. Every account. No keys.", "Your AWS, checked every morning — without handing over a single key.", "Your A W S, checked every morning — without handing over a single key."),
      { clip: "16-aws-connect", say: "Connect with one read-only role. It's blocked from reading your data, and the full list of what it reads is public." },
      { clip: "17-aws-fix-this-week", say: "Then every morning you get a short list: the exact resource, the Terraform to fix it — and what outdated databases are costing you." },
      SHORT_END,
    ],
  },
  {
    name: "5-aws-access-and-changes",
    title: "AWS — who has access, and what changed",
    segments: [
      opener("Who can get in. What changed.", "The two lists every auditor samples.", "Auditors always ask two things about production: who can get in, and what changed."),
      { clip: "18-aws-people", say: "ShieldFlow shows who can reach production, and how. Priya left in August — she's still an AWS admin.", voice: "ShieldFlow shows who can reach production, and how. Priya left in August — she's still an A W S admin." },
      { clip: "19-aws-changes", say: "Changes made by hand in the console are listed too. Record why, and that's your change-management evidence." },
      SHORT_END,
    ],
  },
  {
    name: "6-ready-for-eu-customers",
    title: "Ready for EU customers — NIS2, DORA, data residency",
    segments: [
      opener("Ready for EU customers", "NIS2, DORA and GDPR — with proof.", "Selling to European customers? They'll ask about NIS2, DORA — and where your data lives.", "Selling to European customers? They'll ask about NIS two, DORA — and where your data lives."),
      { clip: "02-add-framework", say: "Add NIS2 to the frameworks you already run, and your existing work is credited on day one.", voice: "Add NIS two to the frameworks you already run, and your existing work is credited on day one." },
      { clip: "20-aws-facts", say: "ShieldFlow checks where every copy of your data lives. Promised EU hosting? It found a backup copy in Virginia — and the supplier data sheet is one click.", voice: "ShieldFlow checks where every copy of your data lives. Promised E U hosting? It found a backup copy in Virginia — and the supplier data sheet is one click." },
      SHORT_END,
    ],
  },
  {
    name: "7-your-first-audit-guided",
    title: "Your first audit, guided",
    segments: [
      opener("Your first audit, guided", "A plan, drafts and answers — built in.", "First time doing compliance? Nobody hands you a plan."),
      { clip: "10-sprint", say: "The 14-day sprint does: four phases, and each one opens up as you make real progress.", voice: "The fourteen-day sprint does: four phases, and each one opens up as you make real progress." },
      { clip: "08-policy", say: "Need a policy? Pick one and get a first draft in seconds. You read it, edit it, approve it." },
      { clip: "13-copilot", say: "Stuck? Ask the Co-Pilot. It answers from your own workspace — starting with what's actually broken." },
      SHORT_END,
    ],
  },
  {
    name: "8-audit-ready-by-default",
    title: "Audit-ready by default",
    segments: [
      opener("Audit-ready by default", "Every decision, on the record.", "Audits fail on missing records, not missing effort."),
      { clip: "07-access-review", say: "Access reviews: keep or revoke down the list, and the signed record is filed as evidence." },
      { clip: "14-vendors-risks", say: "Vendors and risks live alongside: each vendor's last review, each risk's plan." },
      { clip: "15-activity", say: "And every change is logged — who did what, and when. Nobody on the team can edit it." },
      SHORT_END,
    ],
  },
];

/** Longest a one-minute video may run. */
const SHORT_MAX = 60;

const CUTS: { name: string; title: string; segments: Segment[]; dir?: string; max?: number }[] = [
  { name: "walkthrough", title: "Walkthrough — the pitch (clips 1–6)", segments: [TITLE, ...PITCH, END], dir: "walkthrough" },
  { name: "aws", title: "ShieldFlow for AWS (clips 16–20)", segments: [TITLE_AWS, ...AWS, END], dir: "aws" },
  { name: "full-tour", title: "Full tour — every feature (clips 1–20)", segments: [TITLE, ...PITCH, ...MORE, ...AWS, END], dir: "full-tour" },
  ...SHORTS.map((s) => ({ ...s, title: `One minute: ${s.title}`, dir: "one-minute", max: SHORT_MAX })),
];

// ------------------------------------------------------------------ helpers

function run(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { cwd: TMP, maxBuffer: 64 * 1024 * 1024 });
}

const sentences = (t: string) => t.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** A subtitle should fit two lines: split a long sentence at a comma or dash near its middle. */
function chunks(sentence: string, max = 84): string[] {
  if (sentence.length <= max) return [sentence];
  const mid = sentence.length / 2;
  const cuts = [...sentence.matchAll(/(, | — |: )/g)].map((m) => m.index! + m[0].length);
  if (!cuts.length) return [sentence];
  const at = cuts.reduce((b, c) => (Math.abs(c - mid) < Math.abs(b - mid) ? c : b));
  return [...chunks(sentence.slice(0, at).trim(), max), ...chunks(sentence.slice(at).trim(), max)];
}

/** A plain title card: lines stacked around the middle, fading in. */
function drawCard(card: Card, name: string): string {
  const gap = 26;
  const total = card.lines.reduce((s, l) => s + l.size, 0) + gap * (card.lines.length - 1);
  let y = -total / 2;
  const draws = card.lines.map((l, i) => {
    writeFileSync(path.join(TMP, `${name}-${i}.txt`), l.text, "utf8");
    const d =
      `drawtext=fontfile=font.ttf:textfile=${name}-${i}.txt:fontsize=${l.size}:fontcolor=${l.color}:` +
      `x=(w-text_w)/2:y=h/2+(${Math.round(y)}):alpha='min(1,t/0.6)'`;
    y += l.size + gap;
    return d;
  });
  const out = `${name}.mp4`;
  run([
    "-f", "lavfi", "-i", `color=c=${NAVY}:s=1280x720:r=30:d=${card.seconds}`,
    "-vf", [...draws, "format=yuv420p"].join(","),
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", out,
  ]);
  return path.join(TMP, out);
}

function stitchVideo(file: string, parts: { file: string; hold: number }[]) {
  const inputs = parts.flatMap((p) => ["-i", p.file]);
  const prep = parts.map(
    (p, i) => `[${i}:v]tpad=stop_mode=clone:stop_duration=${p.hold.toFixed(3)},fps=30,settb=AVTB,format=yuv420p[v${i}]`,
  );
  const chain: string[] = [];
  let prev = "v0";
  let offset = 0;
  const lengths = parts.map((p) => audioSeconds(p.file) + p.hold);
  for (let i = 1; i < parts.length; i++) {
    offset += lengths[i - 1] - FADE;
    const out = i === parts.length - 1 ? "out" : `x${i}`;
    chain.push(`[${prev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}[${out}]`);
    prev = out;
  }
  run([
    ...inputs,
    "-filter_complex", [...prep, ...chain].join(";"),
    "-map", parts.length > 1 ? "[out]" : "[v0]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-movflags", "+faststart", file,
  ]);
}

const stamp = (s: number, sep: "." | ",") => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const cs = sep === "." ? sec.toFixed(2).padStart(5, "0") : sec.toFixed(3).padStart(6, "0").replace(".", ",");
  return sep === "." ? `${h}:${String(m).padStart(2, "0")}:${cs}` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${cs}`;
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

// -------------------------------------------------------------------- build

type Line = { text: string; start: number; end: number };
type Spoken = { wav: string; at: number };

let voiceProblem: string | null = null;

/** Speech for a segment: per sentence, the wav (or none) and its length. */
async function speech(s: Segment): Promise<{ sentence: string; wav: string | null; seconds: number }[]> {
  const shown = sentences(s.say);
  const spoken = sentences(s.voice ?? s.say);
  const same = shown.length === spoken.length;
  const out: { sentence: string; wav: string | null; seconds: number }[] = [];

  // Groq's free tier allows ~100 voice requests a day, so a line that isn't
  // already cached sentence by sentence is spoken in ONE request, and its
  // sentences are timed by their share of it (subtitles still change per sentence).
  if (!voiceProblem && !spoken.every((s) => isCached(s))) {
    try {
      const wav = await speak(s.voice ?? s.say);
      const seconds = audioSeconds(wav);
      const chars = shown.reduce((n, x) => n + x.length, 0);
      // The whole line plays from the first sentence's slot; the rest carry timing only.
      return shown.map((sentence, i) => ({
        sentence,
        wav: i === 0 ? wav : null,
        seconds: Math.max(0.3, (seconds * sentence.length) / chars - (i < shown.length - 1 ? GAP : 0)),
      }));
    } catch (e) {
      if (!(e instanceof TtsUnavailable)) throw e;
      voiceProblem = e.message;
    }
  }

  // One at a time: gentler on the voice API's rate limit, and cached after the first run.
  for (const [i, sentence] of shown.entries()) {
    const say = same ? spoken[i] : sentence;
    if (!voiceProblem) {
      try {
        const wav = await speak(say);
        out.push({ sentence, wav, seconds: audioSeconds(wav) });
        continue;
      } catch (e) {
        if (!(e instanceof TtsUnavailable)) throw e;
        voiceProblem = e.message;
      }
    }
    out.push({ sentence, wav: null, seconds: words(sentence) / WORDS_PER_SECOND });
  }
  return out;
}

async function buildCut(cut: (typeof CUTS)[number]): Promise<string[]> {
  const parts: { file: string; hold: number }[] = [];
  const lines: Line[] = [];
  const spoken: Spoken[] = [];
  const rows: string[] = [];
  const skipped: string[] = [];
  let start = 0;

  for (const [i, s] of cut.segments.entries()) {
    const file = s.card ? drawCard(s.card, `${cut.name}-card${i}`) : path.join(OUT_DIR, "clean", `${s.clip}.mp4`);
    if (!existsSync(file)) {
      skipped.push(s.clip!);
      continue;
    }
    const video = audioSeconds(file);
    const said = await speech(s);
    let t = LEAD;
    for (const x of said) {
      if (x.wav) spoken.push({ wav: x.wav, at: start + t });
      // Split long sentences across subtitles, timed by their share of the sentence.
      const pieces = chunks(x.sentence);
      const totalChars = pieces.reduce((n, p) => n + p.length, 0);
      let p0 = t;
      for (const p of pieces) {
        const d = (x.seconds * p.length) / totalChars;
        lines.push({ text: p, start: start + p0, end: start + p0 + d });
        p0 += d;
      }
      t += x.seconds + GAP;
    }
    const length = Math.max(video + 0.5, t - GAP + TAIL);
    parts.push({ file, hold: length - video });
    rows.push(`| ${mmss(start)} | ${s.clip ?? "card"} | ${s.say} |`);
    start += length - FADE;
  }
  const total = start + FADE;
  const outDir = cut.dir ? path.join(OUT_DIR, cut.dir) : OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const shown = cut.dir ? `${cut.dir}/${cut.name}` : cut.name;
  if (cut.max && total > cut.max) console.log(`  ⚠ ${cut.name} runs ${mmss(total)} — over ${cut.max}s; trim a line`);

  // Subtitles stay up through short pauses, so they don't flicker between sentences.
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    lines[i].end = next && next.start - lines[i].end < 0.6 ? next.start - 0.04 : lines[i].end + 0.35;
  }

  const clean = path.join(TMP, `${cut.name}-clean.mp4`);
  stitchVideo(clean, parts);

  // Subtitles: libass, Segoe UI on a dark box, two lines at most.
  copyFileSync("C:/Windows/Fonts/segoeuib.ttf", path.join(TMP, "segoeuib.ttf"));
  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1280",
    "PlayResY: 720",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Segoe UI,33,&H00FFFFFF,&H000000FF,&H24201110,&H00000000,-1,0,0,0,100,100,0,0,3,13,0,2,150,150,44,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...lines.map((l) => `Dialogue: 0,${stamp(l.start, ".")},${stamp(l.end, ".")},Default,,0,0,0,,${l.text.replace(/\n/g, " ")}`),
  ].join("\n");
  writeFileSync(path.join(TMP, `${cut.name}.ass`), ass, "utf8");
  const subtitled = path.join(outDir, `${cut.name}-subtitles.mp4`);
  run([
    "-i", clean,
    "-vf", `subtitles=${cut.name}.ass:fontsdir=.`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-movflags", "+faststart", "-an", subtitled,
  ]);

  writeFileSync(
    path.join(outDir, `${cut.name}.srt`),
    lines.map((l, i) => `${i + 1}\n${stamp(l.start, ",")} --> ${stamp(l.end, ",")}\n${l.text}\n`).join("\n"),
    "utf8",
  );

  // Voice: every sentence placed at its moment, mixed, levelled for speech.
  const voiced = path.join(outDir, `${cut.name}-voice.mp4`);
  if (!voiceProblem && spoken.length) {
    const inputs = spoken.flatMap((s) => ["-i", s.wav]);
    const delays = spoken.map((s, k) => `[${k + 1}:a]adelay=${Math.round(s.at * 1000)}:all=1[a${k}]`);
    const mix =
      `${spoken.map((_, k) => `[a${k}]`).join("")}amix=inputs=${spoken.length}:normalize=0:dropout_transition=0,` +
      `apad,atrim=0:${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
    run([
      "-i", clean, ...inputs,
      "-filter_complex", [...delays, mix].join(";"),
      "-map", "0:v", "-map", "[aout]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", voiced,
    ]);
  } else if (existsSync(voiced)) {
    rmSync(voiced); // never leave a voice version that no longer matches the cut
  }

  console.log(`${cut.name} ${mmss(total)} · ${parts.length} segments${skipped.length ? ` · skipped ${skipped.join(", ")}` : ""}`);
  return [
    `## ${cut.title}`,
    "",
    `Length ${mmss(total)}. \`${shown}-voice.mp4\` has the AI narrator; \`${shown}-subtitles.mp4\` shows the same words as subtitles with no sound; \`${shown}.srt\` is the caption file for uploads.`,
    "",
    "| Starts | Clip | Narration |",
    "|---|---|---|",
    ...rows,
    "",
    ...(skipped.length ? [`Not in this cut (not recorded yet): ${skipped.join(", ")}.`, ""] : []),
  ];
}

async function main() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  copyFileSync("C:/Windows/Fonts/segoeuib.ttf", path.join(TMP, "font.ttf"));

  // The older versions (made for a human narrator) are replaced by these two.
  for (const f of readdirSync(OUT_DIR)) if (/-(clean|captioned)\.mp4$/.test(f)) rmSync(path.join(OUT_DIR, f));

  // `stitch.ts one-minute` (or any cut name) builds just those.
  const only = process.argv.slice(2);
  const chosen = only.length ? CUTS.filter((c) => only.some((o) => c.name.includes(o) || c.dir === o)) : CUTS;
  const sections: string[] = [];
  for (const cut of chosen) sections.push(...(await buildCut(cut)));
  if (only.length) {
    rmSync(TMP, { recursive: true, force: true });
    if (voiceProblem) console.log(`\nVoice versions skipped — ${voiceProblem}`);
    return; // VOICEOVER.md covers every cut; a full run rewrites it
  }

  const md = [
    "# Narration script — ShieldFlow videos",
    "",
    `Every cut comes in two versions: **voice** (an AI narrator, Groq Orpheus, voice "${VOICE}") and **subtitles** (the same words on screen, no sound — for feeds that autoplay muted). Both are timed from the narrator's real speech.`,
    "",
    voiceProblem ? `> **The voice versions weren't made this time:** ${voiceProblem}. Then run \`npx tsx scripts/recording/stitch.ts\` again.` : "",
    "",
    ...sections,
    "## Notes",
    "",
    "- To change a line, edit it in `app/scripts/recording/stitch.ts` and re-run it; unchanged lines are reused from the voice cache.",
    "- Northwind Analytics, its people and its AWS accounts are invented (the AWS account numbers are AWS's own documentation examples). The title cards say so.",
    "",
  ].join("\n");
  writeFileSync(path.join(OUT_DIR, "VOICEOVER.md"), md, "utf8");
  rmSync(TMP, { recursive: true, force: true });
  if (voiceProblem) console.log(`\nVoice versions skipped — ${voiceProblem}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
