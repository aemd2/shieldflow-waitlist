"use client";

import { useState } from "react";
import { createCompanyAndOnboard } from "@/app/actions/onboarding";
import { Button } from "@/components/ui/Button";
import type { Framework } from "@/lib/db/queries";

export function OnboardingForm({ frameworks }: { frameworks: Framework[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string>(frameworks[0]?.id ?? "");

  async function action(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createCompanyAndOnboard(formData);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <form action={action} className="card space-y-6">
      <div>
        <label className="mb-1 block text-sm font-medium">Company name</label>
        <input
          name="companyName"
          required
          minLength={2}
          maxLength={120}
          className="input"
          placeholder="Acme Inc."
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">Choose a compliance framework</label>
        <input type="hidden" name="frameworkId" value={selected} />
        <div className="grid gap-3 sm:grid-cols-2">
          {frameworks.map((f) => (
            <button
              type="button"
              key={f.id}
              onClick={() => setSelected(f.id)}
              className={`rounded-lg border p-4 text-left transition ${
                selected === f.id
                  ? "border-[var(--brand-emerald)] bg-secondary ring-2 ring-[var(--ring)]"
                  : "border-border hover:bg-secondary"
              }`}
            >
              <div className="font-semibold text-foreground">{f.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{f.description}</div>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button type="submit" disabled={!selected} loading={pending} fullWidth>
        {pending ? "Setting up..." : "Create workspace"}
      </Button>
    </form>
  );
}
