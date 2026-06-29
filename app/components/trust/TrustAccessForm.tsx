"use client";

import { useState } from "react";

// Public, anonymous lead-capture form on the Trust Center page. Self-contained
// (the public page has no ToastProvider) — it shows its own inline status.
export function TrustAccessForm({ slug }: { slug: string }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [note, setNote] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/trust-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, email, name, company, message, website }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState("error");
        setNote(data.error ?? "Something went wrong.");
        return;
      }
      setState("done");
      setNote(data.message ?? "Thanks — we'll be in touch.");
    } catch {
      setState("error");
      setNote("Network error. Please try again.");
    }
  }

  if (state === "done") {
    return (
      <div className="card border-[var(--brand-emerald)]/40 bg-emerald-50 text-sm text-emerald-800">
        {note}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Work email *"
          className="input"
          maxLength={254}
        />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="input" maxLength={160} />
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" className="input" maxLength={160} />
        <input
          // Honeypot — hidden from humans; bots fill it and we silently drop them.
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          className="hidden"
          aria-hidden
        />
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What are you looking for? (SOC 2 report, DPA, security review…)"
        rows={3}
        className="input"
        maxLength={2000}
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "sending"} className="btn-primary">
          {state === "sending" ? "Sending…" : "Request access"}
        </button>
        {state === "error" && <span className="text-sm text-destructive">{note}</span>}
      </div>
    </form>
  );
}
