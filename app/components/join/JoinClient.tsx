"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { acceptInvite } from "@/app/actions/team";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export function JoinClient({ token, email }: { token: string; email: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      // On success the server action calls redirect("/dashboard") — Next.js
      // sends the redirect instruction to the browser directly, which is more
      // reliable than client-side router.push or window.location (avoids the
      // router-cache race that kept the page stuck).
      // On error it returns { error: string } — we show that below.
      const res = await acceptInvite(token);
      if (res && "error" in res) {
        setError(res.error);
        setLoading(false);
      }
      // No else — if we're still here the redirect is in flight.
    } catch {
      setError("Network problem — please try again.");
      setLoading(false);
    }
  }

  async function switchAccount() {
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    window.location.href = `/login?next=${encodeURIComponent(`/join?token=${token}`)}`;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary p-6">
      <div className="card w-full max-w-md space-y-4 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-[var(--brand-emerald)]" />
        <h1 className="text-2xl font-semibold text-foreground">Join the workspace</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re signed in as <span className="font-medium text-foreground">{email}</span>.
          Accept your invitation to join this ShieldFlow workspace.
        </p>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
            {error}
          </div>
        )}

        <Button onClick={accept} loading={loading} fullWidth>
          {loading ? "Joining…" : "Accept invitation"}
        </Button>

        {!loading && (
          <button
            type="button"
            onClick={switchAccount}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Not {email}? Sign in with a different account
          </button>
        )}
      </div>
    </div>
  );
}
