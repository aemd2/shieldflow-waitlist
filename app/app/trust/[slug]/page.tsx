import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

// Cached for 60s per slug: the page is public and anonymous, so a plain
// (cookie-free) anon client lets Next cache it — one DB hit per slug per
// minute no matter how hard the page is hammered. Free-tier protection.
export const revalidate = 60;

interface TrustData {
  name: string;
  score: number;
  controls: { total: number; complete: number; in_progress: number };
  frameworks: { name: string; total: number; complete: number }[];
  policies: string[];
}

// Public page — no auth. Data comes from the anon-callable `get_trust_center`
// RPC, which returns safe aggregates only for companies that opted in.
export default async function TrustCenterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) notFound();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.rpc("get_trust_center", { p_slug: slug });
  if (error || !data) notFound();

  const trust = data as unknown as TrustData;

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-[var(--brand-emerald)]" />
          Trust Center
        </div>
        <h1 className="break-words text-4xl font-semibold text-foreground">{trust.name}</h1>
        <p className="text-sm text-muted-foreground">
          Live security &amp; compliance posture, powered by ShieldFlow.
        </p>
      </header>

      <section className="card flex flex-col items-center gap-2 py-8">
        <div className="text-6xl font-bold text-[var(--brand-emerald)]">{trust.score}%</div>
        <div className="text-sm text-muted-foreground">Overall compliance readiness</div>
        <div className="text-xs text-muted-foreground">
          {trust.controls.complete} of {trust.controls.total} controls complete ·{" "}
          {trust.controls.in_progress} in progress
        </div>
      </section>

      {trust.frameworks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Frameworks</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {trust.frameworks.map((f) => {
              const pct = f.total > 0 ? Math.round((f.complete / f.total) * 100) : 0;
              return (
                <div key={f.name} className="card">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{f.name}</span>
                    <span className="text-muted-foreground">{pct}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-[var(--brand-emerald)]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {trust.policies.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Published policies</h2>
          <div className="card p-0">
            <ul className="divide-y divide-border">
              {trust.policies.map((p) => (
                <li key={p} className="flex items-center gap-3 px-6 py-3 text-sm text-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--brand-emerald)]" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <footer className="pt-4 text-center text-xs text-muted-foreground">
        This page is published by {trust.name} and updates automatically from their live
        compliance data.
      </footer>
    </main>
  );
}
