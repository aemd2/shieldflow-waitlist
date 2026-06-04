const rows = [
  { vendor: "ShieldFlow", price: "$5K–$40K", strength: "AI-first, simple, affordable", us: true },
  { vendor: "Vanta", price: "$15K–$100K+", strength: "Broad integrations, polish" },
  { vendor: "Drata", price: "$7.5K–$100K+", strength: "Strong monitoring" },
  { vendor: "Sprinto", price: "$4K–$30K", strength: "Cheap but feature-thin" },
  { vendor: "OneTrust", price: "$150K–$1M+", strength: "Enterprise scope, high TCO" },
];

export function ComparisonTable() {
  return (
    <section className="section bg-white">
      <div className="container-tight">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">How we compare</span>
          <h2 className="h2 mt-3">Same outcome. A fraction of the price.</h2>
        </div>
        <div className="mt-12 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-5 py-4">Vendor</th>
                <th className="px-5 py-4">Approx. annual price</th>
                <th className="px-5 py-4">Best at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((r) => (
                <tr key={r.vendor} className={r.us ? "bg-accent/5" : ""}>
                  <td className="px-5 py-4 font-medium text-ink">
                    {r.vendor}
                    {r.us && (
                      <span className="ml-2 rounded bg-accent px-2 py-0.5 text-xs font-medium text-white">
                        Us
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-ink">{r.price}</td>
                  <td className="px-5 py-4 text-muted">{r.strength}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-muted">
          Competitor pricing based on public reports and customer reviews,
          May 2026. Ranges vary by company size and add-ons.
        </p>
      </div>
    </section>
  );
}
