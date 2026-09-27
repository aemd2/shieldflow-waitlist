/**
 * Join the recorded clips into finished videos, and write the voice-over script
 * with the exact second each line starts at.
 *
 *   npx tsx scripts/recording/stitch.ts
 *
 * Two cuts:
 *   walkthrough  the pitch — tier 1 (clips 1–6), about a minute
 *   full-tour    every clip, 1–15
 *
 * Each clip gets a short freeze on its last frame, so a narrator has room to
 * finish the line before the picture moves on. Clips that haven't been recorded
 * yet are skipped. The narration lives here, next to the clip list, so the
 * script and the video can't drift apart.
 *
 * Writes recordings/<cut>-clean.mp4, <cut>-captioned.mp4 and VOICEOVER.md.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve(process.cwd(), "..", "recordings");
const TMP = path.join(OUT_DIR, ".tmp", "stitch");
const FADE = 0.4;
const NAVY = "0x0B1F3A";

type Segment = {
  /** A recorded clip's name, or a card drawn here. */
  clip?: string;
  card?: { lines: { text: string; size: number; color: string }[]; seconds: number };
  /** Seconds of freeze-frame after the clip, so the line can finish. */
  hold?: number;
  say: string;
};

const TITLE: Segment = {
  card: {
    seconds: 5.5,
    lines: [
      { text: "ShieldFlow", size: 84, color: "white" },
      { text: "Do the work once.", size: 40, color: "0x34D399" },
      { text: "Recorded in the real product · Northwind Analytics is a sample company", size: 22, color: "0x94A3B8" },
    ],
  },
  say: "This is ShieldFlow — the real product, with a made-up company called Northwind.",
};

const END: Segment = {
  card: {
    seconds: 4.8,
    lines: [
      { text: "Do the work once.", size: 64, color: "white" },
      { text: "shieldflow.cloud", size: 40, color: "0x34D399" },
    ],
  },
  say: "ShieldFlow. Do the work once. Find us at shieldflow dot cloud.",
};

/** Tier 1 — the pitch. */
const PITCH: Segment[] = [
  {
    clip: "01-work-once",
    hold: 3.0,
    say: "Do the work once — like encrypting data at rest — and every framework that needs it gets the credit.",
  },
  {
    clip: "02-add-framework",
    hold: 1.2,
    say: "Northwind already works toward SOC 2 and ISO 27001. When they add NIS2, it doesn't start at zero — the work they've done counts straight away.",
  },
  {
    clip: "03-checks",
    hold: 1.2,
    say: "Every day, ShieldFlow checks the tools you've connected. It shows what passes, what fails, and what it can't tell. When something fails, it says exactly what.",
  },
  {
    clip: "04-leaver",
    hold: 1.5,
    say: "Like this: Priya left Northwind in August, and the account is still open. ShieldFlow catches it.",
  },
  {
    clip: "05-alert",
    hold: 1.5,
    say: "And you don't have to go looking. When a check changes, you get an email.",
  },
  {
    clip: "06-questionnaire",
    hold: 1.5,
    say: "A customer sends a security questionnaire? Paste it in. ShieldFlow drafts the answers from your workspace, and flags the ones it can't back up.",
  },
];

/** Tiers 2 and 3 — the rest of the product. */
const MORE: Segment[] = [
  {
    clip: "07-access-review",
    hold: 1.2,
    say: "Access reviews: go down the list, keep or revoke. When you're done, ShieldFlow files the signed record as evidence.",
  },
  {
    clip: "08-policy",
    hold: 1.2,
    say: "Need a policy? Pick one, and you get a first draft in seconds. You read it, edit it, and approve it.",
  },
  {
    clip: "09-trust-center",
    hold: 1.2,
    say: "Your Trust Center is a live page you send to prospects. It updates itself as you work.",
  },
  {
    clip: "10-sprint",
    hold: 1.2,
    say: "New to all this? The 14-day sprint breaks it into four phases, and each one opens up as you make real progress.",
  },
  {
    clip: "11-evidence",
    hold: 1.5,
    say: "Evidence works the same way. Attach a document to the measure once, and it counts for every requirement it covers — in every framework.",
  },
  {
    clip: "12-report",
    hold: 1.2,
    say: "The report puts it all on one page for a prospect or an auditor — open problems included — and saves as a PDF.",
  },
  {
    clip: "13-copilot",
    hold: 1.5,
    say: "Not sure what to do next? Ask the Co-Pilot. It answers from your own workspace — starting with what's actually broken.",
  },
  {
    clip: "14-vendors-risks",
    hold: 1.2,
    say: "Vendors and risks live here too: each vendor with its risk and last review, each risk with what you're doing about it.",
  },
  {
    clip: "15-activity",
    hold: 1.5,
    say: "And every change is logged — who did what, and when. Nobody on the team can edit it.",
  },
];

const CUTS: { name: string; title: string; segments: Segment[] }[] = [
  { name: "walkthrough", title: "Walkthrough — the pitch (clips 1–6)", segments: [TITLE, ...PITCH, END] },
  { name: "full-tour", title: "Full tour — every feature (clips 1–15)", segments: [TITLE, ...PITCH, ...MORE, END] },
];

function run(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { cwd: TMP });
}

function duration(file: string): number {
  return Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim(),
  );
}

/** A plain title card: lines stacked around the middle, fading in. */
function drawCard(card: NonNullable<Segment["card"]>, name: string): string {
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

function stitch(file: string, parts: { file: string; hold: number }[]) {
  const lengths = parts.map((p) => duration(p.file) + p.hold);
  const inputs = parts.flatMap((p) => ["-i", p.file]);
  const prep = parts.map(
    (p, i) => `[${i}:v]tpad=stop_mode=clone:stop_duration=${p.hold},fps=30,settb=AVTB,format=yuv420p[v${i}]`,
  );
  const chain: string[] = [];
  let prev = "v0";
  let offset = 0;
  const starts = [0];
  for (let i = 1; i < parts.length; i++) {
    offset += lengths[i - 1] - FADE;
    starts.push(offset);
    const out = i === parts.length - 1 ? "out" : `x${i}`;
    chain.push(`[${prev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}[${out}]`);
    prev = out;
  }
  run([
    ...inputs,
    "-filter_complex", [...prep, ...chain].join(";"),
    "-map", "[out]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-movflags", "+faststart", file,
  ]);
  return { starts, total: offset + lengths[lengths.length - 1] };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}.${Math.floor((s % 1) * 10)}`;
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** Build one cut in both variants; return its section of the voice-over script. */
function buildCut(cut: (typeof CUTS)[number]): string[] {
  const used: Segment[] = [];
  const skipped: string[] = [];
  const clean: { file: string; hold: number }[] = [];
  const captioned: { file: string; hold: number }[] = [];
  cut.segments.forEach((s, i) => {
    if (s.card) {
      const f = drawCard(s.card, `${cut.name}-card${i}`);
      clean.push({ file: f, hold: 0 });
      captioned.push({ file: f, hold: 0 });
      used.push(s);
      return;
    }
    const c = path.join(OUT_DIR, "clean", `${s.clip}.mp4`);
    const k = path.join(OUT_DIR, "captioned", `${s.clip}.mp4`);
    if (!existsSync(c) || !existsSync(k)) { skipped.push(s.clip!); return; }
    clean.push({ file: c, hold: s.hold ?? 0 });
    captioned.push({ file: k, hold: s.hold ?? 0 });
    used.push(s);
  });

  const a = stitch(path.join(OUT_DIR, `${cut.name}-clean.mp4`), clean);
  stitch(path.join(OUT_DIR, `${cut.name}-captioned.mp4`), captioned);

  const rows = used.map((s, i) => {
    const end = i + 1 < a.starts.length ? a.starts[i + 1] : a.total;
    const secs = end - a.starts[i];
    const flag = words(s.say) / secs > 2.8 ? " ⚠ fast — trim a few words or speak quickly" : "";
    return `| ${mmss(a.starts[i])} | ${s.clip ?? "card"} | ${s.say} | ${secs.toFixed(1)}s, ${words(s.say)} words${flag} |`;
  });

  console.log(`${cut.name} ${mmss(a.total)} · ${used.length} segments${skipped.length ? ` · skipped ${skipped.join(", ")}` : ""}`);
  for (const r of rows.filter((r) => r.includes("⚠"))) console.log(r);

  return [
    `## ${cut.title}`,
    "",
    `Record over \`${cut.name}-clean.mp4\` (no captions). Length ${mmss(a.total)}.`,
    `\`${cut.name}-captioned.mp4\` is the same cut with captions, for silent autoplay.`,
    "",
    "| Starts | Clip | Say | Room |",
    "|---|---|---|---|",
    ...rows,
    "",
    ...(skipped.length ? [`Not in this cut (not recorded yet): ${skipped.join(", ")}.`, ""] : []),
  ];
}

function main() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  copyFileSync("C:/Windows/Fonts/segoeuib.ttf", path.join(TMP, "font.ttf"));

  const sections = CUTS.flatMap(buildCut);
  const md = [
    "# Voice-over script — ShieldFlow",
    "",
    "Read each line starting at its time. A relaxed pace is about 2.5 words a second;",
    "every line fits its slot at that pace. The last frame of each clip is held so you",
    "can finish the sentence — you don't need to rush the ends.",
    "",
    "The full tour starts with the same six lines as the walkthrough, so one recording",
    "session covers both.",
    "",
    ...sections,
    "## Recording tips",
    "",
    "- Record in a quiet, soft room (a wardrobe full of clothes works). Phone voice memo held 20 cm away is fine.",
    "- Record the whole script in one go, then line it up in any editor (CapCut, Clipchamp, iMovie, DaVinci Resolve).",
    "- If a line runs long, drag the next clip later — the freeze frames make that invisible.",
    "- Northwind Analytics and its people are invented. Say so if you're asked; the title card says it too.",
    "",
  ].join("\n");
  writeFileSync(path.join(OUT_DIR, "VOICEOVER.md"), md, "utf8");
  rmSync(TMP, { recursive: true, force: true });
}

main();
