// Central place to turn Supabase AuthError responses into friendly, actionable
// messages. Matches on the stable `code` first (newer supabase-js) and falls
// back to message text for older/edge responses. The rate-limit cases matter
// most on the Supabase FREE TIER, where the built-in mailer sends only a few
// emails per hour and the auth endpoints throttle aggressively.

export interface AuthErrorLike {
  code?: string;
  status?: number;
  message: string;
}

export function friendlyAuthError(err: AuthErrorLike): string {
  const code = err.code ?? "";
  const msg = err.message ?? "";
  const m = (re: RegExp) => re.test(msg);

  // --- Rate limits (free-tier sensitive) ---
  if (code === "over_email_send_rate_limit" || (m(/rate limit/i) && m(/email/i))) {
    return "Too many emails were just sent from this project. Please wait a few minutes and try again.";
  }
  if (code === "over_request_rate_limit" || code === "over_sms_send_rate_limit" || err.status === 429) {
    return "Too many attempts. Please wait a minute, then try again.";
  }

  // --- Credentials / confirmation ---
  if (code === "invalid_credentials" || m(/invalid login credentials/i)) {
    return "Invalid email or password. Check for typos (and Caps Lock) and try again.";
  }
  if (code === "email_not_confirmed" || m(/email not confirmed/i)) {
    return "Please confirm your email first — check your inbox (and spam).";
  }
  if (code === "user_already_exists" || m(/already registered|already exists/i)) {
    return "An account with this email already exists. Sign in instead — or use “Forgot password” if you can't get in.";
  }

  // --- Password problems ---
  if (code === "weak_password" || m(/weak.?password|password.*(too short|at least)/i)) {
    return "That password is too weak. Use at least 8 characters and mix in letters, numbers, and a symbol.";
  }
  if (code === "same_password" || m(/should be different|new password.*different/i)) {
    return "Your new password must be different from the old one.";
  }

  // --- Email problems ---
  if (code === "email_address_invalid" || m(/invalid.*email|email.*invalid/i)) {
    return "That email address looks invalid. Please double-check it.";
  }
  if (code === "email_address_not_authorized" || m(/not authorized.*email|email.*not authorized/i)) {
    return "This email domain isn't allowed to sign up here. Use your work email or contact support.";
  }

  // --- Config / availability ---
  if (code === "signup_disabled" || m(/signups? not allowed|signup.*disabled/i)) {
    return "New sign-ups are currently turned off. Please contact support for access.";
  }
  if (code === "provider_disabled" || m(/provider is not enabled/i)) {
    return "That sign-in method isn't enabled yet. Use email and password for now.";
  }
  if (code === "captcha_failed" || m(/captcha/i)) {
    return "The bot check failed. Please refresh the page and try again.";
  }

  // Fall back to whatever Supabase said, or a generic line.
  return msg || "Something went wrong. Please try again.";
}
