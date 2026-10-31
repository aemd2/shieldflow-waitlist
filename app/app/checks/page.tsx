import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public/PublicPage";
import { PROVIDERS } from "@/lib/integrations/registry";
import { AWS_CHECKS } from "@/lib/aws/catalog";

export const metadata: Metadata = {
  title: "ShieldFlow checks — what we read in each integration",
  description: "Every read-only check ShieldFlow runs, per integration, with the exact permissions behind it and what it never reads.",
};

export default function ChecksIndexPage() {
  const all = [
    { key: "aws", href: "/aws-checks", title: "AWS", count: AWS_CHECKS.length },
    ...PROVIDERS.map((p) => ({ key: p.key, href: `/checks/${p.key}`, title: p.title, count: p.checks.length })),
  ];
  return (
    <PublicPage
      eyebrow="Transparency"
      title="What we check — and what we never read"
      lede={
        <>
          Every integration is read-only. Each page lists every check, the exact calls behind it, the permissions we ask for, and what we never
          read. Anything we can&rsquo;t read says &ldquo;can&rsquo;t tell&rdquo; — it never passes by default.
        </>
      }
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {all.map((p) => (
          <li key={p.key}>
            <Link href={p.href} className="block rounded-lg border border-border p-4 hover:bg-muted/40">
              <div className="font-medium">{p.title}</div>
              <div className="text-sm text-muted-foreground">{p.count} checks</div>
            </Link>
          </li>
        ))}
      </ul>
    </PublicPage>
  );
}
