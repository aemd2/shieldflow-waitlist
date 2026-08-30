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
    a: "Built and running today: the compliance dashboard, all eight frameworks with their full control sets, automated evidence collection across 10 integrations, hourly continuous monitoring, the AI Co-Pilot, policy generation with approvals and acknowledgements, risk and vendor management, access reviews, personnel tracking and a public Trust Center. The founding cohort is capped so onboarding stays white-glove.",
  },
  {
    q: "Which frameworks are supported?",
    a: "Eight, all included in the one price: SOC 2 (all 33 Common Criteria), ISO 27001 (all 93 Annex A controls), NIS2, DORA, the EU Cyber Resilience Act, GDPR, HIPAA (full Security Rule) and PCI DSS. That's 328 requirements in total — mapped onto 71 measures, so the overlapping work is done once rather than eight times.",
  },
  {
    q: "What does \"do the work once\" actually mean?",
    a: "Enforcing MFA satisfies SOC 2 CC6.1, ISO 27001 A.5.17 and A.8.5, NIS2 Article 21(2)(j), PCI DSS Req 8, HIPAA 164.312(d) and GDPR Article 32 — the same control, asked for six different ways. ShieldFlow tracks the measure, not the eight restatements of it, so you mark it done once and every framework updates. Across the library that's 328 requirements collapsed into 71 things to do.",
  },
  {
    q: "Do you cover NIS2, DORA and the Cyber Resilience Act?",
    a: "Yes, natively — and as far as we can tell we're the only SMB compliance platform that does. Vanta and Drata were built for US frameworks and treat the EU ones as add-ons or not at all. It matters even if you're not directly in scope: NIS2 largely exempts companies under 50 people, but your regulated customers are legally required to assess their suppliers, so the questionnaire lands on your desk anyway.",
  },
  {
    q: "Type I or Type II — which does the 14-Day Sprint get me?",
    a: "Type I. That's the honest answer. A Type I report assesses whether your controls are properly designed at a point in time, and 14 days of focused work genuinely gets you there. Type II assesses whether they operated effectively across an observation window — normally 3 to 12 months — and no software on earth can compress a calendar. We monitor continuously from day one so the window builds itself, but anyone promising you Type II in a fortnight is either confused or lying.",
  },
  {
    q: "What if my auditor rejects something?",
    a: "Every requirement is mapped to real, auditor-recognized controls with the evidence an auditor typically expects listed alongside it, and everything exports as an audit report. If your auditor questions our evidence, we'll get on a call with them ourselves. And if you follow the Sprint and aren't Type I ready inside 90 days, we refund the full year.",
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
