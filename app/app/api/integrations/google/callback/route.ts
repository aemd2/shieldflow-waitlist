import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { exchangeCode, isGoogleConfigured } from "@/lib/google";
import { encryptSecret, isEncryptionConfigured } from "@/lib/crypto";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const done = (q: string) => NextResponse.redirect(`${origin}/integrations?${q}`);

  if (!isGoogleConfigured()) return done("error=not_configured");
  if (!isEncryptionConfigured()) return done("error=encryption_not_configured");

  // User denied consent at Google, or Google returned an error.
  if (url.searchParams.get("error")) return done("error=denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookieState = /(?:^|;\s*)gws_oauth_state=([^;]+)/.exec(cookieHeader)?.[1];
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
    const tokens = await exchangeCode(code, `${origin}/api/integrations/google/callback`);
    const { error } = await supabase.from("integrations").upsert(
      {
        company_id: company.id,
        provider: "google_workspace",
        access_token: encryptSecret(tokens.access_token),
        // Google only returns refresh_token on first consent (we force prompt=consent,
        // so it should always be present — but never overwrite a good one with null).
        ...(tokens.refresh_token ? { refresh_token: encryptSecret(tokens.refresh_token) } : {}),
        // Google occasionally omits expires_in — fall back to its standard 1h.
        token_expires_at: new Date(
          Date.now() + (Number.isFinite(tokens.expires_in) ? tokens.expires_in : 3600) * 1000,
        ).toISOString(),
        status: "connected",
        connected_by: user.id,
      },
      { onConflict: "company_id,provider" },
    );
    if (error) return done("error=db");
  } catch {
    return done("error=exchange_failed");
  }

  const res = done("connected=google");
  res.cookies.delete("gws_oauth_state");
  return res;
}
