export function ProblemSection() {
  return (
    <section className="section bg-white">
      <div className="container-tight grid gap-12 md:grid-cols-2 md:items-center">
        <div>
          <span className="eyebrow">The problem</span>
          <h2 className="h2 mt-3">
            GRC tools are built for enterprise budgets — not your team.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Vanta and Drata quotes routinely land at $15K–$100K with multi-week
            onboarding, rigid workflows, and surprise add-on fees. OneTrust is
            worse. Sprinto is cheap but thin. Mid-market teams that just need
            SOC 2 or ISO 27001 done end up overpaying for features they&rsquo;ll
            never touch.
          </p>
        </div>
        <ul className="space-y-4">
          {[
            "Quotes 2–10× higher than what an 11–200 person team should pay.",
            "Setup that drags on for weeks before evidence even starts flowing.",
            "Manual evidence collection that AI should have killed years ago.",
            "Bloated UI optimized for enterprise procurement, not your day.",
          ].map((point) => (
            <li
              key={point}
              className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
              <span className="text-ink">{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
