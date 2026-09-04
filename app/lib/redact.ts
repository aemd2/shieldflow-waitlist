/**
 * Strip personal data out of free text before it leaves our infrastructure.
 *
 * Everything ShieldFlow *builds* into an AI prompt is already aggregate — control
 * codes, counts, policy titles, a vendor count. The one uncontrolled channel is
 * text the user types: a Co-Pilot question or a pasted questionnaire. Someone
 * pasting an employee list into the chat would send it straight to a US inference
 * provider, and that is precisely the path an auditor looks for.
 *
 * So the rule is: the original stays in the customer's own tenant (RLS-scoped,
 * EU-hosted); the copy that crosses the boundary to Groq is redacted.
 *
 * Deliberately conservative. These patterns are narrow because a false positive
 * mangles a legitimate compliance question, and this text is going to a model
 * that has to answer it. Version strings, control codes ("CC6.1", "A.8.24"),
 * dates and percentages must survive untouched — see the tests in the
 * `__tests__` sibling if one is ever added.
 *
 * This reduces exposure; it is not a guarantee, and it should never be described
 * as one. A determined user can still type a name in prose, and no regex catches
 * that. The honest claim is: we do not send personal data, we redact the common
 * machine-detectable identifiers from what the user types, and we tell the user
 * not to paste them.
 */

export interface RedactionResult {
  text: string;
  /** How many substitutions were made, by kind — for logging/telemetry. */
  counts: Record<string, number>;
  redacted: boolean;
}

/**
 * Ordered deliberately: IBAN before the generic long-digit rule so an IBAN is
 * labelled as one, and email before phone so the digits inside an address are
 * already gone.
 */
const RULES: { kind: string; re: RegExp; token: string }[] = [
  {
    kind: "email",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    token: "[email removed]",
  },
  {
    // IBAN: 2 country letters, 2 check digits, then 11-30 alphanumerics.
    kind: "iban",
    re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    token: "[bank account removed]",
  },
  {
    // Card-like: 13-19 digits, optionally split by spaces or hyphens. Anchored
    // on a digit at BOTH ends so the match never swallows the trailing
    // separator — "4111 1111 1111 1111 was" kept eating the space before "was".
    kind: "card",
    re: /\b\d(?:[ -]?\d){12,18}\b/g,
    token: "[card number removed]",
  },
  {
    // Phone: optional +, then 7-14 digits with separators. Requires either a
    // leading + or at least one separator, so a bare 8-digit number (a year
    // range, a count) is left alone.
    kind: "phone",
    re: /(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}[ .-]\d{2,4}[ .-]\d{2,6}\b/g,
    token: "[phone removed]",
  },
];

/**
 * Returns the text with detectable personal identifiers replaced by labelled
 * placeholders. The placeholders are readable on purpose: the model can still
 * reason about "the user gave an email address here" without receiving it, and
 * a human reading the transcript can see redaction happened.
 */
export function redactPii(input: string): RedactionResult {
  const counts: Record<string, number> = {};
  let text = input;

  for (const { kind, re, token } of RULES) {
    text = text.replace(re, (match) => {
      // The phone rule is the loosest; skip matches that are mostly separators
      // or too short to be a real number once punctuation is removed.
      if (kind === "phone" && match.replace(/\D/g, "").length < 7) return match;
      counts[kind] = (counts[kind] ?? 0) + 1;
      return token;
    });
  }

  return { text, counts, redacted: Object.keys(counts).length > 0 };
}

/** Convenience for call sites that only need the cleaned string. */
export function redactedText(input: string): string {
  return redactPii(input).text;
}
