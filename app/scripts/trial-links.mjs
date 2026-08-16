#!/usr/bin/env node
/**
 * Tester-plan invite links — mint them, label them, see who redeemed.
 *
 * These links are deliberately NOT surfaced anywhere in the product: there's no
 * admin page and nothing on the marketing site. They're private URLs you hand to
 * specific people, so the whole thing lives here in the terminal.
 *
 *   node scripts/trial-links.mjs list                    # all links + status
 *   node scripts/trial-links.mjs free                    # only unused ones
 *   node scripts/trial-links.mjs assign 7 "Acme — Jane" jane@acme.com
 *   node scripts/trial-links.mjs new 25                  # mint 25 more
 *   node scripts/trial-links.mjs revoke 7                # kill a link
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY from .env.local — trial_invites has no
 * authenticated RLS policies, so the service-role key is the only way in.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = {};
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(path.join(ROOT, file), "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      // File is optional.
    }
  }
  return env;
}

const env = { ...loadEnv(), ...process.env };
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const APP = (env.NEXT_PUBLIC_APP_URL || "https://shieldflow.cloud").replace(/\/+$/, "");

if (!URL_BASE || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: init.method === "POST" ? "return=representation" : "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const link = (code) => `${APP}/trial/${code}`;

async function fetchAll() {
  return rest(
    "trial_invites?select=code,seq,label,recipient_email,trial_days,max_uses,used_count,active,expires_at,trial_redemptions(user_email,redeemed_at,trial_ends_at)&order=seq.asc",
  );
}

function statusOf(inv) {
  const r = inv.trial_redemptions?.[0];
  if (r) {
    const ends = new Date(r.trial_ends_at);
    const days = Math.ceil((ends - Date.now()) / 86_400_000);
    return days > 0
      ? `REDEEMED by ${r.user_email} — ${days}d left`
      : `REDEEMED by ${r.user_email} — trial ended, now on Free`;
  }
  if (!inv.active) return "REVOKED";
  if (inv.expires_at && new Date(inv.expires_at) < Date.now()) return "LINK EXPIRED";
  if (inv.used_count >= inv.max_uses) return "USED UP";
  return "unused";
}

function print(rows) {
  if (!rows.length) return console.log("(none)");
  const w = Math.max(...rows.map((r) => link(r.code).length));
  for (const inv of rows) {
    const who = inv.label ? ` — ${inv.label}` : "";
    const mail = inv.recipient_email ? ` <${inv.recipient_email}>` : "";
    console.log(
      `#${String(inv.seq).padStart(3, "0")}  ${link(inv.code).padEnd(w)}  ${statusOf(inv)}${who}${mail}`,
    );
  }
  console.log(`\n${rows.length} link(s). Each grants ${rows[0].trial_days} days of full access.`);
}

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case "list": {
      print(await fetchAll());
      break;
    }

    case "free": {
      const all = await fetchAll();
      print(all.filter((i) => statusOf(i) === "unused"));
      break;
    }

    case "assign": {
      const seq = Number(args[0]);
      const label = args[1];
      const email = args[2] ?? null;
      if (!Number.isInteger(seq) || !label) {
        console.error('Usage: assign <seq> "<label>" [email]');
        process.exit(1);
      }
      const body = { label, recipient_email: email };
      const [row] = await rest(`trial_invites?seq=eq.${seq}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!row) {
        console.error(`No link #${seq}.`);
        process.exit(1);
      }
      console.log(`#${String(row.seq).padStart(3, "0")} → ${label}${email ? ` <${email}>` : ""}`);
      console.log(`Send them: ${link(row.code)}`);
      break;
    }

    case "new": {
      const n = Number(args[0] ?? 10);
      if (!Number.isInteger(n) || n < 1 || n > 500) {
        console.error("Usage: new <1-500>");
        process.exit(1);
      }
      const all = await fetchAll();
      let next = all.reduce((m, i) => Math.max(m, i.seq), 0) + 1;
      // Same shape the migration seeds: 6 random hex chars + the recipient number.
      const rand = () => Math.random().toString(16).slice(2, 8).padEnd(6, "0");
      const rows = Array.from({ length: n }, () => {
        const seq = next++;
        return { code: `${rand()}-${String(seq).padStart(3, "0")}`, seq };
      });
      const made = await rest("trial_invites", { method: "POST", body: JSON.stringify(rows) });
      print(made.map((m) => ({ ...m, trial_redemptions: [] })));
      break;
    }

    case "revoke": {
      const seq = Number(args[0]);
      if (!Number.isInteger(seq)) {
        console.error("Usage: revoke <seq>");
        process.exit(1);
      }
      const [row] = await rest(`trial_invites?seq=eq.${seq}`, {
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      });
      console.log(row ? `Revoked #${row.seq} (${row.code}).` : `No link #${seq}.`);
      break;
    }

    default:
      console.log(
        [
          "Tester-plan invite links",
          "",
          "  list                          every link + who redeemed it",
          "  free                          only links not yet used",
          '  assign <seq> "<label>" [mail] record who you sent link #seq to',
          "  new <count>                   mint more links",
          "  revoke <seq>                  disable a link",
        ].join("\n"),
      );
  }
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
}
