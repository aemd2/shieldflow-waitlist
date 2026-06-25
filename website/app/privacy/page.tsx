import Link from "next/link";
import type { Metadata } from "next";
import { ShieldCheck, ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy — ShieldFlow",
  description: "How ShieldFlow handles information submitted through the waitlist.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--brand-emerald)] text-[var(--brand-navy-deep)]">
              <ShieldCheck className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="text-lg font-semibold tracking-tight text-foreground">ShieldFlow</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Privacy</h1>
        <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
          <p>
            ShieldFlow collects only the information you submit through the waitlist form — your
            email and, optionally, your company name, company size, and a short note about what
            you&rsquo;re trying to solve.
          </p>
          <p>
            We use it to contact you about early access and to understand which problems matter most
            to the teams we&rsquo;re building for. We do not sell your data or share it with third
            parties for advertising.
          </p>
          <p>
            To be removed from the list at any time, email{" "}
            <a
              className="font-medium text-[var(--brand-emerald)] hover:underline"
              href="mailto:aemd2donchev@gmail.com"
            >
              aemd2donchev@gmail.com
            </a>{" "}
            and we&rsquo;ll delete your record.
          </p>
        </div>

        <Link
          href="/"
          className="mt-10 inline-flex items-center gap-2 text-sm font-medium text-foreground hover:opacity-70"
        >
          <ArrowLeft className="h-4 w-4" />
          Back home
        </Link>
      </main>
    </div>
  );
}
