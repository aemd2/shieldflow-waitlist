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
import { assertFeature } from "@/lib/plan-server";
import { groqComplete, GroqError, isGroqConfigured, type ChatMessage } from "@/lib/groq";
import { sanitizeForPrompt } from "@/lib/validation";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { redactedText } from "@/lib/redact";
import { CHECK_PROVIDER_LABELS } from "@/lib/checks";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cap per call so the prompt + response stay bounded; the UI can re-run for the rest.
const MAX_ITEMS = 25;

/**
 * Questions no workspace data can answer — ShieldFlow keeps no record of
 * certifications, audit reports or penetration tests — always go to a person,
 * whatever the model says. A drafted "yes" here is the costliest mistake a
 * questionnaire tool can make, and a drafted "no" is nearly as bad.
 */
const ALWAYS_REVIEW =
  /\b(soc ?[12]|type (?:ii?|[12])|iso ?(?:\/ ?iec ?)?27001|certif\w*|attest\w*|audit(?:ed)? (?:report|opinion)|pen(?:etration)? ?test\w*|pentest\w*)\b/i;

/** Check details that are only a coverage figure, matched to the exact sentences
 *  lib/checks.ts writes, so nothing with a name in it can ever match. */
const COVERAGE_DETAIL =
  /^\d+\/\d+ (?:users have 2-step verification|active users have MFA enrolled) \(\d+%\)\.?$/;

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

  // Plan gate: AI costs real money per call, so it's the first thing a Free
  // workspace loses when its Tester trial lapses.
  const locked = await assertFeature(supabase, company.id, "ai_questionnaire");
  if (locked) return NextResponse.json({ error: locked }, { status: 403 });

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
        "COMPANY CONTEXT provided. Write as the company (\"We ...\"), concise, factual and " +
        "professional, ready to send to a customer: cite supporting documents by name, and you may " +
        "say a control is monitored automatically, but never mention internal statuses (\"marked " +
        "complete\"), check names, the context or these instructions. " +
        "If the context does not support a truthful answer, set grounded=false and write one short " +
        "note for the reviewer saying what is missing, in the form \"No record of penetration " +
        "testing yet — confirm before sending.\" Absence of a record is not proof: if the honest " +
        "answer would be \"no\" only because nothing is recorded, that is grounded=false too. " +
        "NEVER invent specific facts (certifications, dates, numbers, named tools) that are not in " +
        "the context. A framework being in scope is NOT a certification, audit or report: never " +
        "claim one exists. A passing automated check means the company's threshold is met today, " +
        "not that coverage is total — do not say \"all\" unless the context says so. Tracking a " +
        "vendor is not the same as assessing it; only say vendors are assessed if reviews are recorded. " +
        "If an automated check about the question's topic is failing or inconclusive, set " +
        "grounded=false: a person should decide how to word a known gap.",
    },
    {
      role: "user",
      content:
        // The questions are pasted by the user and are the only free text here,
        // so they are redacted on the way out. Context above is all aggregate.
        `COMPANY CONTEXT:\n${context}\n\nQUESTIONS:\n${redactedText(numbered)}\n\n` +
        `Respond with ONLY a JSON array, one object per question in order, like ` +
        `[{"i":1,"answer":"...","grounded":true}]. No text outside the JSON.`,
    },
  ];

  let raw: string;
  try {
    raw = await groqComplete(messages, { maxTokens: 3000, temperature: 0.1 });
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
    const status = a.grounded === false || ALWAYS_REVIEW.test(item.question) ? "needs_review" : "draft";
    const { error } = await supabase
      .from("questionnaire_items")
      .update({ answer: a.answer.slice(0, 5000), status })
      .eq("company_id", company.id)
      .eq("id", item.id);
    if (!error) drafted += 1;
  }

  return NextResponse.json({ ok: true, drafted });
}

/**
 * A compact, factual snapshot of the company's compliance posture for grounding.
 *
 * Aggregate by design: catalogue names (measures, check keys), titles of the
 * company's own documents, counts and dates — never a person's name or email.
 * Checks are sent as name + result; a detail goes along only when it is a bare
 * coverage figure (COVERAGE_DETAIL), because other details name the people
 * involved. See lib/redact.ts for why that boundary matters.
 */
async function buildContext(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  companyName: string,
): Promise<string> {
  const [frameworks, selectedIds, controls, policies, integrations, vendors, measures, checks, evidence, reviews] =
    await Promise.all([
      listFrameworks(supabase),
      listSelectedFrameworkIds(supabase, companyId),
      getControlsWithStatus(supabase, companyId),
      listPolicies(supabase, companyId),
      listIntegrations(supabase, companyId),
      listVendors(supabase, companyId),
      supabase.from("measure_status").select("status, measures(name)").eq("company_id", companyId).neq("status", "not_started"),
      supabase.from("control_checks").select("check_key, provider, result, detail").eq("company_id", companyId),
      supabase.from("evidence").select("file_name").eq("company_id", companyId).order("created_at", { ascending: false }).limit(200),
      supabase.from("access_reviews").select("status, completed_at").eq("company_id", companyId).eq("status", "completed")
        .order("completed_at", { ascending: false }).limit(1),
    ]);

  const fwNames = frameworks.filter((f) => selectedIds.includes(f.id)).map((f) => f.name);
  const complete = controls.filter((c) => c.status === "complete").length;
  const inProgress = controls.filter((c) => c.status === "in_progress").length;
  const publishedPolicies = policies
    .filter((p) => p.published_at || p.approved_at)
    .map((p) => p.title)
    .slice(0, 30);
  const providers = integrations.filter((i) => i.status === "connected").map((i) => i.provider);

  const measureRows = (measures.data ?? []) as unknown as { status: string; measures: { name: string } | null }[];
  const measuresBy = (status: string) =>
    measureRows.filter((m) => m.status === status && m.measures).map((m) => m.measures!.name).slice(0, 40);
  const doneMeasures = measuresBy("complete");
  const startedMeasures = measuresBy("in_progress");

  // One line per check key (a check is stored once per control it maps to).
  const checkResults = new Map<string, string>();
  for (const c of (checks.data ?? []) as { check_key: string; provider: string; result: string; detail: string | null }[]) {
    // A readable name, not the key: the model repeats whatever it's given.
    const what = (c.check_key.split(".")[1] ?? c.check_key).replace(/_/g, " ");
    // "13/14 users have 2-step verification (93%)." — without the figure, a pass
    // reads as total coverage and the draft says "all users".
    const figure = c.detail && COVERAGE_DETAIL.test(c.detail) ? ` (${c.detail.replace(/\.$/, "")})` : "";
    checkResults.set(c.check_key, `${CHECK_PROVIDER_LABELS[c.provider] ?? c.provider} ${what}: ${c.result}${figure}`);
  }

  const documents = [...new Set(((evidence.data ?? []) as { file_name: string }[]).map((e) => e.file_name))]
    .slice(0, 25)
    .map((n) => sanitizeForPrompt(redactedText(n), 120));

  const reviewed = vendors.filter((v) => v.reviewed_at).length;
  const soc2OnFile = vendors.filter((v) => v.soc2_status === "on_file").length;
  const lastReview = (reviews.data?.[0] as { completed_at: string | null } | undefined)?.completed_at;

  const list = (xs: string[], none: string) => (xs.length ? xs.join("; ") : none);
  return [
    `Company: ${sanitizeForPrompt(companyName, 120)}`,
    `Compliance frameworks in scope (being worked towards — not certifications): ${fwNames.length ? fwNames.join(", ") : "none selected yet"}`,
    `Controls: ${complete} complete, ${inProgress} in progress, ${controls.length} total`,
    `Security measures the company has marked complete: ${list(doneMeasures, "none yet")}`,
    `Security measures in progress: ${list(startedMeasures, "none")}`,
    `Automated checks, latest result: ${list([...checkResults.values()], "none run yet")}`,
    `Evidence documents on file: ${list(documents, "none yet")}`,
    `Approved/published policies: ${publishedPolicies.length ? publishedPolicies.join("; ") : "none yet"}`,
    `Connected security integrations: ${providers.length ? providers.join(", ") : "none"}`,
    `Third-party vendors tracked: ${vendors.length} (${reviewed} with a recorded security review, ${soc2OnFile} with a SOC 2 report on file)`,
    `Last completed user access review: ${lastReview ? lastReview.slice(0, 10) : "none completed yet"}`,
  ].join("\n");
}
