/**
 * Check the GitHub App's keys work and list where it's installed — no secret printed.
 *   npx tsx scripts/github-app-check.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

(async () => {
  const { appJwt, appConfig } = await import("@/lib/integrations/github/client");
  const cfg = appConfig();
  console.log("configured:", cfg.configured, "slug:", cfg.slug);
  const h = { Authorization: `Bearer ${appJwt()}`, Accept: "application/vnd.github+json" };
  const app = (await (await fetch("https://api.github.com/app", { headers: h })).json()) as { slug?: string; owner?: { login?: string }; permissions?: unknown; message?: string };
  if (!app.slug) throw new Error(`GitHub refused the App key: ${app.message ?? "unknown"}`);
  console.log("app:", app.slug, "owner:", app.owner?.login, "permissions:", JSON.stringify(app.permissions));
  const inst = (await (await fetch("https://api.github.com/app/installations", { headers: h })).json()) as { id: number; account: { login: string }; repository_selection: string }[];
  console.log("installations:", inst.map((i) => `${i.id} on ${i.account.login} (${i.repository_selection})`).join(", ") || "none yet");
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
