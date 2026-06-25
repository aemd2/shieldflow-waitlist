// Lightweight email helpers (no dependency): a stricter format check than
// the browser's type="email", plus a "did you mean …?" typo suggester for the
// most common domain/TLD mistakes (gmial.com, gmail.con, acme.con, …).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Stricter than HTML type="email" (which accepts "a@b" and "name@gmailcom").
 * Requires a domain with a real dot-separated TLD of at least 2 chars, and
 * rejects doubled/edge dots. Intentionally pragmatic — accepts +tags,
 * subdomains, and any TLD length, without trying to parse RFC 5322 fully.
 */
export function isLikelyValidEmail(email: string): boolean {
  if (email.length > 254) return false;
  if (!EMAIL_RE.test(email)) return false;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  return true;
}

// Providers people fat-finger most. Whole-domain matching catches both the
// name (gmial → gmail) and the TLD (gmail.con → gmail.com) in one comparison.
const POPULAR_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "hotmail.co.uk", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com",
  "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "zoho.com",
  "yandex.com", "fastmail.com",
];

// Common TLDs — so a typo on a *custom* domain (acme.con) still gets caught.
const COMMON_TLDS = [
  "com", "org", "net", "edu", "gov", "io", "co", "us", "uk", "ca", "de", "fr",
  "es", "it", "nl", "au", "eu", "info", "biz", "dev", "app", "me",
];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Returns a corrected email ("name@gmail.com") when the domain looks like a
 * close typo of a popular provider or a common TLD — otherwise null. Never
 * suggests a change for an already-valid popular address.
 */
export function suggestEmailCorrection(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain) return null;

  // Already a known-good provider → nothing to suggest.
  if (POPULAR_DOMAINS.includes(domain)) return null;

  // 1) Whole-domain typo against popular providers (gmial.com, gmail.con).
  let bestDomain: string | null = null;
  let bestDist = Infinity;
  for (const d of POPULAR_DOMAINS) {
    const dist = levenshtein(domain, d);
    if (dist < bestDist) {
      bestDist = dist;
      bestDomain = d;
    }
  }
  if (bestDomain && bestDist > 0 && bestDist <= 2) {
    return `${local}@${bestDomain}`;
  }

  // 2) TLD-only typo on any (e.g. custom) domain: acme.con → acme.com.
  const lastDot = domain.lastIndexOf(".");
  if (lastDot > 0) {
    const base = domain.slice(0, lastDot);
    const tld = domain.slice(lastDot + 1);
    if (tld && !COMMON_TLDS.includes(tld)) {
      let bestTld: string | null = null;
      let bestTldDist = Infinity;
      for (const t of COMMON_TLDS) {
        const dist = levenshtein(tld, t);
        if (dist < bestTldDist) {
          bestTldDist = dist;
          bestTld = t;
        }
      }
      if (bestTld && bestTldDist > 0 && bestTldDist <= 1) {
        return `${local}@${base}.${bestTld}`;
      }
    }
  }

  return null;
}
