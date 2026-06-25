"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Markdown } from "@/components/ui/Markdown";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Which controls are still not started?",
  "What should I prioritize this week?",
  "Summarize our compliance posture.",
];

export function Chat({
  initialMessages,
  aiEnabled,
}: {
  initialMessages: Msg[];
  aiEnabled: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  // Abort an in-flight stream if the user navigates away.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || streaming) return;

    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        // 401 mid-session = logged out in another tab; send them back to login.
        if (res.status === 401) {
          window.location.href = "/login?reason=expired";
          return;
        }
        setError(data.error ?? "The co-pilot is unavailable right now.");
        setMessages((m) => m.slice(0, -1)); // drop the empty assistant bubble
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
      if (!acc.trim()) {
        setMessages((m) => m.slice(0, -1));
        setError("Empty response. Please try again.");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError("Network error. Please try again.");
        setMessages((m) => m.slice(0, -1));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">Ask the Co-Pilot anything about your compliance.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={!aiEnabled}
                  className="btn-outline text-xs"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-4 py-2 ${
                m.role === "user"
                  ? "bg-[var(--brand-navy)] text-white"
                  : "border border-border bg-background"
              }`}
            >
              {m.role === "assistant" ? (
                m.content ? (
                  <Markdown content={m.content} />
                ) : (
                  <span className="text-sm text-muted-foreground">Thinking…</span>
                )
              ) : (
                <span className="whitespace-pre-wrap text-sm">{m.content}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={aiEnabled ? "Ask a question…" : "AI not configured"}
          disabled={!aiEnabled || streaming}
          maxLength={2000}
          className="input flex-1"
        />
        <button type="submit" disabled={!aiEnabled || streaming || !input.trim()} className="btn-primary">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
