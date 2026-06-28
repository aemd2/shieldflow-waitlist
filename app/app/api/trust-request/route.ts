import { NextRequest, NextResponse } from "next/server";
import { trustAccessRequestSchema } from "@/lib/validation";
import { createAdminSupabase, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Public, anonymous endpoint — IP rate-limited like the waitlist so a public Trust
// Center page can't be used to spam a company with access requests.
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
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "Not available right now." }, { status: 503 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = trustAccessRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please check your details and try again." }, { status: 400 });
  }
  const { slug, email, name, company, message, website } = parsed.data;

  // Honeypot tripped → pretend success.
  if (website && website.length > 0) {
    return NextResponse.json({ message: "Thanks — we'll be in touch." });
  }

  const admin = createAdminSupabase();

  // Resolve the slug to a company that actually has its Trust Center enabled.
  const { data: companyRow } = await admin
    .from("companies")
    .select("id")
    .eq("trust_slug", slug)
    .eq("trust_enabled", true)
    .maybeSingle();
  if (!companyRow) {
    return NextResponse.json({ error: "This Trust Center isn't accepting requests." }, { status: 404 });
  }

  const { error } = await admin.from("trust_access_requests").insert({
    company_id: companyRow.id,
    email,
    name: name || null,
    requester_company: company || null,
    message: message || null,
  });
  if (error) {
    return NextResponse.json({ error: "Could not submit your request. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ message: "Thanks — your request was sent to the security team." });
}
