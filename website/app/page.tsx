import Link from "next/link";
import {
  ShieldCheck,
  Sparkles,
  ArrowRight,
  Check,
  X,
  Boxes,
  Activity,
  Bot,
  FileText,
  Users,
  Globe,
  Plug,
  Eye,
  FileCheck,
} from "lucide-react";
import { WaitlistForm } from "@/components/marketing/WaitlistForm";
import { Faq } from "@/components/marketing/Faq";
import { LOGIN_URL } from "@/lib/site";

const NAV = [
  { label: "Product", href: "#product" },
  { label: "How it works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

const FEATURES = [
  {
    icon: Boxes,
    title: "Automated evidence collection",
    body: "Connect Google Workspace, GitHub, AWS, Okta and six more. ShieldFlow pulls security evidence on a schedule — no more screenshots in a folder.",
  },
  {
    icon: Activity,
    title: "Continuous control monitoring",
    body: "Every connected system is checked against your controls. Drift raises an alert before your auditor ever finds it.",
  },
  {
    icon: Bot,
    title: "AI Compliance Co-Pilot",
    body: "Ask “Am I SOC 2 ready?” and get a straight answer drawn from your live control data — not a generic chatbot.",
  },
  {
    icon: FileText,
    title: "AI Policy Generator",
    body: "Generate auditor-ready policies tailored to your company in seconds, then edit, version, and publish them.",
  },
  {
    icon: Users,
    title: "Vendor & risk management",
    body: "Track vendors, score risk, run your risk register and staff training — all in one workspace.",
  },
  {
    icon: Globe,
    title: "Public Trust Center",
    body: "Publish a live security page that updates from your real posture, so security reviews stop stalling your deals.",
  },
];

const STEPS = [
  {
    icon: Plug,
    title: "Connect your stack",
    body: "Link your identity, cloud, and source-control tools in a few clicks.",
  },
  {
    icon: Eye,
    title: "We collect & monitor",
    body: "ShieldFlow gathers evidence, maps it to controls, and watches for drift around the clock.",
  },
  {
    icon: FileCheck,
    title: "Stay audit-ready",
    body: "Generate policies, export a one-click audit report, and walk into your audit calm.",
  },
];

const FRAMEWORKS = ["SOC 2", "ISO 27001", "HIPAA", "GDPR", "PCI DSS"];

const STACK = ["Google Workspace", "GitHub", "AWS", "Okta", "Slack", "GitLab", "Jira", "Cloudflare"];

const PRICE_CARDS = [
  { label: "OneTrust", price: "$80k/yr", strike: true },
  { label: "Vanta", price: "$40k/yr", strike: true },
  { label: "Drata", price: "$35k/yr", strike: true },
  { label: "ShieldFlow", price: "$7k/yr", highlight: true },
];

const COMPARISON: [string, string, string][] = [
  ["Annual cost", "$35k–$80k", "$7k — locked for life"],
  ["AI-native architecture", "Bolt-on chatbot", "Built in from day one"],
  ["Continuous monitoring", "Add-on tiers", "Included"],
  ["Onboarding time", "6–10 weeks", "Days"],
  ["Price hikes at renewal", "15–30% per year", "Never — locked"],
  ["Real human onboarding", "Paid add-on", "Included"],
];

const STACK_VALUE = [
  "Full GRC platform — SOC 2, ISO 27001, HIPAA, GDPR, PCI DSS",
  "Automated evidence collection across 10 integrations",
  "Continuous control monitoring with predictive alerts",
  "AI Co-Pilot + AI policy generation",
  "Vendor risk, risk register, and training tracker",
  "Public Trust Center + one-click audit reports",
  "White-glove onboarding with a real human",
];

export default function Page() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />

      {/* HERO */}
      <section className="relative overflow-hidden" style={{ background: "var(--gradient-hero)" }}>
        <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:32px_32px]" />
        <div className="relative mx-auto max-w-5xl px-6 pb-20 pt-28 text-center sm:pt-36">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[var(--brand-emerald)]/30 bg-[var(--brand-emerald)]/10 px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-[var(--brand-emerald-bright)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--brand-emerald)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--brand-emerald)]" />
            </span>
            Founding cohort — limited spots
          </div>

          <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl">
            Compliance, done for you —{" "}
            <span className="bg-gradient-to-r from-[var(--brand-emerald-bright)] to-emerald-200 bg-clip-text text-transparent">
              for 80% less than Vanta
            </span>
            .
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-white/70 sm:text-xl">
            ShieldFlow is the AI-native GRC platform that collects your evidence, monitors your
            controls, and gets you SOC 2, ISO 27001, GDPR, HIPAA &amp; PCI ready — in days, not
            quarters.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#waitlist" className="btn-accent h-12 px-7 text-base font-semibold">
              Claim my founding spot
              <ArrowRight className="ml-2 h-5 w-5" />
            </a>
            <a
              href={LOGIN_URL}
              className="btn h-12 border border-white/20 px-7 text-base font-medium text-white hover:bg-white/10"
            >
              Log in
            </a>
          </div>

          {/* Price comparison */}
          <div className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {PRICE_CARDS.map((p) => (
              <div
                key={p.label}
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
                  className={`mt-1 text-lg font-bold ${
                    p.highlight ? "text-[var(--brand-emerald-bright)]" : "text-white/70 line-through"
                  }`}
                >
                  {p.price}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STACK STRIP */}
      <section className="border-b border-border bg-secondary/40">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Collects evidence from the tools you already use
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            {STACK.map((s) => (
              <span
                key={s}
                className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-foreground/80"
              >
                {s}
              </span>
            ))}
            <span className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-muted-foreground">
              +2 more
            </span>
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="bg-background py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <SectionLabel>Let&rsquo;s be honest</SectionLabel>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            You&rsquo;re overpaying for a glorified checklist.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            $40,000 a year for software your team barely opens. Months of onboarding. Account
            managers who vanish after renewal, then a price hike anyway. We built ShieldFlow because
            we got tired of paying that bill ourselves.
          </p>
        </div>
      </section>

      {/* PRODUCT / FEATURES */}
      <section id="product" className="border-y border-border bg-secondary/30 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <SectionLabel>The platform</SectionLabel>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Everything you need to get — and stay — compliant.
            </h2>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--brand-emerald)]/12 text-[var(--brand-emerald)]">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="bg-background py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <SectionLabel>How it works</SectionLabel>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Audit-ready in three steps.
            </h2>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="card relative">
                <span className="absolute right-5 top-5 text-3xl font-bold text-border">
                  {i + 1}
                </span>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--brand-navy)]/8 text-[var(--brand-navy)]">
                  <s.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>

          {/* Frameworks */}
          <div className="mt-12 flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground">One workspace, five frameworks — mapped and cross-walked.</p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {FRAMEWORKS.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground"
                >
                  <ShieldCheck className="h-4 w-4 text-[var(--brand-emerald)]" />
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PRICING / FOUNDER OFFER */}
      <section id="pricing" className="border-y border-border bg-secondary/30 py-20">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center">
            <SectionLabel>Founding-member pricing</SectionLabel>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Lock in $7k/yr — for life.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Worth over $100k a year at incumbent list prices. Founding members keep this rate even
              when we raise prices later.
            </p>
          </div>

          <div className="mt-10 overflow-hidden rounded-2xl border-2 border-[var(--brand-emerald)]/40 bg-card shadow-[var(--shadow-lg)]">
            <div className="border-b border-border bg-[var(--brand-navy)] px-6 py-6 text-white sm:px-8">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-widest text-[var(--brand-emerald-bright)]">
                    Founding member
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-4xl font-bold">$7,000</span>
                    <span className="text-white/60">/ year, locked for life</span>
                  </div>
                </div>
                <div className="text-right text-sm text-white/50">
                  <div className="line-through">$109,000/yr value</div>
                  <div className="font-semibold text-[var(--brand-emerald-bright)]">$102k saved</div>
                </div>
              </div>
            </div>
            <ul className="divide-y divide-border">
              {STACK_VALUE.map((item) => (
                <li key={item} className="flex items-start gap-3 px-6 py-3.5 text-sm sm:px-8">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-emerald)]" strokeWidth={3} />
                  <span className="text-foreground">{item}</span>
                </li>
              ))}
            </ul>
            <div className="px-6 py-6 sm:px-8">
              <a href="#waitlist" className="btn-accent h-12 w-full text-base font-semibold">
                Claim my founding spot
                <ArrowRight className="ml-2 h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARISON */}
      <section className="bg-background py-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <SectionLabel>The honest comparison</SectionLabel>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              ShieldFlow vs. the $40k incumbents.
            </h2>
          </div>
          <div className="mt-10 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/60">
                <tr>
                  <th className="px-4 py-3.5 font-semibold sm:px-6">Feature</th>
                  <th className="px-4 py-3.5 font-semibold text-muted-foreground sm:px-6">
                    Vanta / Drata / OneTrust
                  </th>
                  <th className="px-4 py-3.5 font-semibold text-[var(--brand-emerald)] sm:px-6">
                    ShieldFlow
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {COMPARISON.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-card" : "bg-secondary/20"}>
                    <td className="px-4 py-3.5 font-medium text-foreground sm:px-6">{row[0]}</td>
                    <td className="px-4 py-3.5 text-muted-foreground sm:px-6">
                      <span className="inline-flex items-center gap-2">
                        <X className="h-4 w-4 shrink-0 text-destructive" /> {row[1]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-medium text-foreground sm:px-6">
                      <span className="inline-flex items-center gap-2">
                        <Check className="h-4 w-4 shrink-0 text-[var(--brand-emerald)]" /> {row[2]}
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
      <section className="border-y border-border bg-secondary/30 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-emerald)]/12 text-[var(--brand-emerald)]">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h2 className="mt-6 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Pass your audit, or don&rsquo;t pay.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Use ShieldFlow for twelve months. If you don&rsquo;t pass your audit — or your auditor
            won&rsquo;t accept our evidence — we refund every cent. You take zero risk. We take all
            of it.
          </p>
        </div>
      </section>

      {/* WAITLIST */}
      <section id="waitlist" className="bg-background py-20">
        <div className="mx-auto max-w-xl px-6">
          <div className="text-center">
            <SectionLabel>Claim your spot</SectionLabel>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Join the founding cohort.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Free to join. We&rsquo;ll email you when your early-access spot opens.
            </p>
          </div>
          <div className="card mt-8 p-6 sm:p-7">
            <WaitlistForm />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-border bg-secondary/30 py-20">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center">
            <SectionLabel>FAQ</SectionLabel>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Questions, answered.
            </h2>
          </div>
          <div className="mt-10">
            <Faq />
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

function SiteNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--brand-emerald)] text-[var(--brand-navy-deep)]">
            <ShieldCheck className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="text-lg font-semibold tracking-tight text-foreground">ShieldFlow</span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="text-sm text-muted-foreground hover:text-foreground">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a href={LOGIN_URL} className="hidden text-sm font-medium text-foreground hover:opacity-70 sm:inline">
            Log in
          </a>
          <a href="#waitlist" className="btn-accent h-9 px-4 font-medium">
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 px-6 sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--brand-navy)] text-[var(--brand-emerald-bright)]">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">ShieldFlow</span>
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3 w-3 text-[var(--brand-emerald)]" /> AI-native GRC
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <a href={LOGIN_URL} className="hover:text-foreground">Log in</a>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/privacy" className="hover:text-foreground">Terms</Link>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} ShieldFlow</p>
      </div>
    </footer>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--brand-emerald)]">
      {children}
    </p>
  );
}
