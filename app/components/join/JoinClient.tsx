"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { acceptInvite } from "@/app/actions/team";
import { createBrowserSupabase } from "@/lib/supabase/client";

export function JoinClient({ token, email }: { token: string; email: string }) {
  const [loading, setLoading] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (loading || joined) return;
    setError(null);
    setLoading(true);
    const res = await acceptInvite(token).catch(() => ({
      error: "Network problem — please try again.",
    }));
    if ("error" in res && res.error) {
      setError(res.error);
      setLoading(false);
      return;
    }
    // Confirm success immediately. The dashboard is a heavy page that can take a
    // few seconds to render; without this the button would sit on "Joining…" the
    // whole time and look frozen even though the membership is already created.
    setJoined(true);
    // Hard redirect so the server issues a fresh request and picks up the new
    // company_members row — client-side router.push can race a cached session.
    window.location.href = "/dashboard";
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

        <button onClick={accept} disabled={loading || joined} className="btn-primary w-full">
          {joined ? "Joined ✓ — taking you in…" : loading ? "Joining…" : "Accept invitation"}
        </button>
        {!joined && (
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
