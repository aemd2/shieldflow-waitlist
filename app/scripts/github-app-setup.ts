/**
 * One-time owner setup: create the read-only ShieldFlow GitHub App from a
 * manifest, so nobody has to fill in GitHub's form or copy keys by hand.
 *
 *   npx tsx scripts/github-app-setup.ts            create the App (one click on GitHub)
 *   npx tsx scripts/github-app-setup.ts --vercel   copy its keys into Vercel (CLI must be logged in)
 *
 * Step 1 serves a page on localhost that posts the App's definition to GitHub.
 * The owner clicks "Create GitHub App"; GitHub sends a one-time code back here,
 * which is exchanged for the App's id, keys and secret. They are written to
 * .env.local and .env.github-app.local (both git-ignored) and never printed.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PORT = 3999;
const PROD = process.env.SHIELDFLOW_PROD_URL ?? "https://shieldflow.cloud";
const APP_DIR = path.resolve(__dirname, "..");
const ENV_LOCAL = path.join(APP_DIR, ".env.local");
const SECRETS = path.join(APP_DIR, ".env.github-app.local");
const KEYS = ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY"] as const;

/** Everything read-only; no Contents, so the App can never read code. */
export const MANIFEST = {
  name: process.env.GITHUB_APP_NAME ?? "ShieldFlow Compliance",
  url: `${PROD}/checks/github`,
  description: "Read-only compliance checks: branch protection, reviewed merges, 2FA, Dependabot and secret-scanning alerts. Never reads code, never writes.",
  hook_attributes: { url: `${PROD}/api/integrations/github/app/webhook`, active: false },
  redirect_url: `http://localhost:${PORT}/done`,
  callback_urls: [`${PROD}/api/integrations/github/app/callback`, "http://localhost:3001/api/integrations/github/app/callback"],
  request_oauth_on_install: true,
  public: true,
  default_permissions: {
    metadata: "read",
    administration: "read",
    pull_requests: "read",
    vulnerability_alerts: "read",
    secret_scanning_alerts: "read",
    security_events: "read",
    members: "read",
    organization_administration: "read",
  },
  default_events: [] as string[],
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function setEnv(file: string, values: Record<string, string>) {
  const lines = existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n") : [];
  const kept = lines.filter((l) => !Object.keys(values).some((k) => l.startsWith(`${k}=`)));
  // Keep the block where the example file puts it, or append it.
  const at = kept.findIndex((l) => l.startsWith("# GitHub App"));
  const block = Object.entries(values).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  if (at >= 0) kept.splice(at + 1, 0, ...block);
  else kept.push("", "# GitHub App (read-only) — written by scripts/github-app-setup.ts", ...block);
  writeFileSync(file, kept.join("\n").replace(/\n{3,}/g, "\n\n"));
}

function readSecrets(): Record<string, string> {
  if (!existsSync(SECRETS)) throw new Error("No GitHub App keys yet — run the setup without --vercel first.");
  const out: Record<string, string> = {};
  for (const l of readFileSync(SECRETS, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(l.trim());
    if (m) out[m[1]] = JSON.parse(m[2]);
  }
  return out;
}

function pushToVercel() {
  const values = readSecrets();
  const vercel = (args: string[], input?: string) =>
    execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", "vercel@latest", ...args], { cwd: APP_DIR, input, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" }).toString();
  for (const k of KEYS) {
    try {
      vercel(["env", "rm", k, "production", "--yes"]);
    } catch {
      // not there yet
    }
    vercel(["env", "add", k, "production"], values[k]);
    console.log(`  ✓ ${k} set in Vercel (production)`);
  }
  console.log("Done. The next production deploy picks them up.");
}

async function create() {
  const state = randomBytes(16).toString("hex");
  const page = `<!doctype html><meta charset="utf-8"><title>Create the ShieldFlow GitHub App</title>
<body style="font-family:system-ui;max-width:40rem;margin:3rem auto;line-height:1.5">
<h1>Create the ShieldFlow GitHub App</h1>
<p>This sends GitHub the App's definition — every permission read-only, no access to code. GitHub shows it to you; click <b>Create GitHub App</b> there.</p>
<form id="f" method="post" action="https://github.com/settings/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${esc(JSON.stringify(MANIFEST))}">
<button style="font-size:1rem;padding:.6rem 1rem">Continue to GitHub</button></form>
<script>document.getElementById("f").submit()</script></body>`;

  await new Promise<void>((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      if (url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html" }).end(page);
        return;
      }
      if (url.pathname !== "/done") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("This link didn't come from this setup run — start it again.");
        return;
      }
      try {
        const r = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
          method: "POST",
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
        const app = (await r.json()) as { id: number; slug: string; client_id: string; client_secret: string; pem: string; owner?: { login?: string }; html_url?: string };
        const values = {
          GITHUB_APP_ID: String(app.id),
          GITHUB_APP_SLUG: app.slug,
          GITHUB_APP_CLIENT_ID: app.client_id,
          GITHUB_APP_CLIENT_SECRET: app.client_secret,
          GITHUB_APP_PRIVATE_KEY: app.pem,
        };
        setEnv(ENV_LOCAL, values);
        writeFileSync(SECRETS, Object.entries(values).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n");
        res.writeHead(200, { "Content-Type": "text/html" }).end(
          `<body style="font-family:system-ui;max-width:40rem;margin:3rem auto"><h1>Done ✓</h1><p>The GitHub App <b>${esc(app.slug)}</b> exists and its keys are saved on this computer. You can close this tab.</p></body>`,
        );
        console.log(`GitHub App created: ${app.slug} (id ${app.id}, owner ${app.owner?.login ?? "?"}).`);
        console.log(`Keys written to .env.local and .env.github-app.local (not printed). Settings: ${app.html_url ?? ""}`);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" }).end("Couldn't finish — run the setup again.");
        console.error("Conversion failed:", (err as Error).message);
      }
      server.close();
      resolve();
    });
    server.listen(PORT, () => console.log(`Open http://localhost:${PORT}/ and click "Create GitHub App" on GitHub.`));
  });
}

if (process.argv.includes("--vercel")) pushToVercel();
else void create();
