import Link from "next/link";

export const metadata = { title: "Terms of Service · ShieldFlow" };

const UPDATED = "21 June 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-muted-foreground underline">
        ← Back
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Terms of Service</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>Template notice:</strong> These are starting-point terms. Have them reviewed by legal
        counsel and adapted to your business before relying on them with paying customers.
      </div>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">
        <Section title="1. Agreement">
          By creating an account or using ShieldFlow (the &quot;Service&quot;) you agree to these Terms.
          If you use the Service on behalf of an organisation, you represent that you may bind it.
        </Section>

        <Section title="2. The Service">
          ShieldFlow provides compliance-management tooling, including dashboards, evidence storage,
          AI-assisted policy generation, monitoring, and reporting. Features may change over time.
          ShieldFlow assists with compliance readiness but is not a certifying body and does not
          provide legal or audit advice.
        </Section>

        <Section title="3. Accounts">
          You are responsible for your account, for keeping credentials secure, and for activity under
          your workspace. Notify us promptly of any unauthorised use.
        </Section>

        <Section title="4. Acceptable use">
          Don&apos;t misuse the Service: no unlawful activity, no attempts to breach security or access
          other customers&apos; data, no reverse engineering, and no uploading of content you lack the
          rights to.
        </Section>

        <Section title="5. Subscriptions & billing">
          Paid plans are billed in advance through our payment processor. Fees are non-refundable except
          where required by law. We may change pricing with reasonable notice; changes apply to the next
          billing period.
        </Section>

        <Section title="6. Your data & ownership">
          You retain ownership of the data you submit. You grant us the limited rights needed to operate
          the Service for you. We process personal data as described in our{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </Section>

        <Section title="7. Disclaimers">
          The Service is provided &quot;as is&quot; without warranties of any kind. We do not warrant that
          using the Service will make you compliant with any standard or pass any audit.
        </Section>

        <Section title="8. Limitation of liability">
          To the maximum extent permitted by law, ShieldFlow is not liable for indirect or consequential
          damages, and our total liability is limited to the amounts you paid in the 12 months before the
          claim.
        </Section>

        <Section title="9. Termination">
          You may stop using the Service at any time. We may suspend or terminate access for breach of
          these Terms. On termination you may export your data for a reasonable period.
        </Section>

        <Section title="10. Governing law & changes">
          These Terms are governed by the laws of your stated jurisdiction. We may update these Terms and
          will revise the date above; continued use means you accept the changes.
        </Section>

        <Section title="11. Contact">
          Questions about these Terms? Email{" "}
          <a className="underline" href="mailto:legal@shieldflow.com">legal@shieldflow.com</a>.
        </Section>
      </div>

      <p className="mt-10 text-xs text-muted-foreground">
        See also our <Link href="/privacy" className="underline">Privacy Policy</Link>.
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-base font-semibold text-foreground">{title}</h2>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}
