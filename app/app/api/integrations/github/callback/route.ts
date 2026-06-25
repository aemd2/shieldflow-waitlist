import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { exchangeGitHubCode, validateToken, isGitHubOAuthConfigured } from "@/lib/github";
import { encryptSecret, isEncryptionConfigured } from "@/lib/crypto";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const done = (q: string) => NextResponse.redirect(`${origin}/integrations?${q}`);

  if (!isGitHubOAuthConfigured()) return done("error=not_configured");
  if (!isEncryptionConfigured()) return done("error=encryption_not_configured");

  // User denied consent on GitHub.
  if (url.searchParams.get("error")) return done("error=denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookieState = /(?:^|;\s*)gh_oauth_state=([^;]+)/.exec(cookieHeader)?.[1];

  // Reject mismatched or missing state (CSRF guard).
  if (!code || !state || !cookieState || state !== cookieState) {
    return done("error=state_mismatch");
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return done("error=db");
  }
  if (!company) return NextResponse.redirect(`${origin}/onboarding`);

  try {
    const redirectUri = `${origin}/api/integrations/github/callback`;
    const token = await exchangeGitHubCode(code, redirectUri);

    // Verify token works and get the GitHub login name for display.
    const login = await validateToken(token);

    const { error } = await supabase.from("integrations").upsert(
      {
        company_id: company.id,
        provider: "github",
        access_token: encryptSecret(token),
        status: "connected",
        connected_by: user.id,
        // Store login so the card can show "Connected as @username".
        metadata: { login },
      },
      { onConflict: "company_id,provider" },
    );
    if (error) return done("error=db");
  } catch {
    return done("error=exchange_failed");
  }

  const res = done("connected=github");
  res.cookies.delete("gh_oauth_state");
  return res;
}
