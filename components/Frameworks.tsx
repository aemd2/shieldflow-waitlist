const frameworks = ["SOC 2", "ISO 27001", "GDPR", "HIPAA"];

export function Frameworks() {
  return (
    <section className="section bg-white">
      <div className="container-tight text-center">
        <span className="eyebrow">Frameworks supported at launch</span>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {frameworks.map((f) => (
            <span
              key={f}
              className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-3 text-base font-medium text-ink"
            >
              {f}
            </span>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted">
          PCI DSS, NIST CSF and CCPA on the roadmap. Tell us what you need on
          the waitlist form.
        </p>
      </div>
    </section>
  );
}
