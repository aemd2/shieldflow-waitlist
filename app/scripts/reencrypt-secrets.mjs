/**
 * Re-encrypt legacy plaintext integration secrets to the latest standard.
 *
 * Why this exists:
 *   Integrations connected BEFORE SHIELDFLOW_ENCRYPTION_KEY was set are stored
 *   as plaintext (e.g. a Slack webhook URL or a GitHub token sitting in the DB
 *   in the clear). The app reads them fine (legacy fallback), but they are not
 *   encrypted at rest. This script finds every plaintext secret and rewrites it
 *   as `v1:` ciphertext — the exact same AES-256-GCM format the app uses in
 *   lib/crypto.ts — so nothing readable is left in the database.
 *
 * It is SAFE to run repeatedly (idempotent): a value already prefixed `v1:` is
 * left untouched. Nothing is decrypted-then-reencrypted; only plaintext is
 * upgraded, so a wrong/missing key can never corrupt existing ciphertext.
 *
 * Usage (from the app root, with .env.local filled in):
 *   npm run reencrypt-secrets
 *
 * Requires in .env.local:
 *   SHIELDFLOW_ENCRYPTION_KEY   — the same key the running app uses
 *   NEXT_PUBLIC_SUPABASE_URL    — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service role (bypasses RLS for this admin job)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");

// The version prefix that marks a value as already-encrypted (matches lib/crypto.ts).
const PREFIX = "v1";

// The DB columns that hold secrets and therefore must be encrypted at rest.
const SECRET_COLUMNS = ["access_token", "refresh_token"];

// --- Minimal .env.local reader (same approach as setup-stripe-webhook.mjs) ---
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes so the key bytes match what the app loads.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// --- Encryption: byte-for-byte identical to encryptSecret() in lib/crypto.ts ---
// Derive a 32-byte AES key from the configured passphrase via SHA-256.
function deriveKey(rawKey) {
  return crypto.createHash("sha256").update(rawKey, "utf8").digest();
}

function encryptSecret(plaintext, key) {
  const iv = crypto.randomBytes(12); // random 96-bit IV per value
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

// A value is "legacy plaintext" if it exists but is NOT already `v1:` ciphertext.
function isPlaintext(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith(`${PREFIX}:`);
}

// --- Main ---
const fileEnv = loadEnvFile(ENV_PATH);
const rawKey = process.env.SHIELDFLOW_ENCRYPTION_KEY || fileEnv.SHIELDFLOW_ENCRYPTION_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

// Fail closed: without a real key we must never touch the data.
if (!rawKey || rawKey.trim() === "") {
  console.error("Missing SHIELDFLOW_ENCRYPTION_KEY in .env.local — refusing to run (fail closed).");
  process.exit(1);
}
if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const key = deriveKey(rawKey);
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

// Pull every integration row (service role bypasses RLS for this admin task).
const { data: rows, error } = await supabase
  .from("integrations")
  .select("id, provider, access_token, refresh_token");

if (error) {
  console.error("Could not read integrations:", error.message);
  process.exit(1);
}

let upgraded = 0;
let alreadyOk = 0;

for (const row of rows ?? []) {
  // Build an update containing ONLY the columns that were plaintext.
  const update = {};
  for (const col of SECRET_COLUMNS) {
    if (isPlaintext(row[col])) {
      update[col] = encryptSecret(row[col], key);
    }
  }

  if (Object.keys(update).length === 0) {
    alreadyOk++;
    continue;
  }

  const { error: updErr } = await supabase
    .from("integrations")
    .update(update)
    .eq("id", row.id);

  if (updErr) {
    console.error(`Failed to upgrade ${row.provider} (${row.id}):`, updErr.message);
    continue;
  }
  upgraded++;
  console.log(`Upgraded ${row.provider} → encrypted (${Object.keys(update).join(", ")}).`);
}

console.log(
  `\nDone. ${upgraded} row(s) upgraded to v1: ciphertext, ${alreadyOk} already encrypted.`,
);
