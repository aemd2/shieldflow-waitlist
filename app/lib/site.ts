// Marketing/site constants. The product app and the public marketing page are
// one app now, so the login link is just a same-origin path.
export const LOGIN_URL = "/login";

export type Testimonial = {
  quote: string;
  name: string;
  role: string;
  company?: string;
};

// Real, attributable quotes only — kept empty until we have them. The landing's
// testimonials section renders nothing while this is empty (no fabricated proof),
// so dropping entries in here later lights the section up with no redesign.
export const testimonials: Testimonial[] = [];

export const faqs: { q: string; a: string }[] = [
  {
    q: "How can you really be 80% cheaper than Vanta?",
    a: "Two reasons: we don't have a 200-person sales team you're paying for, and our AI does the manual evidence work humans grind through at legacy platforms. Same outcome — passing your audit — for a fraction of the cost. We pass the savings straight to you.",
  },
  {
    q: "Is this product actually live, or just a waitlist?",
    a: "The platform is built and running today: auth, the compliance dashboard, automated evidence collection across 10 integrations, continuous monitoring, the AI Co-Pilot, policy generation, vendor and risk management, and a public Trust Center all work. The founding cohort is capped so onboarding stays white-glove.",
  },
  {
    q: "Which frameworks are supported?",
    a: "SOC 2, ISO 27001, HIPAA, GDPR, and PCI DSS — with controls cross-mapped, so a single piece of evidence can satisfy requirements across several frameworks at once.",
  },
  {
    q: "What if my auditor rejects something?",
    a: "Every framework is mapped to real, auditor-recognized controls, and evidence exports as a one-click audit report. If your auditor questions our evidence, we'll get on a call with them ourselves — and our guarantee has you covered.",
  },
  {
    q: "Is my data safe?",
    a: "Integration secrets are encrypted at rest with AES-256-GCM, every workspace is isolated at the database level with row-level security, and read-only auditor access is time-boxed. Security is the product — we hold ourselves to the standard we help you reach.",
  },
  {
    q: "What happens after the founding cohort fills up?",
    a: "Founding-member pricing is locked for life for everyone who joins now. Once the cohort is full, new customers come in at standard pricing — founders keep their rate for as long as they stay.",
  },
];
