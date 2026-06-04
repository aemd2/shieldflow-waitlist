export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-white">
      <div className="container-tight pt-20 pb-24 sm:pt-28 sm:pb-32">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Early access — 30–50% off year one
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
            Compliance automation that doesn&rsquo;t cost a fortune.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-muted sm:text-xl">
            ShieldFlow handles SOC 2, ISO 27001, GDPR and HIPAA for teams of
            11–200 — at 40–60% less than Vanta or Drata, with AI agents that
            collect evidence on autopilot. Onboard in days, not weeks.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a href="#waitlist" className="btn-primary">
              Join the waitlist
            </a>
            <a href="#how-it-works" className="btn-ghost">
              See how it works
            </a>
          </div>
          <p className="mt-6 text-sm text-muted">
            No credit card. We&rsquo;ll only email you about early access.
          </p>
        </div>
      </div>
    </section>
  );
}
