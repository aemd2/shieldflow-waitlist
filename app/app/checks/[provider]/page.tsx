import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public/PublicPage";
import { notFound } from "next/navigation";
import { PROVIDERS, PROVIDER_BY_KEY } from "@/lib/integrations/registry";

export function generateStaticParams() {
  return PROVIDERS.map((p) => ({ provider: p.key }));
}

export async function generateMetadata({ params }: { params: Promise<{ provider: string }> }): Promise<Metadata> {
  const entry = PROVIDER_BY_KEY.get((await params).provider);
  if (!entry) return {};
  return {
    title: `${entry.title} checks — what ShieldFlow reads, and what it never reads`,
    description: `Every read-only ${entry.title} check ShieldFlow runs, the exact API calls behind it, and what it never reads.`,
  };
}

/**
 * Public and static: generated from the same definitions the scanner runs, so it
 * can't drift from the product. Meant to be sent to a CTO before anyone connects
 * anything.
 */
export default async function ProviderChecksPage({ params }: { params: Promise<{ provider: string }> }) {
  const entry = PROVIDER_BY_KEY.get((await params).provider);
  if (!entry) notFound();
  return (
    <PublicPage
      eyebrow={<><Link href="/checks" className="hover:underline">What we check</Link> · {entry.title}</>}
      title={`What we check in ${entry.title} — and what we never read`}
      lede={entry.connectStory}
    >

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">How results work</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Every failure names the exact thing — the repository, the account, the pull request — and gives the fix.</li>
          <li>
            If we can&rsquo;t read something — a missing permission, more than we could read in one scan — the check says &ldquo;can&rsquo;t
            tell&rdquo; and why. It never passes by default.
          </li>
          <li>Anything can be marked out of scope with a reason and a review date. The reason is kept as audit evidence.</li>
          <li>Checks marked &ldquo;good to know&rdquo; are shown but never raise an alert or hold back a framework.</li>
        </ul>
      </section>

      {entry.areas.map(({ area, title }) => {
        const checks = entry.checks.filter((c) => c.area === area);
        if (!checks.length) return null;
        return (
          <section key={area} className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <ul className="space-y-3">
              {checks.map((c) => (
                <li key={c.key} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {c.title}
                    {c.informational && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">good to know</span>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{c.why}</p>
                  <p className="mt-2 font-mono text-xs text-muted-foreground">{c.apiCalls.join(" · ")}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">What we read</h2>
        <ul className="space-y-1 text-sm">
          {entry.reads.map(([perm, why]) => (
            <li key={perm}>
              <span className="font-medium">{perm}</span> <span className="text-muted-foreground">— {why}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">What we never read or do</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {entry.never.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-muted-foreground">
        <Link className="underline" href="/checks">Other integrations</Link> · <Link className="underline" href="/demo">See the product</Link> ·{" "}
        <Link className="underline" href="/signup">Start free</Link>
      </p>
    </PublicPage>
  );
}
