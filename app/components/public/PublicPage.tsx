import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

/**
 * The shell for every public page that isn't the landing page: Security,
 * What we check, the per-provider check pages, Privacy and Terms.
 *
 * These five are the pages a prospect reads while deciding whether to trust us
 * with their evidence, and each one had grown its own look — three different
 * heading sizes, two body sizes, `prose-legal` on Privacy but not Terms, an
 * eyebrow on some, a bare "← Back" on others and nothing at all on /checks.
 * None of them had a footer, so a reader who arrived at Security could not get
 * to Privacy without going home first. Polished marketing page, drafts behind
 * it — on exactly the pages where looking unfinished costs the most.
 *
 * Everything that is page furniture lives here. A page supplies an eyebrow, a
 * title, an optional lede, an optional "Last updated" date, and its content.
 *
 * The footer mirrors the landing page's, including its link set, so the two
 * cannot drift apart again.
 */
export function PublicPage({
  eyebrow,
  title,
  lede,
  updated,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: string;
  lede?: React.ReactNode;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* A real header rather than a back link: it says which site you are on,
          which matters most for the reader who arrived from a link someone
          sent them rather than from the homepage. */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark className="h-6 w-6" />
            <span className="font-bold text-foreground">ShieldFlow</span>
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to site
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        {eyebrow ? (
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
        {lede ? <p className="mt-3 text-muted-foreground">{lede}</p> : null}
        {updated ? (
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>
        ) : null}
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">{children}</div>
      </main>

      <PublicFooter />
    </div>
  );
}

/**
 * One section heading style for all of these pages. Previously this exact
 * component was copy-pasted, byte for byte, into Security, Privacy and Terms,
 * while /checks had none and styled its headings inline.
 */
export function PublicSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-1 text-base font-semibold text-foreground">{title}</h2>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}

function PublicFooter() {
  return (
    <footer className="border-t border-border py-10">
      <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground sm:flex-row">
        <div>© {new Date().getFullYear()} ShieldFlow. AI-native GRC for founders.</div>
        <div className="flex flex-wrap justify-center gap-5">
          <Link href="/security" className="hover:text-foreground">Security</Link>
          <Link href="/checks" className="hover:text-foreground">What we check</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
        </div>
      </div>
    </footer>
  );
}
