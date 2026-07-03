"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function WaitlistForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  // Honeypot — bots fill it, humans never see it.
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, companyName: company, source: "landing", website }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      router.push("/thanks");
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left">
      <div
        className="absolute left-[-9999px]"
        aria-hidden="true"
        tabIndex={-1}
      >
        <label htmlFor="company-website">Leave this empty</label>
        <input
          id="company-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="waitlist-email" className="mb-1.5 block text-sm font-medium text-foreground">
            Work email
          </label>
          <input
            id="waitlist-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="input h-11"
          />
        </div>
        <div>
          <label htmlFor="waitlist-company" className="mb-1.5 block text-sm font-medium text-foreground">
            Company <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="waitlist-company"
            type="text"
            autoComplete="organization"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Acme Inc."
            className="input h-11"
          />
        </div>
      </div>

      <Button type="submit" variant="accent" disabled={loading} fullWidth className="h-11 text-base font-semibold">
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reserving your spot…
          </>
        ) : (
          "Claim my founding spot →"
        )}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-[var(--brand-emerald)]" /> Free to join
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-[var(--brand-emerald)]" /> No credit card
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-[var(--brand-emerald)]" /> 10 seconds
        </span>
      </div>
    </form>
  );
}
