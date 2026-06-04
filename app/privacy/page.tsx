export const metadata = { title: "Privacy — ShieldFlow" };

export default function PrivacyPage() {
  return (
    <main className="container-tight section prose prose-slate max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-4 text-muted">
        ShieldFlow collects only the information you submit through the waitlist form
        (email, optional company name, company size, and a free-text pain point). We use it
        to contact you about early access and to understand which problems matter most. We
        do not sell your data. To be removed, email{" "}
        <a className="text-accent" href="mailto:aemd2donchev@gmail.com">
          aemd2donchev@gmail.com
        </a>
        .
      </p>
      <p className="mt-6">
        <a className="text-accent" href="/">
          ← Back home
        </a>
      </p>
    </main>
  );
}
