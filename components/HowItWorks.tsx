const tiles = [
  {
    title: "AI agents collect evidence",
    body: "Autonomous agents pull configurations, access logs, and policy artifacts from your stack — no more screenshot homework before every audit.",
  },
  {
    title: "Continuous controls monitoring",
    body: "Real-time alerts the moment a control drifts. Catch issues weeks before they become audit findings.",
  },
  {
    title: "Multi-framework cross-mapping",
    body: "One control set, mapped across SOC 2, ISO 27001, GDPR and HIPAA. Add a framework without redoing the work.",
  },
  {
    title: "Automated policy builder",
    body: "Generate a policy library and risk register from your integrations and answers — editable, versioned, audit-ready.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="section bg-slate-50">
      <div className="container-tight">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">How it works</span>
          <h2 className="h2 mt-3">AI-native from day one.</h2>
          <p className="mt-4 text-lg text-muted">
            Built around 2026 GRC best practices — not a 2018 checklist tool
            with AI bolted on.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {tiles.map((t) => (
            <div
              key={t.title}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h3 className="text-lg font-semibold text-ink">{t.title}</h3>
              <p className="mt-2 text-muted">{t.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
