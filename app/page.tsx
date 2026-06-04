"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ShieldCheck,
  Sparkles,
  Check,
  ArrowRight,
  Clock,
  AlertTriangle,
  X,
  Plus,
  Minus,
} from "lucide-react";

export default function Page() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "landing" }),
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

  const stack = [
    { item: "Full GRC platform (50+ frameworks: SOC 2, ISO 27001, GDPR, HIPAA…)", value: "$40,000/yr" },
    { item: "Predictive Risk AI (spots issues before auditors do)", value: "$18,000/yr" },
    { item: "Automated evidence collection + 200+ integrations", value: "$12,000/yr" },
    { item: "Privacy suite — consent, DSARs, data mapping", value: "$15,000/yr" },
    { item: "Vendor risk management (unlimited vendors)", value: "$9,000/yr" },
    { item: "AI Co-Pilot — ask 'Am I SOC 2 ready?' get an answer", value: "$6,000/yr" },
    { item: "One-click auditor-ready reports", value: "$4,000/yr" },
    { item: "White-glove onboarding with a real human", value: "$5,000" },
    { item: "Private founder Slack with the team", value: "Priceless" },
  ];

  const faqs = [
    {
      q: "How can you possibly be 80% cheaper than Vanta and OneTrust?",
      a: "Two reasons. (1) We built it AI-native from day one — no legacy code, no 200-person sales team to feed. (2) We don't do 6-month enterprise sales cycles. You sign up, you're in. We pass those savings to you. The product is the same or better — we proved that with side-by-side audits.",
    },
    {
      q: "Is this actually ready? Or am I waitlisting vaporware?",
      a: "The platform is live and running real audits. The waitlist exists because we're capping the first cohort at 100 to keep onboarding white-glove. You'll see the product before you pay a cent.",
    },
    {
      q: "What if my auditor doesn't accept it?",
      a: "Every framework we support is auditor-validated. If your auditor (Big 4 or otherwise) won't accept our evidence, we get on a call with them ourselves. If they still won't budge, you get a full refund. That's the deal.",
    },
    {
      q: "What happens if I don't join the waitlist now?",
      a: "Public launch pricing starts at $18k/yr. Founding members lock in $7k/yr for life. After the first 100 spots, that gate closes — permanently.",
    },
    {
      q: "Do I have to pay to join the waitlist?",
      a: "No. Joining is free. We'll send you early access and your 40% lifetime discount code when your spot opens.",
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {/* Nav */}
      <header className="absolute top-0 z-20 w-full">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--brand-emerald)] text-[var(--brand-navy-deep)]">
              <ShieldCheck className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <span className="text-lg font-semibold tracking-tight">ShieldFlow</span>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 backdrop-blur sm:flex">
            <Sparkles className="h-3.5 w-3.5 text-[var(--brand-emerald)]" />
            Powered by AI
          </div>
        </div>
      </header>

      {/* HERO */}
      <section
        className="relative overflow-hidden pb-20 pt-32 sm:pt-40"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:32px_32px]" />
        <div className="relative mx-auto max-w-5xl px-6 text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[var(--brand-emerald)]/30 bg-[var(--brand-emerald)]/10 px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-[var(--brand-emerald-bright)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--brand-emerald)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--brand-emerald)]" />
            </span>
            For SaaS &amp; Fintech founders — Only 40 spots left
          </div>

          <h1 className="mx-auto mt-6 max-w-4xl text-5xl font-black leading-[1.0] tracking-tight text-white sm:text-6xl md:text-7xl">
            Get SOC 2, ISO 27001 &amp; GDPR{" "}
            <span className="bg-gradient-to-r from-[var(--brand-emerald-bright)] to-emerald-300 bg-clip-text text-transparent">
              done for you
            </span>{" "}
            — for 80% less than Vanta.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-white/75 sm:text-xl">
            Stop paying $40k–$80k a year for compliance software your team barely uses.
            ShieldFlow gets you audit-ready in 30 days — for <span className="font-bold text-white">$7k/yr, locked in for life</span>.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4">
            <a
              href="#waitlist"
              className="group inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-bold text-[var(--brand-navy-deep)] shadow-[var(--shadow-glow)] transition-all hover:scale-[1.03] sm:text-lg"
              style={{ background: "var(--gradient-accent)" }}
            >
              Claim My Founding Spot (40% Off For Life)
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </a>
            <p className="flex items-center gap-2 text-sm text-white/60">
              <Clock className="h-4 w-4" />
              60+ founders already in • Free to join • Closes at 100
            </p>
          </div>

          <div className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "OneTrust", price: "$80,000/yr", strike: true },
              { label: "Vanta", price: "$40,000/yr", strike: true },
              { label: "Drata", price: "$35,000/yr", strike: true },
              { label: "ShieldFlow", price: "$7,000/yr", highlight: true },
            ].map((p, i) => (
              <div
                key={i}
                className={`rounded-xl border p-4 backdrop-blur ${
                  p.highlight
                    ? "border-[var(--brand-emerald)] bg-[var(--brand-emerald)]/10"
                    : "border-white/10 bg-white/5"
                }`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
                  {p.label}
                </div>
                <div
                  className={`mt-1 text-base font-bold sm:text-lg ${
                    p.highlight
                      ? "text-[var(--brand-emerald-bright)]"
                      : "text-white/80 line-through"
                  }`}
                >
                  {p.price}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="border-y border-border bg-background py-20">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-[var(--brand-emerald)]">
            Let&rsquo;s be honest
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
            You&rsquo;re getting robbed by your GRC tool.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            $40,000/yr for a glorified checklist with a Slack bot. Endless onboarding.
            Account managers who disappear after renewal. Predictable price hikes every year.
          </p>
          <p className="mt-4 text-lg font-semibold text-foreground">
            We built ShieldFlow because we got tired of paying that bill ourselves.
          </p>
        </div>
      </section>

      {/* GRAND SLAM OFFER */}
      <section className="bg-[var(--brand-navy-deep)] py-24 text-white">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-widest text-[var(--brand-emerald-bright)]">
              Here&rsquo;s everything you get
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
              The Founding Member Stack
            </h2>
            <p className="mt-4 text-white/70">
              Worth $109,000/yr at list price. Your founding price: $7,000/yr — for life.
            </p>
          </div>

          <div className="mt-12 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-[var(--shadow-elegant)]">
            <ul className="divide-y divide-white/10">
              {stack.map((s, i) => (
                <li key={i} className="flex items-start gap-4 px-6 py-5 sm:items-center sm:px-8">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-emerald)]/15 text-[var(--brand-emerald-bright)] sm:mt-0">
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </div>
                  <div className="flex-1 text-sm sm:text-base">{s.item}</div>
                  <div className="shrink-0 text-right text-sm font-semibold text-white/60 sm:text-base">
                    <span className="line-through">{s.value}</span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="border-t-2 border-[var(--brand-emerald)]/40 bg-[var(--brand-navy)] px-6 py-6 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-3 text-base sm:text-lg">
                <span className="font-semibold text-white/80">Total real-world value:</span>
                <span className="font-bold text-white/60 line-through">$109,000/yr</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xl font-bold sm:text-2xl">Your founding price:</span>
                <span className="text-3xl font-black text-[var(--brand-emerald-bright)] sm:text-4xl">
                  $7,000/yr
                </span>
              </div>
              <p className="mt-3 text-sm text-white/60">
                That&rsquo;s <span className="font-semibold text-white">$102,000 in savings</span> — locked in for life,
                even when we 3x our prices.
              </p>
            </div>
          </div>

          <div className="mt-10 text-center">
            <a
              href="#waitlist"
              className="inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-bold text-[var(--brand-navy-deep)] shadow-[var(--shadow-glow)] transition-all hover:scale-[1.03] sm:text-lg"
              style={{ background: "var(--gradient-accent)" }}
            >
              I want the founding deal
              <ArrowRight className="h-5 w-5" />
            </a>
          </div>
        </div>
      </section>

      {/* COMPARISON */}
      <section className="bg-background py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">
              ShieldFlow vs. The $40k Incumbents
            </h2>
          </div>
          <div className="mt-12 overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-left text-sm sm:text-base">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="px-4 py-4 font-semibold sm:px-6">Feature</th>
                  <th className="px-4 py-4 font-semibold sm:px-6">Vanta / Drata / OneTrust</th>
                  <th className="px-4 py-4 font-semibold text-[var(--brand-emerald)] sm:px-6">
                    ShieldFlow
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["Annual cost", "$35k–$80k", "$7k (locked for life)"],
                  ["AI-native architecture", "Bolt-on chatbot", "Built-in from day one"],
                  ["Predictive risk forecasting", "No", "Yes"],
                  ["Onboarding time", "6–10 weeks", "7 days"],
                  ["Hidden price hikes at renewal", "Yes (15–30%/yr)", "Never. Locked."],
                  ["Real human onboarding", "Add-on ($$$)", "Included"],
                ].map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-secondary/20"}>
                    <td className="px-4 py-4 font-medium sm:px-6">{row[0]}</td>
                    <td className="px-4 py-4 text-muted-foreground sm:px-6">
                      <span className="inline-flex items-center gap-2">
                        <X className="h-4 w-4 text-destructive" /> {row[1]}
                      </span>
                    </td>
                    <td className="px-4 py-4 font-semibold sm:px-6">
                      <span className="inline-flex items-center gap-2">
                        <Check className="h-4 w-4 text-[var(--brand-emerald)]" /> {row[2]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* GUARANTEE */}
      <section className="bg-secondary/40 py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--brand-emerald)]/15 text-[var(--brand-emerald)]">
            <ShieldCheck className="h-9 w-9" strokeWidth={2} />
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight sm:text-5xl">
            The &ldquo;Pass Your Audit Or Don&rsquo;t Pay&rdquo; Guarantee
          </h2>
          <p className="mt-6 text-lg text-muted-foreground">
            Use ShieldFlow for 12 months. If you don&rsquo;t pass your audit — or if your auditor
            rejects our evidence — we refund <span className="font-bold text-foreground">100% of what you paid</span>.
            No forms. No &ldquo;win-back&rdquo; calls. We wire it back the same day.
          </p>
          <p className="mt-4 text-base font-semibold text-foreground">
            You take zero risk. We take all of it. That&rsquo;s how confident we are.
          </p>
        </div>
      </section>

      {/* FOUNDER NOTE */}
      <section className="bg-background py-24">
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-sm font-bold uppercase tracking-widest text-[var(--brand-emerald)]">
            A note from the founders
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Why we&rsquo;re capping the first 100.
          </h2>
          <div className="mt-6 space-y-4 text-lg leading-relaxed text-muted-foreground">
            <p>
              We&rsquo;re a small team of ex-compliance operators. We&rsquo;ve personally written the checks
              for OneTrust and Vanta — and watched them deliver less every year.
            </p>
            <p>
              So we built the thing we wished existed. AI-native. Honest pricing. No 6-month
              implementation theater.
            </p>
            <p>
              We&rsquo;re capping the first cohort at <span className="font-semibold text-foreground">100 founders</span> because
              we want to onboard each one personally. After that, prices go up and the line gets longer.
            </p>
            <p className="text-foreground">
              If you&rsquo;re tired of getting squeezed, get in now. — <span className="font-semibold">The ShieldFlow team</span>
            </p>
          </div>
        </div>
      </section>

      {/* URGENCY STRIP */}
      <section className="bg-[var(--brand-navy-deep)] py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-2 px-6 text-center text-white sm:flex-row sm:gap-6">
          <AlertTriangle className="h-5 w-5 text-[var(--brand-emerald-bright)]" />
          <p className="text-sm font-medium sm:text-base">
            <span className="font-bold">60 of 100 spots claimed.</span> Founding pricing closes at 100 — no extensions.
          </p>
        </div>
      </section>

      {/* WAITLIST FORM */}
      <section id="waitlist" className="bg-background py-24">
        <div className="mx-auto max-w-xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">
              Claim Your Founding Spot
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              One field. 10 seconds. Lock in <span className="font-bold text-foreground">$7k/yr for life</span>.
            </p>
          </div>

          <form
            onSubmit={submit}
            className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-elegant)] sm:p-8"
          >
            <label className="block text-sm font-semibold text-foreground" htmlFor="waitlist-email">
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
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-4 text-base outline-none transition focus:border-[var(--brand-emerald)] focus:ring-4 focus:ring-[var(--brand-emerald)]/15"
            />

            <button
              type="submit"
              disabled={loading}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 text-base font-bold text-[var(--brand-navy-deep)] shadow-[var(--shadow-glow)] transition-all hover:scale-[1.01] disabled:opacity-70 sm:text-lg"
              style={{ background: "var(--gradient-accent)" }}
            >
              {loading ? "Reserving your spot…" : "Lock In 40% Off For Life →"}
            </button>

            {error && (
              <p className="mt-3 text-sm text-destructive">{error}</p>
            )}

            <div className="mt-5 grid grid-cols-3 gap-3 text-center text-xs text-muted-foreground">
              <div className="flex flex-col items-center gap-1">
                <Check className="h-4 w-4 text-[var(--brand-emerald)]" />
                Free to join
              </div>
              <div className="flex flex-col items-center gap-1">
                <Check className="h-4 w-4 text-[var(--brand-emerald)]" />
                No credit card
              </div>
              <div className="flex flex-col items-center gap-1">
                <Check className="h-4 w-4 text-[var(--brand-emerald)]" />
                Cancel anytime
              </div>
            </div>
          </form>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-secondary/40 py-24">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-5xl">
            Questions you&rsquo;re probably asking.
          </h2>
          <div className="mt-12 space-y-3">
            {faqs.map((f, i) => {
              const open = openFaq === i;
              return (
                <div
                  key={i}
                  className="overflow-hidden rounded-2xl border border-border bg-card"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                  >
                    <span className="text-base font-semibold sm:text-lg">{f.q}</span>
                    {open ? (
                      <Minus className="h-5 w-5 shrink-0 text-[var(--brand-emerald)]" />
                    ) : (
                      <Plus className="h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                  {open && (
                    <div className="px-6 pb-6 text-base leading-relaxed text-muted-foreground">
                      {f.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section
        className="relative overflow-hidden py-24 text-white"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:32px_32px]" />
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-4xl font-black tracking-tight sm:text-6xl">
            Two roads. Pick one.
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-left">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/50">Road 1</p>
              <p className="mt-3 text-lg font-semibold">
                Keep paying $40k+/yr. Watch your renewal go up 20% again.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--brand-emerald)]/50 bg-[var(--brand-emerald)]/10 p-6 text-left">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--brand-emerald-bright)]">Road 2</p>
              <p className="mt-3 text-lg font-semibold">
                Lock in $7k/yr for life. Get a better product. Sleep at night.
              </p>
            </div>
          </div>
          <a
            href="#waitlist"
            className="mt-10 inline-flex items-center gap-2 rounded-full px-10 py-5 text-lg font-bold text-[var(--brand-navy-deep)] shadow-[var(--shadow-glow)] transition-all hover:scale-[1.03]"
            style={{ background: "var(--gradient-accent)" }}
          >
            Take Road 2 — Claim My Spot
            <ArrowRight className="h-5 w-5" />
          </a>
          <p className="mt-4 text-sm text-white/60">40 spots left. Free to join.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-background py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--brand-navy)] text-[var(--brand-emerald-bright)]">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">ShieldFlow</span>
            <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3 w-3 text-[var(--brand-emerald)]" /> Powered by AI
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Join <span className="font-semibold text-foreground">60+ founders</span> already on the
            waitlist
          </p>
          <div className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/privacy" className="hover:text-foreground">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
