import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getControlsWithStatus,
  listPolicies,
  listCopilotMessages,
} from "@/lib/db/queries";
import { countStatuses } from "@/lib/score";
import { groqStream, GroqError, isGroqConfigured, type ChatMessage } from "@/lib/groq";
import { copilotSchema, sanitizeForPrompt } from "@/lib/validation";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const DB_UNAVAILABLE =
  "We couldn't reach the database. Please try again in a moment.";

export async function POST(req: Request) {
  // Cheap pre-parse guard: the message is capped at 2000 chars, so any body
  // beyond ~100KB is garbage — reject before buffering/parsing it.
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > 100_000) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }

  // Fail fast when AI isn't configured — BEFORE any DB write, so retries
  // against a missing key don't fill the database with orphaned questions.
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
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  if (!company) return NextResponse.json({ error: "No company found." }, { status: 400 });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = copilotSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid." }, { status: 400 });
  }
  const question = parsed.data.message;

  // Rate-limit BEFORE persisting — a flood shouldn't fill the DB with spam rows
  // on top of burning the Groq quota.
  if (!checkRateLimit(`copilot:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  // Build a COMPACT grounding context — summaries only, never full bodies.
  let controls, policies, history;
  try {
    [controls, policies, history] = await Promise.all([
      getControlsWithStatus(supabase, company.id),
      listPolicies(supabase, company.id),
      listCopilotMessages(supabase, company.id, user.id, 10),
    ]);
  } catch {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }

  // Persist the user's message now that we know we can actually answer it
  // (AI configured, DB reachable, within rate limit).
  await supabase.from("copilot_messages").insert({
    company_id: company.id,
    user_id: user.id,
    role: "user",
    content: question,
  });

  const counts = countStatuses(controls.map((c) => c.status));
  const controlLines = controls
    .map((c) => `${c.code} [${c.status}] ${c.title}`)
    .join("\n")
    .slice(0, 6000);
  const policyTitles = policies.map((p) => `- ${p.title} (${p.status})`).join("\n") || "None yet";

  const system =
    "You are ShieldFlow's Compliance Co-Pilot. Answer questions about the company's compliance " +
    "posture using ONLY the context provided. Be concise and practical. If something isn't in the " +
    "context, say so. Never invent control IDs or evidence.\n\n" +
    `Company: ${sanitizeForPrompt(company.name)}\n` +
    `Control summary: ${counts.complete} complete, ${counts.in_progress} in progress, ${counts.not_started} not started.\n` +
    `Controls:\n${controlLines}\n\nPolicies:\n${policyTitles}`;

  const priorTurns: ChatMessage[] = history
    .filter((m) => m.content !== question || m.role !== "user")
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...priorTurns,
    { role: "user", content: question },
  ];

  let upstream: Response;
  try {
    upstream = await groqStream(messages, { maxTokens: 1024, temperature: 0.3 });
  } catch (err) {
    const e = err instanceof GroqError ? err : new GroqError(502, "AI request failed.");
    return NextResponse.json({ error: e.userMessage }, { status: e.status });
  }

  // Re-stream Groq's SSE to the client as plain text deltas, accumulating the full
  // reply so we can persist the assistant turn once (and only once) at the end.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body!.getReader();
  let full = "";

  const persistAndPrune = async () => {
    if (full.trim()) {
      await supabase.from("copilot_messages").insert({
        company_id: company.id,
        user_id: user.id,
        role: "assistant",
        content: full,
      });
    }
    // Prune history beyond the newest 200 rows for this user so a heavy
    // chatter can't bloat the free-tier DB forever. Best-effort — a failure
    // here must never affect the response the user already received.
    try {
      const { data: old } = await supabase
        .from("copilot_messages")
        .select("id")
        .eq("company_id", company.id)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(200, 399);
      if (old && old.length > 0) {
        await supabase
          .from("copilot_messages")
          .delete()
          .in("id", old.map((r) => r.id));
      }
    } catch {
      // ignore — pruning is housekeeping, not correctness
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const data = t.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta?.content;
              if (delta) {
                full += delta;
                controller.enqueue(encoder.encode(delta));
              }
            } catch {
              // ignore keep-alive / partial frames
            }
          }
        }
      } catch {
        // client disconnect or upstream error — release the upstream connection
        // and fall through to persist what we have
        reader.cancel().catch(() => {});
      } finally {
        try {
          controller.close();
        } catch {
          // already closed/errored
        }
        await persistAndPrune();
      }
    },
    // Client walked away (tab closed / navigation): stop pulling from Groq so
    // the upstream connection is freed immediately; partial text still persists
    // via the reader loop's finally block.
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
