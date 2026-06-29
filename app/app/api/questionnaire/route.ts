import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  listFrameworks,
  listSelectedFrameworkIds,
  getControlsWithStatus,
  listPolicies,
  listIntegrations,
  listVendors,
} from "@/lib/db/queries";
import { groqComplete, GroqError, isGroqConfigured, type ChatMessage } from "@/lib/groq";
import { sanitizeForPrompt } from "@/lib/validation";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cap per call so the prompt + response stay bounded; the UI can re-run for the rest.
const MAX_ITEMS = 25;

export async function POST(req: Request) {
  if ((Number(req.headers.get("content-length") ?? 0)) > 2_000) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }
  if (!isGroqConfigured()) {
    return NextResponse.json({ error: "AI is not configured yet. Add a GROQ_API_KEY to enable it." }, { status: 503 });
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return NextResponse.json({ error: "We couldn't reach the database." }, { status: 503 });
  }
  if (!company) return NextResponse.json({ error: "No company found." }, { status: 400 });

  if (!checkRateLimit(`questionnaire:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  let payload: { questionnaireId?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const questionnaireId = payload.questionnaireId;
  if (!questionnaireId || !/^[0-9a-f-]{36}$/i.test(questionnaireId)) {
    return NextResponse.json({ error: "Invalid questionnaire." }, { status: 400 });
  }

  // The non-approved items for this questionnaire (RLS scopes to the company).
  const { data: rows } = await supabase
    .from("questionnaire_items")
    .select("id, question, status")
    .eq("company_id", company.id)
    .eq("questionnaire_id", questionnaireId)
    .neq("status", "approved")
    .order("position", { ascending: true })
    .limit(MAX_ITEMS);
  const items = (rows ?? []) as { id: string; question: string }[];
  if (items.length === 0) {
    return NextResponse.json({ ok: true, drafted: 0 });
  }

  let context: string;
  try {
    context = await buildContext(supabase, company.id, company.name);
  } catch {
    return NextResponse.json({ error: "We couldn't load your compliance data." }, { status: 503 });
  }

  const numbered = items.map((it, i) => `${i + 1}. ${sanitizeForPrompt(it.question, 500)}`).join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You help a company answer a vendor security questionnaire. Answer ONLY using the " +
        "COMPANY CONTEXT provided. Be concise, factual, and professional. If the context does " +
        "not support a truthful answer, set grounded=false and give a short placeholder noting it " +
        "needs review. NEVER invent specific facts (certifications, dates, numbers, named tools) " +
        "that are not in the context.",
    },
    {
      role: "user",
      content:
        `COMPANY CONTEXT:\n${context}\n\nQUESTIONS:\n${numbered}\n\n` +
        `Respond with ONLY a JSON array, one object per question in order, like ` +
        `[{"i":1,"answer":"...","grounded":true}]. No text outside the JSON.`,
    },
  ];

  let raw: string;
  try {
    raw = await groqComplete(messages, { maxTokens: 4096, temperature: 0.3 });
  } catch (err) {
    if (err instanceof GroqError) return NextResponse.json({ error: err.userMessage }, { status: err.status });
    return NextResponse.json({ error: "Failed to draft answers." }, { status: 500 });
  }

  // The model may wrap the JSON in ``` fences — strip them before parsing.
  const cleaned = raw.trim().replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  let parsed: { i: number; answer: string; grounded?: boolean }[];
  try {
    parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("not an array");
  } catch {
    return NextResponse.json({ error: "The AI returned malformed output. Please try again." }, { status: 502 });
  }

  let drafted = 0;
  for (const a of parsed) {
    const idx = Number(a?.i) - 1;
    const item = items[idx];
    if (!item || typeof a.answer !== "string") continue;
    const status = a.grounded === false ? "needs_review" : "draft";
    const { error } = await supabase
      .from("questionnaire_items")
      .update({ answer: a.answer.slice(0, 5000), status })
      .eq("company_id", company.id)
      .eq("id", item.id);
    if (!error) drafted += 1;
  }

  return NextResponse.json({ ok: true, drafted });
}

/** A compact, factual snapshot of the company's compliance posture for grounding. */
async function buildContext(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  companyName: string,
): Promise<string> {
  const [frameworks, selectedIds, controls, policies, integrations, vendors] = await Promise.all([
    listFrameworks(supabase),
    listSelectedFrameworkIds(supabase, companyId),
    getControlsWithStatus(supabase, companyId),
    listPolicies(supabase, companyId),
    listIntegrations(supabase, companyId),
    listVendors(supabase, companyId),
  ]);

  const fwNames = frameworks.filter((f) => selectedIds.includes(f.id)).map((f) => f.name);
  const complete = controls.filter((c) => c.status === "complete").length;
  const inProgress = controls.filter((c) => c.status === "in_progress").length;
  const publishedPolicies = policies
    .filter((p) => p.published_at || p.approved_at)
    .map((p) => p.title)
    .slice(0, 30);
  const providers = integrations.filter((i) => i.status === "connected").map((i) => i.provider);

  return [
    `Company: ${sanitizeForPrompt(companyName, 120)}`,
    `Compliance frameworks in scope: ${fwNames.length ? fwNames.join(", ") : "none selected yet"}`,
    `Controls: ${complete} complete, ${inProgress} in progress, ${controls.length} total`,
    `Approved/published policies: ${publishedPolicies.length ? publishedPolicies.join("; ") : "none yet"}`,
    `Connected security integrations: ${providers.length ? providers.join(", ") : "none"}`,
    `Third-party vendors tracked: ${vendors.length}`,
  ].join("\n");
}
