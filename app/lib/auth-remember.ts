// "Remember me" for the auth form: saves email for next visit and, when
// unchecked, rewrites Supabase auth cookies as session cookies (cleared when
// the browser closes). Supabase SSR defaults to ~400-day cookie maxAge.

const REMEMBER_PREF_KEY = "shieldflow_remember_me";
const REMEMBER_EMAIL_KEY = "shieldflow_remembered_email";

/** Last choice on this browser — default true (most users expect to stay signed in). */
export function getRememberMePreference(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(REMEMBER_PREF_KEY);
  return stored === null ? true : stored === "true";
}

export function setRememberMePreference(remember: boolean): void {
  localStorage.setItem(REMEMBER_PREF_KEY, String(remember));
}

/** Prefill email on login/signup when the user previously opted in. */
export function getRememberedEmail(): string {
  if (typeof window === "undefined") return "";
  if (!getRememberMePreference()) return "";
  return localStorage.getItem(REMEMBER_EMAIL_KEY) ?? "";
}

/** Called after a successful password signup/login. */
export function persistRememberedEmail(email: string, remember: boolean): void {
  setRememberMePreference(remember);
  if (remember) {
    localStorage.setItem(REMEMBER_EMAIL_KEY, email);
  } else {
    localStorage.removeItem(REMEMBER_EMAIL_KEY);
  }
}

/**
 * When remember-me is off, strip Max-Age from Supabase auth cookies so they
 * behave as session cookies. Auth cookies are not HttpOnly in the browser
 * client, so we can rewrite them from JS right after sign-in.
 */
export function applySessionPersistence(remember: boolean): void {
  if (typeof document === "undefined" || remember) return;

  for (const segment of document.cookie.split(";")) {
    const trimmed = segment.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (!name.startsWith("sb-") || !name.includes("auth-token")) continue;
    // No Max-Age / Expires → session cookie (dropped when browser closes).
    document.cookie = `${name}=${value}; path=/; SameSite=Lax`;
  }
}
