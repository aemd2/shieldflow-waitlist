import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertIntegrationSlot } from "@/lib/plan-server";
import { appConfig, installationAccount } from "@/lib/integrations/github/client";
import { encryptSecret, isEncryptionConfigured } from "@/lib/crypto";
import { logEvent } from "@/lib/audit";
import { INTEGRATION_LABELS } from "@/lib/integration-evidence";

export const runtime = "nodejs";

/**
 * GitHub sends the installer back here with `installation_id` and — because the
 * App asks for user authorisation during install — a one-time `code`. An
 * installation id alone proves nothing (anyone could paste someone else's), so
 * the code is exchanged for the installer's own token and the installation must
 * appear in *their* list of installations before it's saved to this workspace.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const done = (q: string) => NextResponse.redirect(`${origin}/integrations${q.startsWith("/") ? q : `?${q}`}`);
  const cfg = appConfig();
  if (!cfg.configured) return done("error=github_app_not_configured");
  if (!isEncryptionConfigured()) return done("error=encryption_not_configured");

  const installationId = Number(url.searchParams.get("installation_id"));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = /(?:^|;\s*)gh_app_state=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  // Installs started from GitHub itself carry no state; then the code check below is the guard.
  if (state && cookieState && state !== cookieState) return done("error=state_mismatch");
  if (!installationId || !code) return done("error=github_install_incomplete");

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  const company = await getCompanyForUser(supabase, user.id).catch(() => null);
  if (!company) return NextResponse.redirect(`${origin}/onboarding`);
  const denied = (await assertCanWrite(supabase, company.id, user.id)) ?? (await assertIntegrationSlot(supabase, company.id, "github"));
  if (denied) return done("error=limit");

  try {
    // 1. Who installed it: exchange the one-time code for the installer's token.
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code }),
      signal: AbortSignal.timeout(15_000),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return done("error=github_install_unverified");

    // 2. The installation must be one this person can see.
    const instRes = await fetch("https://api.github.com/user/installations?per_page=100", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    });
    const inst = (await instRes.json()) as { installations?: { id: number }[] };
    if (!inst.installations?.some((i) => i.id === installationId)) return done("error=github_install_unverified");

    // 3. Save it. Settings from an earlier connection are kept.
    const account = await installationAccount(installationId);
    const { data: existing } = await supabase.from("integrations").select("metadata").eq("company_id", company.id).eq("provider", "github").maybeSingle();
    const { error } = await supabase.from("integrations").upsert(
      {
        company_id: company.id,
        provider: "github",
        access_token: encryptSecret(JSON.stringify({ kind: "app", installationId })),
        status: "connected",
        connected_by: user.id,
        metadata: { ...((existing?.metadata as Record<string, unknown> | null) ?? {}), login: account.login, account_type: account.type, connection: "app" },
      },
      { onConflict: "company_id,provider" },
    );
    if (error) return done("error=db");
    await logEvent(supabase, company.id, "integration.connected", {
      type: "integration",
      id: "github",
      label: INTEGRATION_LABELS.github,
      metadata: { account: account.login, connection: "GitHub App (read-only)" },
    });
  } catch {
    return done("error=exchange_failed");
  }

  const res = done("/github?connected=1");
  res.cookies.delete("gh_app_state");
  return res;
}
