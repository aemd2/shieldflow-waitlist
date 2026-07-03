"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export function ForgotPasswordForm() {
  const supabase = createBrowserSupabase();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const cleanEmail = email.trim().toLowerCase();
    await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/api/auth/confirm?next=/reset-password`,
    });

    // Always show the same message regardless of whether the account exists —
    // a different response would let anyone enumerate registered emails.
    setSent(true);
    setLoading(false);
  }

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-md space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">Reset your password</h1>
      <p className="text-sm text-muted-foreground">
        Enter your account email and we&apos;ll send you a reset link.
      </p>

      {sent ? (
        <div className="rounded-md border border-[var(--brand-emerald)]/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          If an account exists for that email, a reset link is on its way. Check your inbox.
        </div>
      ) : (
        <>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              autoComplete="email"
            />
          </div>
          <Button type="submit" loading={loading} fullWidth>
            {loading ? "Sending..." : "Send reset link"}
          </Button>
        </>
      )}

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-foreground underline">Back to sign in</Link>
      </p>
    </form>
  );
}
