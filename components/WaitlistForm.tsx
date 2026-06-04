"use client";

import { useState } from "react";
import { COMPANY_SIZES } from "@/lib/validation";

type Status = "idle" | "submitting" | "success" | "error";

export function WaitlistForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      email: String(data.get("email") ?? ""),
      companyName: String(data.get("companyName") ?? ""),
      companySize: String(data.get("companySize") ?? "") || undefined,
      painPoint: String(data.get("painPoint") ?? ""),
      website: String(data.get("website") ?? ""),
    };
    setStatus("submitting");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setMessage(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      setStatus("success");
      setMessage(body.message ?? "You're on the list. We'll be in touch.");
      form.reset();
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="grid gap-4">
        <Field label="Work email" htmlFor="email" required>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className="input"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" htmlFor="companyName">
            <input
              id="companyName"
              name="companyName"
              type="text"
              placeholder="Acme Inc."
              className="input"
            />
          </Field>
          <Field label="Team size" htmlFor="companySize">
            <select id="companySize" name="companySize" defaultValue="" className="input">
              <option value="" disabled>
                Select…
              </option>
              {COMPANY_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} people
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Biggest compliance pain right now? (optional)"
          htmlFor="painPoint"
        >
          <textarea
            id="painPoint"
            name="painPoint"
            rows={3}
            placeholder="e.g. Vanta quote is $42K, renewing in Q3 and we can't justify it."
            className="input"
          />
        </Field>
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          className="hidden"
          aria-hidden="true"
        />
        <button
          type="submit"
          className="btn-primary mt-2 w-full"
          disabled={status === "submitting"}
        >
          {status === "submitting" ? "Joining…" : "Join the waitlist"}
        </button>
        {status === "success" && (
          <p className="text-sm text-green-700">{message}</p>
        )}
        {status === "error" && (
          <p className="text-sm text-red-600">{message}</p>
        )}
      </div>
      <style>{`.input { width: 100%; border-radius: 0.5rem; border: 1px solid rgb(226 232 240); padding: 0.625rem 0.75rem; font-size: 0.95rem; background: white; }
.input:focus { outline: 2px solid rgb(79 124 255 / 0.4); outline-offset: 1px; border-color: rgb(79 124 255); }`}</style>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-accent">*</span>}
      </span>
      {children}
    </label>
  );
}
