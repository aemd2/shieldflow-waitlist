import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Security at ShieldFlow — how we hold your evidence",
  description:
    "How ShieldFlow stores your compliance evidence and integration tokens: encryption, data residency, tenant isolation, audit trail, and what we deliberately don't do yet.",
};

const UPDATED = "30 October 2026";

/**
 * Why this page exists.
 *
 * A prospect reviewed the public site through a SOC 2 lens and concluded it felt
 * "too opaque... not giving people enough reason to trust it with their precious
 * data". He was right, and the diagnosis was precise: ShieldFlow does reasonable
 * things and published almost none of them. We hold other people's evidence and
 * their integration tokens — they have to vet us as a vendor, and there was
 * nothing to vet.
 *
 * Rules for editing this page:
 *   1. Every claim must point at something that actually runs. If you can't name
 *      the file or the setting, cut the claim.
 *   2. The "what we don't do yet" section is not optional and does not get
 *      quietly trimmed. It is the part that makes the rest believable, and a
 *      technical evaluator checks it first.
 *   3. Integration permissions live on /checks, which lists every call per
 *      provider. Link there; never restate it here, or the two will drift.
 */
export default function SecurityPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-muted-foreground underline">
        ← Back
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
        Security at ShieldFlow
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <p className="mt-6 text-sm leading-relaxed text-foreground">
        We hold your compliance evidence and read-only tokens into your cloud, code and identity
        systems. That makes us a vendor you have to assess, so this page is written to be
        assessed — specific enough to check, including the parts we haven&rsquo;t built yet.
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">
        <Section title="1. Where your data lives">
          All compliance data — controls, evidence files, policies, personnel, registers — is
          stored in Postgres hosted in the <b>European Union (eu-west-1)</b>, encrypted at rest by
          the platform, and in transit over TLS. Evidence files are held in object storage in the
          same region.
          <p className="mt-2">
            There is exactly one routine transfer out of the EU: AI inference, processed by Groq in
            the United States with <b>Zero Data Retention</b> enabled, which receives aggregate
            context only (control codes, counts, policy titles) plus text you type into the
            Co-Pilot. Detectable personal identifiers are stripped from that text before it leaves
            us. The full detail, including what is never sent, is in our{" "}
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
            . AI can be disabled for your workspace on request.
          </p>
        </Section>

        <Section title="2. How integration tokens are stored">
          Tokens and API keys are encrypted before they are written to the database, using
          <b> AES-256-GCM</b> with a fresh random 96-bit initialisation vector per value and an
          authentication tag, so a tampered ciphertext fails to decrypt rather than returning
          garbage. The stored format is versioned, so the scheme can be rotated without a
          migration, and re-encryption under a new key is scripted rather than manual.
          <p className="mt-2">
            Encryption <b>fails closed</b>: if the key is not configured, the server refuses to
            store a secret instead of saving it in plaintext. Tokens are never returned to the
            browser — they are decrypted server-side, used for the call, and discarded.
          </p>
        </Section>

        <Section title="3. What we ask for in your systems">
          Every integration is read-only, and we publish the exact calls rather than describing
          them in the abstract. <Link href="/checks" className="underline">What we check</Link>{" "}
          lists, per provider, every check we run, the specific API calls behind it, the permission
          each one needs, and what we never read.
          <p className="mt-2">
            Two examples of what that means in practice. AWS is connected by{" "}
            <b>assuming a role in your account</b> with an ExternalId — there is no long-lived
            access key for you to store or us to leak, and you keep the ability to revoke it in one
            click. Microsoft 365 asks for <b>User.Read.All</b>{" "}and nothing more; we deliberately do
            not request the reporting permissions that would let us read per-user MFA state,
            because the checks we run don&rsquo;t need them.
          </p>
          <p className="mt-2">
            We install <b>no agent on employee laptops</b>. Device posture — whether a laptop is
            encrypted, when it last checked in, whether anyone is working on a machine nobody
            manages — is read from the device manager you already run (Kandji or Jamf Pro), with a
            token scoped to the device list and device details. That gets the evidence an auditor
            asks for without us putting software on your team&rsquo;s machines.
          </p>
        </Section>

        <Section title="4. Keeping workspaces apart">
          ShieldFlow is multi-tenant on a shared database. Every table carrying customer data has
          row-level security enabled, and access is decided in the database — not in application
          code — by two functions that check whether the caller belongs to the workspace and
          whether they may write to it. A query that forgets to filter by workspace returns
          nothing rather than someone else&rsquo;s rows.
          <p className="mt-2">
            The handful of operations that must bypass row-level security to work — recording
            automated check results, writing the audit trail — run inside functions that verify the
            caller&rsquo;s membership first and raise an error otherwise, so the bypass cannot be
            borrowed to reach another workspace.
          </p>
        </Section>

        <Section title="5. Knowing who did what">
          Every meaningful change is appended to a per-workspace audit trail: who acted, what they
          acted on, when, and a snapshot of the change. The actor is derived <b>server-side</b>{" "}
          from the authenticated session inside the logging function itself, which means a
          tampered client cannot attribute its actions to someone else. The trail is readable in
          the app, filterable by actor and type. One-click export of the trail itself is not built
          yet (section 8).
        </Section>

        <Section title="6. Access to your data by us">
          Access to production is limited to the people who operate the service, and routine
          support does not involve reading your evidence. We are a small company and we would
          rather say that plainly than imply a formal access-review process we don&rsquo;t yet run
          — see section 8.
        </Section>

        <Section title="7. Reporting something to us">
          If you find a security problem, email{" "}
          <a className="underline" href="mailto:security@shieldflow.cloud">
            security@shieldflow.cloud
          </a>
          . We will acknowledge within two business days and keep you updated until it&rsquo;s
          closed. We won&rsquo;t pursue you for reporting something you found in good faith. We
          don&rsquo;t currently run a paid bug-bounty programme.
        </Section>

        <Section title="8. What we don't do yet">
          Everything above is in place today. These are not, and we would rather you heard it from
          us than found it in an assessment.
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              <b>No SOC 2 report of our own.</b> We are putting ShieldFlow through ShieldFlow and
              will publish our own trust centre when it reflects real work rather than an empty
              shell. Until then, assess us on this page and on{" "}
              <Link href="/checks" className="underline">
                what we check
              </Link>
              .
            </li>
            <li>
              <b>No managed KMS.</b> The encryption key is held in the server environment, not in
              a dedicated key-management service with automatic rotation. Rotation is scripted and
              manual.
            </li>
            <li>
              <b>Device posture needs an MDM.</b> We read disk encryption and check-in state from
              your device manager (see section 3) rather than installing an agent — so if you
              don&rsquo;t run one, those controls are satisfied by evidence you attach instead of
              automatically.
            </li>
            <li>
              <b>No single-tenant deployment.</b> Shared database with row-level security is what
              we offer today.
            </li>
            <li>
              <b>No penetration test report.</b> We have not commissioned an external test yet.
            </li>
            <li>
              <b>No audit-trail export.</b> The trail is readable and filterable in the app, but
              you can&rsquo;t yet download it as a file to hand to an auditor.
            </li>
          </ul>
        </Section>

        <Section title="9. Subprocessors">
          The vendors we rely on to run the service, and what each one handles, are listed in{" "}
          <Link href="/privacy" className="underline">
            our Privacy Policy
          </Link>
          . We keep that list current rather than maintaining a second copy here.
        </Section>
      </div>

      <p className="mt-10 text-xs text-muted-foreground">
        Questions an assessment needs answered that this page doesn&rsquo;t cover? Email{" "}
        <a className="underline" href="mailto:security@shieldflow.cloud">
          security@shieldflow.cloud
        </a>{" "}
        and we&rsquo;ll answer directly — and add it here.
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
