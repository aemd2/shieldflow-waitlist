import { NextResponse } from "next/server";
import { newUuid } from "@/lib/uuid";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildConsentUrl, isGoogleConfigured } from "@/lib/google";

export const runtime = "nodejs";

// Kicks off the Google Workspace OAuth consent flow. The random `state` nonce
// is mirrored in an HttpOnly cookie and checked in the callback (CSRF guard).
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  if (!isGoogleConfigured()) {
    return NextResponse.redirect(`${origin}/integrations?error=not_configured`);
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const state = newUuid();
  const redirectUri = `${origin}/api/integrations/google/callback`;

  const res = NextResponse.redirect(buildConsentUrl(redirectUri, state));
  res.cookies.set("gws_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    maxAge: 600, // consent shouldn't take more than 10 minutes
    path: "/api/integrations/google",
  });
  return res;
}
