import Link from "next/link";
import { Alert } from "@/components/ui/Alert";

export const metadata = { title: "Privacy Policy · ShieldFlow" };

const UPDATED = "21 June 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-muted-foreground underline">
        ← Back
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <Alert variant="warning" className="mt-4">
        <strong>Template notice:</strong> This is a starting-point policy. Have it reviewed by legal
        counsel and tailored to your actual data practices before you collect data from real customers.
      </Alert>

      <div className="prose-legal mt-8 space-y-6 text-sm leading-relaxed text-foreground">
        <Section title="1. Who we are">
          ShieldFlow (&quot;ShieldFlow&quot;, &quot;we&quot;, &quot;us&quot;) provides an AI-powered
          governance, risk and compliance platform. This policy explains what personal data we
          process and why. For privacy questions, contact{" "}
          <a className="underline" href="mailto:privacy@shieldflow.com">privacy@shieldflow.com</a>.
        </Section>

        <Section title="2. Data we collect">
          <ul className="list-inside list-disc space-y-1">
            <li><strong>Account data:</strong> your name, work email, and password (stored only as a salted hash).</li>
            <li><strong>Workspace data:</strong> the company, controls, evidence files, policies, vendors and notes you create.</li>
            <li><strong>Integration data:</strong> read-only metadata you choose to sync (e.g. repository or user-security summaries). Access tokens are stored to enable syncs you initiate.</li>
            <li><strong>Usage data:</strong> basic logs and, if enabled, privacy-friendly analytics to keep the service reliable.</li>
          </ul>
        </Section>

        <Section title="3. How we use it">
          To provide and secure the service, generate the compliance features you request,
          communicate with you about your account, and meet legal obligations. We do not sell your data.
        </Section>

        <Section title="4. Legal bases (GDPR)">
          We process data to perform our contract with you, on the basis of our legitimate interests
          in running and securing the service, and to comply with legal obligations. Where required,
          we rely on your consent and you may withdraw it at any time.
        </Section>

        <Section title="5. Sub-processors">
          We use the following vendors to run the service. Each processes data only as needed to
          provide their service, under a data-processing agreement.
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <b>Supabase</b> — database, authentication and file storage. Hosted in the EU
              (eu-west-1). This is where your compliance data lives at rest.
            </li>
            <li>
              <b>Vercel</b> — application hosting and delivery.
            </li>
            <li>
              <b>Groq</b> — AI inference for the Co-Pilot, policy generation and questionnaire
              drafting. <b>Processed in the United States.</b> We send only aggregate context —
              control codes and statuses, counts, policy titles — plus the text you type into the
              Co-Pilot or paste into a questionnaire, from which we automatically strip detectable
              personal identifiers before it leaves our systems. We never send evidence files,
              policy contents, personnel records, vendor names or integration credentials. Groq
              does not train on this data and does not retain it by default.
            </li>
            <li>
              <b>Stripe</b> — payment processing. We never see or store card details.
            </li>
            <li>
              <b>Resend</b> — transactional email (sign-in links, notifications).
            </li>
          </ul>
        </Section>

        <Section title="6. Data retention">
          We keep your data for as long as your account is active. You can delete your workspace data
          at any time, and we delete or anonymise data within a reasonable period after account closure,
          except where retention is legally required.
        </Section>

        <Section title="7. Security">
          Data is encrypted in transit, access is restricted by row-level security so each company sees
          only its own data, and secrets are stored server-side. No system is perfectly secure, but we
          work to protect your information.
        </Section>

        <Section title="8. Your rights">
          Subject to applicable law, you may access, correct, export, or delete your personal data, and
          object to or restrict certain processing. Contact us to exercise these rights.
        </Section>

        <Section title="9. International transfers">
          Your compliance data is stored in the European Union. The one routine transfer outside
          the EU is <b>AI inference, which is processed by Groq in the United States</b> — see
          section 5 for exactly what is sent and what is not. Where data is transferred across
          borders we rely on appropriate safeguards such as the EU Standard Contractual Clauses.
          If your obligations require that no data leaves the EU, the AI features can be disabled
          for your workspace on request; the rest of the product is unaffected.
        </Section>

        <Section title="10. Changes & contact">
          We may update this policy and will revise the date above. Questions? Email{" "}
          <a className="underline" href="mailto:privacy@shieldflow.com">privacy@shieldflow.com</a>.
        </Section>
      </div>

      <p className="mt-10 text-xs text-muted-foreground">
        See also our <Link href="/terms" className="underline">Terms of Service</Link>.
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
