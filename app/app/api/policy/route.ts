import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listFrameworks } from "@/lib/db/queries";
import { groqComplete, GroqError, isGroqConfigured, type ChatMessage } from "@/lib/groq";
import { policyGenerateSchema, sanitizeForPrompt } from "@/lib/validation";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  // The request is a tiny JSON object — anything large is garbage; reject early.
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > 10_000) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }

  if (!isGroqConfigured()) {
    return NextResponse.json(
      { error: "AI is not configured yet. Add a GROQ_API_KEY to enable it." },
      { status: 503 },
    );
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // DB lookups can fail outright (e.g. paused free-tier project) — answer with
  // a friendly 503 instead of an unhandled 500.
  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return NextResponse.json(
      { error: "We couldn't reach the database. Please try again in a moment." },
      { status: 503 },
    );
  }
  if (!company) return NextResponse.json({ error: "No company found." }, { status: 400 });

  // Server-side guard — the disabled button in the UI is bypassable with curl.
  if (!checkRateLimit(`policy:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = policyGenerateSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid policy type." }, { status: 400 });
  }

  const { policyType, frameworkId } = parsed.data;
  let frameworkName = "general security best practices";
  if (frameworkId) {
    try {
      const frameworks = await listFrameworks(supabase);
      frameworkName = frameworks.find((f) => f.id === frameworkId)?.name ?? frameworkName;
    } catch {
      // Non-fatal: fall back to the generic framing rather than failing the request.
    }
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a senior GRC compliance consultant. You write clear, professional, " +
        "audit-ready policy documents in Markdown. Use headings, numbered sections, and " +
        "concrete control language. Do not include commentary outside the policy itself.",
    },
    {
      role: "user",
      content:
        `Write a complete "${policyType}" for the company "${sanitizeForPrompt(company.name)}", aligned to ${frameworkName}. ` +
        "Include: Purpose, Scope, Policy Statements, Roles & Responsibilities, Enforcement, and Review Cadence. " +
        "Keep it practical for an 11–200 employee SaaS company. Output only Markdown.",
    },
  ];

  try {
    let body = await groqComplete(messages, { maxTokens: 2048, temperature: 0.4 });
    // The model sometimes wraps the whole document in ``` fences, which would
    // render the saved policy as one giant code block — unwrap it.
    const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```\s*$/.exec(body.trim());
    if (fenced) body = fenced[1];
    const title = `${policyType} — ${company.name}`;
    return NextResponse.json({ title, body });
  } catch (err) {
    if (err instanceof GroqError) {
      return NextResponse.json({ error: err.userMessage }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to generate policy." }, { status: 500 });
  }
}
