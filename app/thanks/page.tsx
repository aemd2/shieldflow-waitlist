import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Mail, ArrowLeft, Sparkles } from "lucide-react";

export const metadata: Metadata = {
  title: "You're in! — ShieldFlow",
  description: "Thanks for joining the ShieldFlow waitlist.",
};

export default function ThanksPage() {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-6"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:32px_32px]" />
      <div className="relative w-full max-w-xl text-center text-white">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[var(--brand-emerald)]/20 ring-8 ring-[var(--brand-emerald)]/10">
          <CheckCircle2 className="h-12 w-12 text-[var(--brand-emerald-bright)]" strokeWidth={2.2} />
        </div>

        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--brand-emerald)]/30 bg-[var(--brand-emerald)]/10 px-3 py-1 text-xs font-medium text-[var(--brand-emerald-bright)]">
          <Sparkles className="h-3.5 w-3.5" />
          40% lifetime discount reserved
        </div>

        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">You&rsquo;re in!</h1>
        <p className="mt-4 text-lg text-white/70">
          Check your email for early access details. We&rsquo;ll be in touch as we open up spots —
          founding members get first access in August 2026.
        </p>

        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-white/60">
          <Mail className="h-4 w-4" />
          Add aemd2donchev@gmail.com to your contacts so you don&rsquo;t miss a thing.
        </div>

        <Link
          href="/"
          className="mt-10 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
