const tiers = [
  {
    name: "Starter",
    price: "$99–$499",
    suffix: "/mo",
    blurb: "Small teams, one framework. Everything you need to get SOC 2 or ISO 27001 ready.",
    features: ["1 framework", "Up to 25 employees", "AI evidence collection", "Trust Center"],
  },
  {
    name: "Growth",
    price: "$999–$2,999",
    suffix: "/mo",
    blurb: "Multi-framework, more integrations, vendor risk. Built for 50–200 person teams.",
    features: [
      "Unlimited frameworks",
      "Up to 200 employees",
      "Continuous monitoring",
      "Vendor risk register",
    ],
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    suffix: "",
    blurb: "Custom controls, SSO, dedicated support, and procurement-friendly contracts.",
    features: ["Custom frameworks", "SSO / SAML", "Dedicated CSM", "Annual contracts"],
  },
];

export function PricingTeaser() {
  return (
    <section id="pricing" className="section bg-slate-50">
      <div className="container-tight">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Pricing</span>
          <h2 className="h2 mt-3">High-ticket value at fair-ticket prices.</h2>
          <p className="mt-4 text-lg text-muted">
            Final pricing is set at launch. Waitlist members lock in{" "}
            <span className="font-semibold text-ink">30–50% off year one</span>.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`rounded-xl border p-6 ${
                t.highlight
                  ? "border-accent bg-white shadow-lg ring-1 ring-accent/30"
                  : "border-slate-200 bg-white shadow-sm"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold text-ink">{t.name}</h3>
                {t.highlight && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                    Most popular
                  </span>
                )}
              </div>
              <p className="mt-4">
                <span className="text-3xl font-semibold text-ink">{t.price}</span>
                <span className="text-muted">{t.suffix}</span>
              </p>
              <p className="mt-3 text-sm text-muted">{t.blurb}</p>
              <ul className="mt-5 space-y-2 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
