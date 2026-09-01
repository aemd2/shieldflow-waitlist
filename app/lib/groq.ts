// Server-side Groq wrapper. The API key is read here and NEVER exposed to the client.
// Centralizes the endpoint, timeout, and error mapping so both AI routes behave the same.

/**
 * The chat model, overridable without a code change.
 *
 * Groq retires models with little notice: `llama-3.3-70b-versatile`, which this
 * used to hardcode, was deprecated on 2026-06-17 and removed from the catalogue,
 * and every AI feature started failing against a model that no longer existed.
 * Setting GROQ_MODEL in the environment is the fast fix next time; changing the
 * default here is the considered one.
 *
 * `openai/gpt-oss-120b` is Groq's own recommended replacement for the 70B Llama
 * and the largest general model they serve (120B, 131k context) — a step up from
 * what we had, not a step down.
 *
 * It is a REASONING model, which is why REASONING_FORMAT below is not optional.
 * Verified against the live API:
 *   - default / "parsed": reasoning goes to a separate `reasoning` delta and
 *     `content` stays empty until it finishes. Streaming showed nothing for the
 *     first 61 chunks, so the copilot would look frozen and then dump an answer.
 *   - "hidden": `content` starts at chunk 1 and reasoning never appears. This is
 *     what makes a reasoning model usable behind a streaming UI.
 *
 * Alternatives, if this one ever goes the same way:
 *   - `qwen/qwen3.8-27b` — smaller but genuinely non-reasoning, so it needs no
 *     special handling and is the safest emergency swap.
 *   - `qwen/qwen3.6-27b` — Groq lists it as a migration target, but it writes raw
 *     <think> blocks into `content`. Avoid unless reasoning_format is honoured.
 *   - `groq/compound` / `-mini` — decommissioned 2026-09-21. Do not use.
 */
export const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

/**
 * Strip reasoning from the response entirely. Harmless on non-reasoning models
 * (they ignore it), essential on reasoning ones — see the note above.
 */
const REASONING_FORMAT = "hidden";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 30_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Thrown for any AI failure; `status` drives the HTTP response + UI message. */
export class GroqError extends Error {
  constructor(
    public status: number,
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "GroqError";
  }
}

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

function mapStatus(status: number): string {
  if (status === 429) return "The AI is handling a lot of requests right now. Please try again in a moment.";
  if (status === 401 || status === 403) return "AI is misconfigured. Check the GROQ_API_KEY.";
  if (status >= 500) return "The AI service is temporarily unavailable. Please try again shortly.";
  return "The AI request failed. Please try again.";
}

interface GroqOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** Non-streaming completion → returns the assistant text. */
export async function groqComplete(
  messages: ChatMessage[],
  opts: GroqOptions = {},
): Promise<string> {
  if (!isGroqConfigured()) {
    throw new GroqError(503, "AI is not configured yet. Add a GROQ_API_KEY to enable it.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort());

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 4096,
        reasoning_format: REASONING_FORMAT,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new GroqError(res.status, mapStatus(res.status));
    }

    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
      throw new GroqError(502, "The AI returned an empty response. Please try again.");
    }
    return text;
  } catch (err) {
    if (err instanceof GroqError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new GroqError(504, "The AI took too long to respond. Please try again.");
    }
    throw new GroqError(502, "Could not reach the AI service. Please try again.");
  } finally {
    clearTimeout(timeout);
  }
}

/** Streaming completion → returns a fetch Response whose body is an SSE stream. */
export async function groqStream(
  messages: ChatMessage[],
  opts: GroqOptions = {},
): Promise<Response> {
  if (!isGroqConfigured()) {
    throw new GroqError(503, "AI is not configured yet. Add a GROQ_API_KEY to enable it.");
  }

  // Timeout covers connection + headers only; once the stream is flowing we
  // clear it (the route's maxDuration bounds the total stream time).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort());

  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 1024,
        reasoning_format: REASONING_FORMAT,
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      throw new GroqError(504, "The AI took too long to respond. Please try again.");
    }
    throw new GroqError(502, "Could not reach the AI service. Please try again.");
  }
  clearTimeout(timeout);

  if (!res.ok || !res.body) {
    throw new GroqError(res.status || 502, mapStatus(res.status || 502));
  }
  return res;
}
