import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { appConfig } from "@/lib/integrations/github/client";
import { newUuid } from "@/lib/uuid";

export const runtime = "nodejs";

/**
 * Install the ShieldFlow GitHub App (read-only). GitHub shows the customer the
 * exact permissions, they pick the organisation and repositories, and GitHub
 * sends them back to /callback with the installation and a one-time code that
 * proves who installed it.
 */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const cfg = appConfig();
  if (!cfg.configured) return NextResponse.redirect(`${origin}/integrations?error=github_app_not_configured`);

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const state = newUuid();
  const res = NextResponse.redirect(`https://github.com/apps/${cfg.slug}/installations/new?state=${state}`);
  res.cookies.set("gh_app_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    maxAge: 900,
    path: "/api/integrations/github",
  });
  return res;
}
