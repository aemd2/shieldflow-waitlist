/**
 * Create (or reuse) a Stripe webhook endpoint via the REST API — no Stripe CLI.
 *
 * Usage (from app root, after STRIPE_SECRET_KEY is in .env.local):
 *   npm run setup:stripe-webhook
 *
 * Optional env overrides:
 *   WEBHOOK_URL  — defaults to http://localhost:3001/api/stripe/webhook
 *
 * Note: Stripe cannot deliver webhooks to localhost unless you expose it (ngrok, etc.).
 * Checkout still syncs via billing?session_id=… on return; the webhook handles renewals/cancellations.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");

const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function upsertEnvKey(filePath, key, value) {
  let text = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) {
    text = text.replace(re, line);
  } else {
    if (text.length && !text.endsWith("\n")) text += "\n";
    text += `${line}\n`;
  }
  fs.writeFileSync(filePath, text, "utf8");
}

const fileEnv = loadEnvFile(ENV_PATH);
const secretKey = process.env.STRIPE_SECRET_KEY || fileEnv.STRIPE_SECRET_KEY;
const webhookUrl =
  process.env.WEBHOOK_URL ||
  fileEnv.WEBHOOK_URL ||
  `${fileEnv.NEXT_PUBLIC_APP_URL || "http://localhost:3001"}/api/stripe/webhook`;

if (!secretKey) {
  console.error("Missing STRIPE_SECRET_KEY — add it to .env.local first.");
  process.exit(1);
}

const stripe = new Stripe(secretKey);

const existing = await stripe.webhookEndpoints.list({ limit: 100 });
const match = existing.data.find((ep) => ep.url === webhookUrl);

let endpoint;
if (match) {
  endpoint = await stripe.webhookEndpoints.update(match.id, {
    enabled_events: WEBHOOK_EVENTS,
    disabled: false,
  });
  console.log(`Updated existing webhook endpoint: ${endpoint.id}`);
  console.log(
    "Signing secret is only returned on create. Reveal it in Stripe Dashboard → Developers → Webhooks → endpoint → Signing secret.",
  );
  if (fileEnv.STRIPE_WEBHOOK_SECRET) {
    console.log("STRIPE_WEBHOOK_SECRET already set in .env.local — leaving it unchanged.");
  } else {
    console.error(
      "No STRIPE_WEBHOOK_SECRET in .env.local. Open the dashboard link above and paste whsec_… into .env.local.",
    );
    process.exit(1);
  }
} else {
  try {
    endpoint = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: WEBHOOK_EVENTS,
      description: "ShieldFlow billing (local/dev)",
    });
  } catch (err) {
    if (webhookUrl.includes("localhost") && err?.param === "url") {
      console.log(
        "Stripe won't register localhost webhook URLs (needs a public URL).\n" +
          "Local checkout still works — billing syncs on return via /billing?session_id=…\n" +
          "Skip STRIPE_WEBHOOK_SECRET for now, or create the endpoint when you deploy.",
      );
      process.exit(0);
    }
    throw err;
  }
  if (!endpoint.secret) {
    console.error("Stripe did not return a signing secret. Check the dashboard.");
    process.exit(1);
  }
  upsertEnvKey(ENV_PATH, "STRIPE_WEBHOOK_SECRET", endpoint.secret);
  console.log(`Created webhook endpoint: ${endpoint.id}`);
  console.log(`Wrote STRIPE_WEBHOOK_SECRET to ${ENV_PATH}`);
}

console.log(`Webhook URL: ${webhookUrl}`);
if (webhookUrl.includes("localhost")) {
  console.log(
    "\nLocalhost note: Stripe cannot reach this URL from the internet. Checkout still syncs on return via /billing?session_id=…. Use a tunnel URL for live webhook delivery, or rely on billing-sync for local checkout tests.",
  );
}
