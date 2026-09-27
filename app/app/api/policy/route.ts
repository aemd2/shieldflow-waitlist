import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listFrameworks } from "@/lib/db/queries";
import { assertFeature } from "@/lib/plan-server";
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

  // Plan gate: AI costs real money per call, so it's the first thing a Free
  // workspace loses when its Tester trial lapses.
  const locked = await assertFeature(supabase, company.id, "ai_policy");
  if (locked) return NextResponse.json({ error: locked }, { status: 403 });

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

  // Who the policy is for. Without this the model writes for an enterprise it
  // imagines — a CISO, a Security Operations team, Azure and GCP — and a
  // 13-person company approves a document describing a company it isn't.
  // Aggregate only: a headcount and the company's own vendor names.
  const [{ count: headcount }, { data: vendorRows }] = await Promise.all([
    supabase.from("personnel").select("id", { count: "exact", head: true })
      .eq("company_id", company.id).eq("status", "active"),
    supabase.from("vendors").select("name").eq("company_id", company.id).eq("status", "active").limit(30),
  ]);
  const size = headcount ? `about ${headcount} people` : "a small team (11–200 people)";
  const stack = (vendorRows ?? []).map((v) => sanitizeForPrompt(v.name as string, 60)).filter(Boolean);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a senior GRC compliance consultant. You write clear, professional, " +
        "audit-ready policy documents in Markdown. Use headings, numbered sections, and " +
        "concrete control language. Do not include commentary outside the policy itself.\n\n" +
        "Write for the company as it is, not an enterprise:\n" +
        "- Name only roles a company of this size has (for example a security lead who is " +
        "often the CTO or Head of Engineering, managers, system owners). Never invent a CISO, " +
        "a Security Operations team, a SOC or other departments it doesn't have.\n" +
        "- Name only the systems and vendors you are given. Never invent a cloud provider or tool.\n" +
        "- Set numbers and timeframes a small team can actually meet.\n" +
        "- Passwords follow current NIST SP 800-63B guidance: no periodic forced changes " +
        "(change only on evidence of compromise), no composition rules (mixed case, symbols), " +
        "length over complexity — at least 12 characters, 15 where a password is the only " +
        "factor — screened against known-breached passwords, stored in a password manager, " +
        "with multi-factor authentication wherever it is supported.",
    },
    {
      role: "user",
      content:
        `Write a complete "${policyType}" for the company "${sanitizeForPrompt(company.name)}", aligned to ${frameworkName}. ` +
        "Include: Purpose, Scope, Policy Statements, Roles & Responsibilities, Enforcement, and Review Cadence. " +
        `The company is a SaaS business of ${size}. ` +
        (stack.length ? `Its main systems and vendors: ${stack.join(", ")}. ` : "") +
        "Output only Markdown.",
    },
  ];

  try {
    // 3000 is deliberately between two failure modes. Below ~2,200 a policy
    // truncates: real runs land at 2,000-2,100 completion tokens and 2048 came
    // back finish_reason "length" — a document cut off mid-section. Above ~3,500
    // it starts tripping Groq's free tier, which counts max_tokens as REQUESTED
    // against the 8,000 tokens/minute budget whether or not they are used: at
    // 4096 a second AI call in the same minute failed with "Limit 8000, Used
    // 5630, Requested 4169". 3000 leaves room for a concurrent call.
    let body = await groqComplete(messages, { maxTokens: 3000, temperature: 0.4 });
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
