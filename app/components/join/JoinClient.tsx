"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { acceptInvite } from "@/app/actions/team";
import { createBrowserSupabase } from "@/lib/supabase/client";

export function JoinClient({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    start(async () => {
      setError(null);
      const res = await acceptInvite(token).catch(() => ({
        error: "Network problem — please try again.",
      }));
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  async function switchAccount() {
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    router.push(`/login?next=${encodeURIComponent(`/join?token=${token}`)}`);
    router.refresh();
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

        <button onClick={accept} disabled={pending} className="btn-primary w-full">
          {pending ? "Joining..." : "Accept invitation"}
        </button>
        <button
          type="button"
          onClick={switchAccount}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Not {email}? Sign in with a different account
        </button>
      </div>
    </div>
  );
}
