import Link from "next/link";

export const metadata = { title: "Terms of Service · ShieldFlow" };

const UPDATED = "30 October 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-muted-foreground underline">
        ← Back
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Terms of Service</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

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
          Paid plans are billed in advance through our payment processor. Subscriptions run month to
          month unless agreed otherwise, and you may cancel at any time with effect from the end of
          the current billing period. Fees already paid are not refunded on cancellation — instead,
          the commitments in section 6 apply.
        </Section>

        <Section title="6. Our commitments to you">
          These are the two promises made on our website, stated here so they bind us and not only
          our marketing.
          <div className="mt-3 space-y-3">
            <div>
              <b>6.1 Readiness commitment.</b> If you (a) connect at least one cloud account, one
              source-code repository and one identity provider, and (b) complete every task in the
              14-Day Sprint, and you are <i>not</i> SOC 2 Type I ready within 90 days of completing
              the Sprint, we will continue to provide the Service to you at no charge until you are,
              and we will attend a call with your auditor at your request. You must tell us you are
              relying on this commitment within 30 days of the end of that 90-day period. This is a
              commitment to keep working, not a cash refund.
              <br />
              <span className="text-muted-foreground">
                &ldquo;Type I ready&rdquo; means every control in your selected frameworks is marked
                complete with evidence attached. Whether an auditor issues a report, and on what
                timetable, is their decision and not something we control — we are not a certifying
                body (section 2).
              </span>
            </div>
            <div>
              <b>6.2 Price commitment.</b> The price of your subscription will not increase for as
              long as that subscription continues without interruption — not at renewal, not if your
              headcount grows, and not if you add frameworks. If you cancel and later subscribe
              again, the price then current applies. We may change the prices we offer to new
              customers at any time; that has no effect on an existing continuous subscription.
            </div>
          </div>
        </Section>

        <Section title="7. Your data & ownership">
          You retain ownership of the data you submit. You grant us the limited rights needed to operate
          the Service for you. We process personal data as described in our{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </Section>

        <Section title="8. Disclaimers">
          The Service is provided &quot;as is&quot; without warranties of any kind. We do not warrant that
          using the Service will make you compliant with any standard or pass any audit.
        </Section>

        <Section title="9. Limitation of liability">
          To the maximum extent permitted by law, ShieldFlow is not liable for indirect or consequential
          damages, and our total liability is limited to the amounts you paid in the 12 months before the
          claim.
        </Section>

        <Section title="10. Termination">
          You may stop using the Service at any time. We may suspend or terminate access for breach of
          these Terms. On termination you may export your data for a reasonable period.
        </Section>

        <Section title="11. Governing law & changes">
          These Terms are governed by the laws of your stated jurisdiction. We may update these Terms and
          will revise the date above; continued use means you accept the changes.
        </Section>

        <Section title="12. Contact">
          Questions about these Terms? Email{" "}
          <a className="underline" href="mailto:legal@shieldflow.cloud">legal@shieldflow.cloud</a>.
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
