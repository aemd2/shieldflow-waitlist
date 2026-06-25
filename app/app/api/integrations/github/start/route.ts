import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildGitHubConsentUrl, isGitHubOAuthConfigured } from "@/lib/github";
import { newUuid } from "@/lib/uuid";

export const runtime = "nodejs";

// Kicks off the GitHub OAuth consent flow — same CSRF-nonce pattern as Google.
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  if (!isGitHubOAuthConfigured()) {
    return NextResponse.redirect(`${origin}/integrations?error=not_configured`);
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const state = newUuid();
  const redirectUri = `${origin}/api/integrations/github/callback`;

  const res = NextResponse.redirect(buildGitHubConsentUrl(redirectUri, state));
  // Store state nonce in an HttpOnly cookie to verify in the callback (CSRF guard).
  res.cookies.set("gh_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    maxAge: 600,
    path: "/api/integrations/github",
  });
  return res;
}
