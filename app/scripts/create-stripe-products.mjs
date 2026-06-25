// Creates real Stripe products + prices in TEST mode using STRIPE_SECRET_KEY.
// Run once: node scripts/create-stripe-products.mjs
// Then paste the price IDs into .env.local as shown at the end.
import Stripe from "stripe";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local manually (no dotenv dependency required)
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
const envVars = Object.fromEntries(
  envContent
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const key = envVars["STRIPE_SECRET_KEY"];
if (!key) {
  console.error("❌  STRIPE_SECRET_KEY not found in .env.local");
  process.exit(1);
}
if (!key.startsWith("sk_test_")) {
  console.error("❌  Key is not a test key (must start with sk_test_). Aborting.");
  process.exit(1);
}

const stripe = new Stripe(key);

async function createProduct(name, description, amountCents) {
  // Check if product already exists to avoid duplicates
  const existing = await stripe.products.search({
    query: `name:"${name}" AND active:"true"`,
    limit: 1,
  });

  let product;
  if (existing.data.length > 0) {
    product = existing.data[0];
    console.log(`⚡ Product already exists: ${product.name} (${product.id})`);
  } else {
    product = await stripe.products.create({ name, description });
    console.log(`✅ Created product: ${product.name} (${product.id})`);
  }

  // Check if a monthly EUR price already exists for this product
  const prices = await stripe.prices.list({
    product: product.id,
    active: true,
    limit: 10,
  });
  const existing_price = prices.data.find(
    (p) =>
      p.currency === "eur" &&
      p.recurring?.interval === "month" &&
      p.unit_amount === amountCents
  );

  if (existing_price) {
    console.log(`⚡ Price already exists: ${existing_price.id} (€${amountCents / 100}/mo)`);
    return { product, price: existing_price };
  }

  const price = await stripe.prices.create({
    product: product.id,
    currency: "eur",
    unit_amount: amountCents,
    recurring: { interval: "month" },
  });
  console.log(`✅ Created price: ${price.id} (€${amountCents / 100}/mo)`);
  return { product, price };
}

console.log("Creating ShieldFlow products in Stripe TEST mode...\n");

const starter = await createProduct(
  "ShieldFlow Starter",
  "Up to 2 frameworks, evidence vault, monitoring & alerts, AI Policy Generator, AI Co-Pilot.",
  24900 // €249.00
);

const growth = await createProduct(
  "ShieldFlow Growth",
  "Everything in Starter plus Google Workspace, vendor risk management, Public Trust Center, Priority support.",
  59900 // €599.00
);

console.log("\n──────────────────────────────────────────────");
console.log("Add these to your .env.local:\n");
console.log(`STRIPE_PRICE_STARTER=${starter.price.id}`);
console.log(`STRIPE_PRICE_GROWTH=${growth.price.id}`);
console.log("──────────────────────────────────────────────");
console.log("\nThen go to Stripe Dashboard → Settings → Customer portal →");
console.log("Subscriptions → find your products and add them.");
