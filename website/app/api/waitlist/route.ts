import { NextRequest, NextResponse } from "next/server";
import { waitlistSchema } from "@/lib/validation";
import { getServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 5;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + HOUR_MS });
    return true;
  }
  if (entry.count >= MAX_PER_HOUR) return false;
  entry.count += 1;
  return true;
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  if (!rateLimit(clientIp(req))) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = waitlistSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please check your details and try again." },
      { status: 400 }
    );
  }
  const { email, companyName, companySize, painPoint, source, website } = parsed.data;

  // Honeypot tripped → pretend success.
  if (website && website.length > 0) {
    return NextResponse.json({ message: "You're on the list." });
  }

  try {
    const supabase = getServiceSupabase();
    const { error } = await supabase.from("waitlist_signups").insert({
      email,
      company_name: companyName || null,
      company_size: companySize ?? null,
      pain_point: painPoint || null,
      source: source || null,
    });

    if (error) {
      // Duplicate email (unique violation) → friendly success message.
      if (error.code === "23505") {
        return NextResponse.json({
          message: "You're already on the list — we'll be in touch.",
        });
      }
      console.error("waitlist insert error", error);
      return NextResponse.json(
        { error: "Could not save your signup. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "You're on the list. We'll email you when early access opens.",
    });
  } catch (err) {
    console.error("waitlist handler error", err);
    return NextResponse.json(
      { error: "Server not configured. Please try again later." },
      { status: 500 }
    );
  }
}
