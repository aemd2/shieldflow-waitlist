// Where the product app lives. Set NEXT_PUBLIC_APP_URL in the marketing site's
// env once the app is deployed (e.g. https://app.shieldflow.com); falls back to
// the in-page waitlist anchor target until then.
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.shieldflow.com";

export const LOGIN_URL = `${APP_URL}/login`;

export const faqs: { q: string; a: string }[] = [
  {
    q: "How can you be so much cheaper than Vanta and OneTrust?",
    a: "We built ShieldFlow AI-native from day one — no legacy code, no 200-person sales team to feed, no six-month enterprise sales cycle. You sign up and you're in. We pass those savings straight to you, and the product is the same or better.",
  },
  {
    q: "Is the product actually live, or am I waitlisting vaporware?",
    a: "The platform is built and running. Auth, the compliance dashboard, automated evidence collection across 10 integrations, continuous monitoring, the AI Co-Pilot, policy generation, vendor and risk management, and a public Trust Center all work today. The waitlist exists because we're capping the first cohort to keep onboarding white-glove.",
  },
  {
    q: "Which frameworks do you support?",
    a: "SOC 2, ISO 27001, HIPAA, GDPR, and PCI DSS — with controls mapped across all of them, so a single piece of evidence can satisfy requirements in several frameworks at once.",
  },
  {
    q: "What about my auditor?",
    a: "Every framework we support is mapped to real, auditor-recognized controls, and evidence is exportable as a one-click audit report. If your auditor has questions about our evidence, we'll get on a call with them ourselves.",
  },
  {
    q: "Is my data secure?",
    a: "Integration secrets are encrypted at rest with AES-256-GCM, every workspace is isolated at the database level with row-level security, and read-only auditor access is time-boxed. Security is the product — we hold ourselves to the standard we help you reach.",
  },
  {
    q: "Do I have to pay to join the waitlist?",
    a: "No. Joining is free and takes ten seconds. We'll email you when your early-access spot opens, along with founding-member pricing.",
  },
];
