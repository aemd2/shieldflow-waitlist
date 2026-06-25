import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import {
  exchangeSlackCode,
  isSlackOAuthConfigured,
  isValidSlackWebhook,
  sendSlackMessage,
} from "@/lib/slack";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const done = (q: string) => NextResponse.redirect(`${origin}/integrations?${q}`);

  if (!isSlackOAuthConfigured()) return done("error=not_configured");

  // User clicked "Cancel" on the Slack consent page.
  if (url.searchParams.get("error")) return done("error=denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookieState = /(?:^|;\s*)slack_oauth_state=([^;]+)/.exec(cookieHeader)?.[1];

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
    const redirectUri = `${origin}/api/integrations/slack/callback`;
    const { webhookUrl, channel, teamName } = await exchangeSlackCode(code, redirectUri);

    // Extra safety: only store genuine Slack webhook URLs (SSRF guard).
    if (!isValidSlackWebhook(webhookUrl)) return done("error=invalid_webhook");

    // Send a test message so the user sees immediate confirmation.
    await sendSlackMessage(
      webhookUrl,
      `:shield: *ShieldFlow connected* — compliance alerts for *${company.name}* will arrive in this channel.`,
    );

    const { error } = await supabase.from("integrations").upsert(
      {
        company_id: company.id,
        provider: "slack",
        // Store the webhook URL in access_token — same field the digest sender reads.
        access_token: webhookUrl,
        status: "connected",
        connected_by: user.id,
        metadata: { channel, teamName },
      },
      { onConflict: "company_id,provider" },
    );
    if (error) return done("error=db");
  } catch {
    return done("error=exchange_failed");
  }

  const res = done("connected=slack");
  res.cookies.delete("slack_oauth_state");
  return res;
}
