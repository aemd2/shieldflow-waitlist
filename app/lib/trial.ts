// Tester-plan invite codes.
//
// Shape: "<random>-<seq>", e.g. "k3m9x2-014". The trailing number is the
// recipient number — whoever sends the link knows link 014 went to a specific
// person, so "who did I send it to" and "who actually signed up" both fall out
// of the code itself. The random prefix exists purely so an outsider can't walk
// /trial/001, /trial/002, ... and burn codes meant for real prospects.

export const TRIAL_CODE_RE = /^[a-z0-9]{4,16}-\d{1,5}$/;

/** Cheap shape check before ever touching the database. */
export function isValidTrialCodeFormat(code: string): boolean {
  return TRIAL_CODE_RE.test(code);
}

/** Normalise what someone pasted (trailing slash, stray spaces, upper case). */
export function normalizeTrialCode(raw: string): string {
  return raw.trim().replace(/\/+$/, "").toLowerCase();
}

/** The recipient number a code ends with — 14 for "k3m9x2-014". */
export function trialCodeSeq(code: string): number | null {
  const m = code.match(/-(\d{1,5})$/);
  return m ? Number(m[1]) : null;
}

/** Full shareable URL for a code. */
export function trialLink(code: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/trial/${code}`;
}
