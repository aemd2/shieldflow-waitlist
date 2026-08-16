"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { redeemTrial } from "@/app/actions/trial";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

/** Final step of a Tester invite: the workspace exists, so claim the trial. */
export function TrialClaim({
  code,
  days,
  email,
  companyName,
}: {
  code: string;
  days: number;
  email: string;
  companyName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await redeemTrial(code);
      if (res?.error) {
        setError(res.error);
        setLoading(false);
        return;
      }
      // Full navigation, not router.push — the plan is resolved in the app
      // shell, so we want a clean server render rather than a cached one.
      window.location.href = "/dashboard?trial=started";
    } catch {
      setError("Network problem — please try again.");
      setLoading(false);
    }
  }

  async function switchAccount() {
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    window.location.href = `/login?next=${encodeURIComponent(`/trial/${code}`)}`;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary p-6">
      <div className="card w-full max-w-md space-y-4 text-center">
        <Sparkles className="mx-auto h-8 w-8 text-[var(--brand-emerald)]" />
        <h1 className="text-2xl font-semibold text-foreground">
          Start your {days}-day trial
        </h1>
        <p className="text-sm text-muted-foreground">
          This unlocks every ShieldFlow feature for{" "}
          <span className="font-medium text-foreground">{companyName}</span> for {days} days — no
          card, no charge. Afterwards the workspace moves to the Free plan and keeps all its data.
        </p>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
            {error}
          </div>
        )}

        <Button onClick={claim} loading={loading} fullWidth>
          {loading ? "Starting…" : `Start my ${days} days`}
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
