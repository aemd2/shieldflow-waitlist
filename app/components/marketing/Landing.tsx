import Link from "next/link";
import {
  Check,
  X,
  Zap,
  Shield,
  ShieldCheck,
  Clock,
  AlertTriangle,
  ArrowRight,
  Star,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Faq } from "@/components/marketing/Faq";
import { LOGIN_URL, testimonials } from "@/lib/site";

// Founding-cohort scarcity. ← Set SPOTS_LEFT to the real number; it drives every
// "X of 40 spots left" badge on the page.
const COHORT_SIZE = 40;
const SPOTS_LEFT = 23;

export function Landing() {
  return (
    <div className="marketing-dark min-h-screen bg-background text-foreground antialiased">
      <Nav />
      <Hero />
      <SocialProof />
      <Problem />
      <Offer />
      <Comparison />
      <Features />
      <Guarantee />
      <Testimonials />
      <FAQSection />
      <FinalCTA />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark className="h-8 w-8" />
          <span className="text-lg font-black tracking-tight">ShieldFlow</span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-5">
          <a
            href={LOGIN_URL}
            className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:inline"
          >
            Log in
          </a>
          <a
            href={LOGIN_URL}
            className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:brightness-110"
          >
            Sign in &amp; claim your spot →
          </a>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <header className="relative overflow-hidden border-b border-border">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="relative mx-auto max-w-5xl px-6 pb-24 pt-20 text-center">
        <div className="mx-auto mb-8 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          Only {SPOTS_LEFT} of {COHORT_SIZE} Founding Spots Left
        </div>

        <h1 className="mx-auto max-w-4xl text-balance text-5xl font-black leading-[1.05] tracking-tighter md:text-7xl">
          Do The Work{" "}
          <span className="relative whitespace-nowrap">
            <span className="relative z-10 text-primary">Once</span>
            <span className="absolute inset-x-0 bottom-1 -z-0 h-4 bg-primary/20" />
          </span>
          .
          <br />
          Satisfy <span className="text-primary">All 8 Frameworks</span>.
        </h1>

        <p className="mx-auto mt-8 max-w-2xl text-pretty text-lg text-muted-foreground md:text-xl">
          <b className="text-foreground">328 requirements.</b>
          {" "}
          <b className="text-foreground">71 things to actually do.</b>
          <br className="hidden sm:block" />
          {"$7,000/year flat — and the price never moves."}
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href={LOGIN_URL}
            className="group relative inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-8 py-4 text-base font-bold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:scale-[1.02] sm:w-auto"
          >
            Sign in &amp; claim your spot
            <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" strokeWidth={3} />
          </a>
          <div className="text-xs text-muted-foreground">
            No credit card • 2-min signup • Cancel anytime
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
          <Stat icon={<Zap className="h-4 w-4 text-primary" />} label="Type I ready in 14 days" />
          <Stat icon={<ShieldCheck className="h-4 w-4 text-primary" />} label="Price locked for life" />
          <Stat icon={<Clock className="h-4 w-4 text-primary" />} label="$33,000 saved per year" />
        </div>
      </div>
    </header>
  );
}

function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="font-medium">{label}</span>
    </div>
  );
}

function SocialProof() {
  const frameworks = [
    "SOC 2",
    "ISO 27001",
    "NIS2",
    "DORA",
    "Cyber Resilience Act",
    "GDPR",
    "HIPAA",
    "PCI DSS",
  ];
  return (
    <section className="border-b border-border bg-[color:var(--navy-deep)] py-10">
      <div className="mx-auto max-w-7xl px-6">
        <p className="mb-6 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          Every Framework Your Auditor Will Ask For
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {frameworks.map((f) => (
            <span key={f} className="text-lg font-black text-muted-foreground/60">
              {f}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Problem() {
  const pains = [
    { num: "$40,000", label: "What Vanta or Drata costs you every year — before add-ons" },
    { num: "+40–100%", label: "The renewal jump founders hit in year two" },
    { num: "8×", label: "How many times you prove the same control, one framework at a time" },
  ];
  return (
    <section className="border-b border-border py-24">
      <div className="mx-auto max-w-5xl px-6 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-destructive">
          <AlertTriangle className="h-3 w-3" /> The Brutal Truth
        </div>
        <h2 className="text-balance text-4xl font-black tracking-tight md:text-5xl">
          You&rsquo;re paying Ferrari prices to do the same work{" "}
          <span className="text-destructive line-through">once</span> eight times.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Your SOC 2 asks for MFA. So does ISO 27001. So does NIS2, PCI DSS, HIPAA and DORA. You
          turn it on <b className="text-foreground">once</b> — and then spend a week proving it six
          separate times, in six separate places, to six separate checklists.
        </p>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {pains.map((p) => (
            <div key={p.num} className="rounded-2xl border border-border bg-card p-8 text-left">
              <div className="text-4xl font-black text-destructive">{p.num}</div>
              <div className="mt-2 text-sm text-muted-foreground">{p.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Offer() {
  const includes = [
    "All 8 frameworks included — not priced one at a time",
    "328 requirements pre-mapped onto 71 measures you actually do",
    "NIS2, DORA & Cyber Resilience Act — which Vanta and Drata don't cover",
    "Automated evidence from your cloud, identity and code, re-checked daily",
    "Drift alerts when a check starts failing — no waiting for the quarterly review",
    "AI-generated policies, approvals and employee acknowledgements",
    "Risk register, vendor risk, access reviews and personnel tracking",
    "Public Trust Center your sales team can send to any prospect",
    "The 14-Day Sprint — a finishable path, not a 300-item checklist",
    "No agent on your employees' laptops. Ever.",
    "Priced per company, never per headcount — grow without a price rise",
    "Lifetime price lock — $7,000/yr, for as long as you stay",
  ];
  return (
    <section className="border-b border-border bg-[color:var(--navy-deep)] py-24">
      <div className="mx-auto max-w-5xl px-6">
        <div className="text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">
            Here&rsquo;s What You Get
          </p>
          <h2 className="text-balance text-4xl font-black tracking-tight md:text-5xl">
            Eight frameworks. One workload.
            <br />
            <span className="text-primary">One flat price.</span>
          </h2>
        </div>

        <div className="mt-14 rounded-3xl border-2 border-primary/30 bg-card p-8 shadow-[var(--shadow-glow)] md:p-12">
          <div className="grid gap-4 md:grid-cols-2">
            {includes.map((item) => (
              <div key={item} className="flex items-start gap-3">
                <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary">
                  <Check className="h-4 w-4 text-primary-foreground" strokeWidth={4} />
                </div>
                <span className="text-base font-medium">{item}</span>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center gap-4 border-t border-border pt-8 sm:flex-row sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Total value
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-bold text-muted-foreground line-through">
                  $40,000/yr
                </span>
                <span className="text-4xl font-black text-primary">$7,000/yr</span>
              </div>
            </div>
            <a
              href={LOGIN_URL}
              className="w-full rounded-xl bg-primary px-8 py-4 text-center text-base font-bold text-primary-foreground transition hover:scale-[1.02] sm:w-auto"
            >
              Sign in &amp; claim your spot →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Comparison() {
  const rows: [string, string, string][] = [
    ["Annual cost", "$25k – $55k", "$7,000 flat"],
    ["Price at renewal", "Up 40 – 100%", "Locked. Forever."],
    ["Priced by headcount", "Yes — cross a band, price jumps", "No — per company"],
    ["Frameworks", "Priced one at a time", "All 8 included"],
    ["NIS2 · DORA · Cyber Resilience Act", "Not supported", "Native"],
    ["Agent on employee laptops", "Required", "None"],
    ["Data residency", "US-hosted", "EU-hosted"],
    ["Contract", "1 – 2 year lock-in", "Month to month"],
    ["Implementation fee", "$5k – $15k", "$0"],
  ];
  return (
    <section className="border-b border-border py-24">
      <div className="mx-auto max-w-5xl px-6">
        <div className="text-center">
          <h2 className="text-balance text-4xl font-black tracking-tight md:text-5xl">
            ShieldFlow vs. the $40k incumbents
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Same audit. Same frameworks. Fraction of the price. We did the math so you don&rsquo;t
            have to.
          </p>
        </div>

        <div className="mt-12 overflow-hidden rounded-2xl border border-border">
          <div className="grid grid-cols-3 border-b border-border bg-card text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <div className="p-5">Feature</div>
            <div className="p-5">Vanta / Drata</div>
            <div className="bg-primary/10 p-5 text-primary">ShieldFlow</div>
          </div>
          {rows.map(([label, them, us], i) => (
            <div
              key={label}
              className={`grid grid-cols-3 ${i % 2 === 0 ? "bg-background" : "bg-card/50"}`}
            >
              <div className="border-t border-border p-5 text-sm font-semibold">{label}</div>
              <div className="flex items-center gap-2 border-t border-border p-5 text-sm text-muted-foreground">
                <X className="h-4 w-4 shrink-0 text-destructive" /> {them}
              </div>
              <div className="flex items-center gap-2 border-t border-border bg-primary/5 p-5 text-sm font-semibold">
                <Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={3} /> {us}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      icon: Zap,
      title: "Automated evidence",
      body: "Connect AWS, GitHub, Okta, Google Workspace or Microsoft 365 in minutes. We read your security settings and file them as dated evidence — no folder of stale screenshots.",
    },
    {
      icon: Shield,
      title: "Continuous monitoring",
      body: "Root MFA switched off? A repo went public? Someone left and still has access? Checks re-run every day and flag what changed — not at the quarterly review when it's too late.",
    },
    {
      icon: Star,
      title: "Every framework, one workload",
      body: "Turn on MFA once and watch it satisfy SOC 2 CC6.1, ISO 27001 A.8.5, NIS2 Article 21, PCI Req 8, HIPAA and DORA at the same time. 71 measures cover all 328 requirements.",
    },
  ];
  return (
    <section className="border-b border-border bg-[color:var(--navy-deep)] py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 text-center">
          <h2 className="text-balance text-4xl font-black tracking-tight md:text-5xl">
            Built for founders. Not Fortune 500 CISOs.
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border bg-card p-8 transition hover:border-primary/40"
            >
              <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-primary/15">
                <f.icon className="h-6 w-6 text-primary" strokeWidth={2.5} />
              </div>
              <h3 className="text-xl font-bold">{f.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Guarantee() {
  return (
    <section className="border-b border-border py-24">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <div className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full border-2 border-primary bg-primary/10">
          <ShieldCheck className="h-10 w-10 text-primary" strokeWidth={2.5} />
        </div>
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">
          Two Guarantees, In Writing
        </p>
        <h2 className="text-balance text-4xl font-black tracking-tight md:text-5xl">
          Ready in 90 days — or the year is free.
        </h2>
        <p className="mt-6 text-lg text-muted-foreground">
          Work the 14-Day Sprint and connect your stack. If you&rsquo;re not{" "}
          <b className="text-foreground">Type&nbsp;I ready within 90 days</b>, we refund the full
          year. Not credits. Cash.
        </p>

        <div className="mx-auto mt-10 grid max-w-3xl gap-4 text-left md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="text-sm font-bold">The Readiness Guarantee</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Type&nbsp;I ready in 90 days or your money back. Type&nbsp;II needs an observation
              window of 3–12 months — nobody can compress that, and anyone who says otherwise is
              selling you a problem.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="text-sm font-bold">The No-Surprise Guarantee</div>
            <p className="mt-2 text-sm text-muted-foreground">
              $7,000 today is $7,000 at renewal. Hire 50 people — still $7,000. Add a framework —
              still $7,000. Cancel any month, export everything, keep your evidence.
            </p>
          </div>
        </div>

        <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-card px-4 py-2 text-sm text-muted-foreground">
          <Check className="h-4 w-4 text-primary" strokeWidth={3} />
          The risk is ours. The price never moves.
        </div>
      </div>
    </section>
  );
}

// Renders only once real, attributable quotes exist in lib/site.ts — no fabricated proof.
function Testimonials() {
  if (testimonials.length === 0) return null;
  return (
    <section className="border-b border-border bg-[color:var(--navy-deep)] py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 text-center">
          <h2 className="text-balance text-4xl font-black tracking-tight md:text-5xl">
            Founders are firing Vanta. Fast.
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {testimonials.map((q, i) => (
            <div key={i} className="flex flex-col rounded-2xl border border-border bg-card p-7">
              <div className="mb-4 flex gap-0.5">
                {Array.from({ length: 5 }).map((_, s) => (
                  <Star key={s} className="h-4 w-4 fill-primary text-primary" />
                ))}
              </div>
              <p className="flex-1 text-base leading-relaxed">&ldquo;{q.quote}&rdquo;</p>
              <div className="mt-6 border-t border-border pt-4">
                <div className="font-bold">{q.name}</div>
                <div className="text-sm text-muted-foreground">
                  {q.role}
                  {q.company ? `, ${q.company}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQSection() {
  return (
    <section className="border-b border-border py-24">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-balance text-4xl font-black tracking-tight md:text-5xl">
            Questions, answered.
          </h2>
        </div>
        <Faq />
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-28">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent" />
      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-balance text-5xl font-black tracking-tighter md:text-6xl">
          Stop doing the same work eight times.
          <br />
          <span className="text-primary">Do it once. Prove it everywhere.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          {SPOTS_LEFT}
          {" founding spots left. Once they’re gone, founding pricing closes — for good."}
        </p>
        <a
          href={LOGIN_URL}
          className="mt-10 inline-flex items-center gap-2 rounded-xl bg-primary px-10 py-5 text-lg font-bold text-primary-foreground transition hover:scale-[1.02]"
        >
          Sign in &amp; claim your spot
          <ArrowRight className="h-5 w-5" strokeWidth={3} />
        </a>
        <div className="mt-5 text-sm text-muted-foreground">
          Type I ready in 90 days or free • Price locked for life • No credit card
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <BrandMark className="h-6 w-6" />
          <span className="font-bold text-foreground">ShieldFlow</span>
        </div>
        <div>© {new Date().getFullYear()} ShieldFlow. AI-native GRC for founders.</div>
        <div className="flex gap-5">
          <a href={LOGIN_URL} className="hover:text-foreground">Log in</a>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
        </div>
      </div>
    </footer>
  );
}
