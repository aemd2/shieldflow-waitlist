"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { isLikelyValidEmail, suggestEmailCorrection } from "@/lib/email";
import { friendlyAuthError } from "@/lib/auth-errors";
import {
  applySessionPersistence,
  getRememberedEmail,
  getRememberMePreference,
  persistRememberedEmail,
} from "@/lib/auth-remember";

type Mode = "login" | "signup";

// bcrypt (Supabase's password hash) silently ignores anything past 72 bytes, so
// a longer password would "work" at signup but the truncation is invisible and
// confusing. Cap it explicitly. Emails max out at 254 chars per the RFC.
const MAX_PASSWORD = 72;
const MAX_EMAIL = 254;
// After this many failed logins in a row, make the user pause — protects the
// account and keeps us under Supabase's per-IP auth rate limit on the free tier.
const FAIL_LIMIT = 5;
const FAIL_COOLDOWN_MS = 30_000;

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createBrowserSupabase();
  // Where to land after auth. Same-site relative paths only (no "//evil.com" or
  // external URLs) — mirrors the guard in the /api/auth/confirm route.
  const rawNext = params.get("next") ?? "/";
  const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  // Carry `next` across the login⇄signup links so an invited user keeps their
  // destination even if they switch to creating an account.
  const nextQuery = nextPath !== "/" ? `?next=${encodeURIComponent(nextPath)}` : "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [linkCooldown, setLinkCooldown] = useState(false);
  // Persist lockout end time so a page refresh during the cooldown still shows
  // the countdown. Uses sessionStorage (tab-scoped, cleared on close).
  const LOCKOUT_KEY = "sf_login_lockout_until";
  const FAILURES_KEY = "sf_login_failures";

  function getStoredLockSecondsRemaining(): number {
    try {
      const until = parseInt(sessionStorage.getItem(LOCKOUT_KEY) ?? "0", 10);
      const remaining = Math.ceil((until - Date.now()) / 1000);
      return remaining > 0 ? remaining : 0;
    } catch { return 0; }
  }

  const [lockSeconds, setLockSeconds] = useState(() => getStoredLockSecondsRemaining());
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // On signup, if a typo suggestion is active we warn once and require a
  // second click to confirm the user really meant to use that address.
  const [typoWarned, setTypoWarned] = useState(false);
  const failuresRef = useRef(0);
  const [info, setInfo] = useState<string | null>(
    mode === "login" && params.get("reason") === "expired"
      ? "Your session expired. Please sign in again."
      : null,
  );

  // Restore "remember me" + saved email from the last visit on this browser.
  // Also resume any active brute-force lockout that survived a page refresh.
  useEffect(() => {
    setRememberMe(getRememberMePreference());
    const savedEmail = getRememberedEmail();
    if (savedEmail) setEmail(savedEmail);

    // Restore failure count so the lockout threshold still applies after refresh.
    try {
      const stored = parseInt(sessionStorage.getItem(FAILURES_KEY) ?? "0", 10);
      if (stored > 0) failuresRef.current = stored;
    } catch { /* sessionStorage blocked (private mode) — fail silently */ }

    // If a lockout is still active, resume the countdown.
    const remaining = getStoredLockSecondsRemaining();
    if (remaining > 0) {
      setLockSeconds(remaining);
      let secs = remaining;
      const timer = setInterval(() => {
        secs -= 1;
        setLockSeconds(secs);
        if (secs <= 0) {
          clearInterval(timer);
          failuresRef.current = 0;
          try { sessionStorage.removeItem(LOCKOUT_KEY); sessionStorage.removeItem(FAILURES_KEY); } catch { /* ignore */ }
        }
      }, 1000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A dropped connection / unreachable Supabase rejects the auth call itself.
  // Without this the await throws, setLoading(false) never runs, and the button
  // is stuck on "Please wait..." forever with no message.
  const NETWORK_ERROR = "We couldn't reach the server. Check your connection and try again.";

  // SAML SSO needs Supabase Pro + a registered IdP — gated to "future feature"
  // (same call as the Settings → Single sign-on "Coming soon" tab, 2026-07-08).
  // Flip to true once the org upgrades and an IdP is registered; ssoSignIn and
  // the whole flow below stay intact and wired.
  const SSO_LOGIN_ENABLED = false as boolean;

  function startLockout() {
    let remaining = Math.ceil(FAIL_COOLDOWN_MS / 1000);
    setLockSeconds(remaining);
    // Persist so a page refresh during the cooldown still shows the countdown.
    try {
      sessionStorage.setItem(LOCKOUT_KEY, String(Date.now() + FAIL_COOLDOWN_MS));
      sessionStorage.setItem(FAILURES_KEY, String(failuresRef.current));
    } catch { /* sessionStorage blocked — fail silently */ }
    const timer = setInterval(() => {
      remaining -= 1;
      setLockSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        failuresRef.current = 0;
        try { sessionStorage.removeItem(LOCKOUT_KEY); sessionStorage.removeItem(FAILURES_KEY); } catch { /* ignore */ }
      }
    }, 1000);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Guard against a second Enter/click while the first request is in flight.
    if (loading || lockSeconds > 0) return;
    setError(null);
    setInfo(null);

    // Mobile keyboards autocapitalize and add trailing spaces — normalize so the
    // same person can always log back in with the address they typed at signup.
    const cleanEmail = email.trim().toLowerCase();

    // Catch malformed addresses before spending a network request — type="email"
    // happily accepts "name@gmailcom" and "name@x.c".
    if (!isLikelyValidEmail(cleanEmail)) {
      setError("Please enter a valid email address, like name@company.com.");
      setSuggestion(suggestEmailCorrection(cleanEmail));
      return;
    }

    // A password of only spaces passes minLength but is almost always a slip.
    if (mode === "signup" && password.trim().length === 0) {
      setError("Your password can't be only spaces.");
      return;
    }

    // On signup: if a typo suggestion is active and the user hasn't confirmed
    // yet, warn them once. A second click proceeds normally.
    if (mode === "signup" && suggestion && !typoWarned) {
      setTypoWarned(true);
      setError(
        `Double-check your email — did you mean ${suggestion}? If not, click Sign up again to continue.`,
      );
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/api/auth/confirm?next=${encodeURIComponent(nextPath)}`,
          },
        });
        if (error) {
          setError(friendlyAuthError(error));
          return;
        }
        // Supabase silently swallows duplicate-email signups when confirmation is
        // ON — it returns no error but identities is empty. Detect it here.
        if (!data.session && data.user?.identities?.length === 0) {
          setError("An account with this email already exists. Sign in instead — or use Forgot password if you can't get in.");
          return;
        }
        // If email confirmation is on, there's no session yet — guide the user.
        if (!data.session) {
          persistRememberedEmail(cleanEmail, rememberMe);
          setInfo("Check your inbox to confirm your email, then sign in. (Check spam too.)");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) {
          // Count consecutive credential failures; after a few, force a pause.
          if (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message)) {
            failuresRef.current += 1;
            try { sessionStorage.setItem(FAILURES_KEY, String(failuresRef.current)); } catch { /* ignore */ }
            if (failuresRef.current >= FAIL_LIMIT) {
              startLockout();
              setError(
                "Too many failed attempts. Wait 30 seconds, or reset your password if you've forgotten it.",
              );
              return;
            }
          }
          setError(friendlyAuthError(error));
          return;
        }
        failuresRef.current = 0;
      }
      persistRememberedEmail(cleanEmail, rememberMe);
      applySessionPersistence(rememberMe);
      router.push(nextPath);
      router.refresh();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  }

  async function googleSignIn() {
    if (loading) return;
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/api/auth/confirm?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (error) {
        setError(friendlyAuthError(error));
        setLoading(false);
      }
      // On success the browser navigates to Google — keep the button disabled.
    } catch {
      setError(NETWORK_ERROR);
      setLoading(false);
    }
  }

  async function magicLink() {
    if (loading || linkCooldown) return;
    setError(null);
    setInfo(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Enter your email above first, then request the link.");
      return;
    }
    if (!isLikelyValidEmail(cleanEmail)) {
      setError("Please enter a valid email address, like name@company.com.");
      setSuggestion(suggestEmailCorrection(cleanEmail));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/confirm?next=${encodeURIComponent(nextPath)}`,
        },
      });
      // A hard rate-limit (free-tier email cap) is worth surfacing; anything
      // else stays neutral so we never reveal whether the address exists.
      if (error && (error.code === "over_email_send_rate_limit" || error.status === 429)) {
        setError(friendlyAuthError(error));
        return;
      }
      setInfo("If that email is valid, a sign-in link is on its way. Check your inbox (and spam).");
      // 60s cooldown: repeated clicks would burn the Supabase email quota
      // (and Supabase would start rate-limiting all auth emails).
      setLinkCooldown(true);
      setTimeout(() => setLinkCooldown(false), 60_000);
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  }

  async function ssoSignIn() {
    if (loading) return;
    setError(null);
    setInfo(null);
    const cleanEmail = email.trim().toLowerCase();
    const domain = cleanEmail.split("@")[1];
    if (!domain) {
      setError("Enter your work email above, then continue with SSO.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithSSO({
        domain,
        options: {
          redirectTo: `${window.location.origin}/api/auth/confirm?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (error || !data?.url) {
        setError(
          "Single sign-on isn't set up for this domain yet. Use email and password, or ask your admin.",
        );
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError(NETWORK_ERROR);
      setLoading(false);
    }
  }

  const submitDisabled = loading || lockSeconds > 0;

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-md space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {mode === "signup"
          ? "Start your compliance journey."
          : "Sign in to your ShieldFlow workspace."}
      </p>

      <div>
        <label className="mb-1 block text-sm font-medium">Email</label>
        <input
          type="email"
          required
          maxLength={MAX_EMAIL}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            // A new keystroke invalidates any earlier "did you mean" hint and warning.
            if (suggestion) setSuggestion(null);
            if (typoWarned) setTypoWarned(false);
          }}
          onBlur={() => setSuggestion(suggestEmailCorrection(email))}
          className="input"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {suggestion && (
          <p className="mt-1 text-xs text-muted-foreground">
            Did you mean{" "}
            <button
              type="button"
              onClick={() => {
                setEmail(suggestion);
                setSuggestion(null);
                setError(null);
              }}
              className="font-medium text-foreground underline"
            >
              {suggestion}
            </button>
            ?
          </p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Password</label>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            // Enforce the 8-char floor only when creating a credential. On login,
            // matching an existing password — a legacy/shorter one must still submit.
            minLength={mode === "signup" ? 8 : undefined}
            maxLength={MAX_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyUp={(e) => setCapsOn(e.getModifierState?.("CapsLock") ?? false)}
            className="input pr-10"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {capsOn && (
          <p className="mt-1 text-xs text-warning">Caps Lock is on.</p>
        )}
        {mode === "signup" && (
          <p className="mt-1 text-xs text-muted-foreground">At least 8 characters.</p>
        )}
        {mode === "login" && (
          <div className="mt-1 text-right">
            <Link href="/forgot-password" className="text-xs text-muted-foreground underline hover:text-foreground">
              Forgot password?
            </Link>
          </div>
        )}
      </div>

      {/* Custom checkbox — matches the navy primary button style */}
      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground select-none">
        <span
          role="checkbox"
          aria-checked={rememberMe}
          tabIndex={submitDisabled ? -1 : 0}
          onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!submitDisabled) setRememberMe((v) => !v); } }}
          onClick={() => { if (!submitDisabled) setRememberMe((v) => !v); }}
          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors
            ${rememberMe
              ? "border-[var(--brand-navy)] bg-[var(--brand-navy)]"
              : "border-border bg-card hover:border-[var(--brand-navy)]"}
            ${submitDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
          `}
        >
          {rememberMe && (
            <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1,4 3.5,6.5 9,1" />
            </svg>
          )}
        </span>
        Remember me on this device
      </label>

      {info && <Alert variant="success">{info}</Alert>}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button type="submit" disabled={submitDisabled} fullWidth>
        {lockSeconds > 0
          ? `Try again in ${lockSeconds}s`
          : loading
            ? "Please wait..."
            : mode === "signup"
              ? "Sign up"
              : "Sign in"}
      </Button>

      {mode === "signup" && (
        <p className="text-center text-xs text-muted-foreground">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="underline hover:text-foreground">Terms</Link> and{" "}
          <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
        </p>
      )}

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Button type="button" variant="outline" onClick={googleSignIn} disabled={loading} fullWidth>
        <svg className="mr-2 inline h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.44.35-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.16-3.16A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
        </svg>
        Continue with Google
      </Button>

      {mode === "login" && (
        <Button
          type="button"
          onClick={magicLink}
          disabled={loading || linkCooldown}
          variant="outline"
          fullWidth
        >
          {linkCooldown ? "Link sent — check your inbox" : "Email me a sign-in link"}
        </Button>
      )}

      {SSO_LOGIN_ENABLED && mode === "login" && (
        <Button type="button" variant="outline" onClick={ssoSignIn} disabled={loading} fullWidth>
          Sign in with SSO
        </Button>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {mode === "signup" ? (
          <>Already have an account?{" "}
          <Link href={`/login${nextQuery}`} className="text-foreground underline">Sign in</Link></>
        ) : (
          <>New to ShieldFlow?{" "}
          <Link href={`/signup${nextQuery}`} className="text-foreground underline">Create account</Link></>
        )}
      </p>
    </form>
  );
}
