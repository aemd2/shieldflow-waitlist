import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildSlackConsentUrl, isSlackOAuthConfigured } from "@/lib/slack";
import { newUuid } from "@/lib/uuid";

export const runtime = "nodejs";

// Kicks off the Slack OAuth consent flow — same CSRF-nonce pattern as Google/GitHub.
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  if (!isSlackOAuthConfigured()) {
    return NextResponse.redirect(`${origin}/integrations?error=not_configured`);
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const state = newUuid();
  const redirectUri = `${origin}/api/integrations/slack/callback`;

  const res = NextResponse.redirect(buildSlackConsentUrl(redirectUri, state));
  res.cookies.set("slack_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    maxAge: 600,
    path: "/api/integrations/slack",
  });
  return res;
}
