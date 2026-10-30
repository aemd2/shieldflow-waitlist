#!/usr/bin/env node
/**
 * Does our SMTP credential actually authenticate?
 *
 * Supabase only ever reports `535 "Authentication credentials invalid"`, which
 * cannot tell you whether the key is wrong or the settings were never saved.
 * This talks to the SMTP server directly with the key from .env.local, so the
 * answer is unambiguous before anyone touches the dashboard again.
 *
 * Reads RESEND_API_KEY from .env.local — never from an argument, so the key
 * doesn't end up in shell history or a chat transcript.
 *
 * Usage:  node scripts/test-smtp.mjs
 */

import tls from "node:tls";
import { readFileSync } from "node:fs";

const HOST = "smtp.resend.com";
const PORT = 465;
const USER = "resend"; // Resend requires this literal username, not an email.

let key = "";
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*RESEND_API_KEY\s*=\s*(.*)\s*$/);
    if (m) key = m[1].replace(/^["']|["']$/g, "").trim();
  }
} catch {
  console.error("Could not read .env.local");
  process.exit(2);
}
if (!key) {
  console.error("RESEND_API_KEY is not set in .env.local");
  process.exit(2);
}

console.log(`key: ${key.length} chars, starts "${key.slice(0, 3)}…", ends "…${key.slice(-3)}"`);
if (/\s/.test(key)) console.log("WARNING: the key contains whitespace — that alone can cause 535.");

const socket = tls.connect({ host: HOST, port: PORT, servername: HOST }, () => {
  console.log(`connected to ${HOST}:${PORT}\n`);
});
socket.setEncoding("utf8");

const steps = [
  { send: null, expect: "220" },
  { send: "EHLO shieldflow.cloud", expect: "250" },
  { send: "AUTH LOGIN", expect: "334" },
  { send: Buffer.from(USER).toString("base64"), expect: "334" },
  { send: Buffer.from(key).toString("base64"), expect: "235" },
];

let i = 0;
let buffer = "";

socket.on("data", (chunk) => {
  buffer += chunk;
  if (!buffer.endsWith("\n")) return;
  const reply = buffer.trim();
  buffer = "";

  const step = steps[i];
  const shown = step.send && i === 4 ? "<base64 api key>" : step.send;
  const code = reply.slice(0, 3);
  const okay = code === step.expect;

  console.log(`${okay ? "ok  " : "FAIL"}  ${shown ? `> ${shown}` : "(greeting)"}`);
  console.log(`      < ${reply.split("\n").pop()}`);

  if (!okay) {
    if (code === "535") {
      console.log(`
DIAGNOSIS: the API key itself is rejected by Resend.
Create a new one at https://resend.com/api-keys with "Sending access",
put it in .env.local, and run this again before touching Supabase.`);
    }
    socket.end();
    process.exit(1);
  }

  i++;
  if (i < steps.length) {
    socket.write(steps[i].send + "\r\n");
  } else {
    console.log(`
DIAGNOSIS: the key authenticates fine.
So the key is NOT the problem — the Supabase SMTP settings were not saved, or
hold a different value. Re-enter it at Authentication - Emails - SMTP Settings
and make sure you click Save changes.`);
    socket.write("QUIT\r\n");
    socket.end();
    process.exit(0);
  }
});

socket.on("error", (err) => {
  console.error(`connection error: ${err.message}`);
  process.exit(2);
});
socket.setTimeout(15000, () => {
  console.error("timed out");
  process.exit(2);
});
