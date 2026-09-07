"use client";

import { useState, useTransition } from "react";
import { Ban, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { dismissIdentityAccount, restoreIdentityAccount } from "@/app/actions/identity";

interface Props {
  emails: string[];
  dismissed: { email: string; reason: string | null }[];
  canWrite: boolean;
}

/**
 * Accounts that exist at the identity provider but match nobody in Personnel.
 *
 * This lives on the Personnel page rather than on a control page on purpose: the
 * check fires against 13 controls across six frameworks, and the fix is always
 * the same one thing — reconcile the roster. Putting the action where the roster
 * is means one place to resolve it, not thirteen.
 *
 * Two ways out, and both are legitimate answers to the auditor's question:
 * add the person, or record that the account isn't a person.
 */
export function UnmatchedAccounts({ emails, dismissed, canWrite }: Props) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  // Optimistic: hide the row immediately, put it back if the server disagrees.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);

  const visible = emails.filter((e) => !hidden.has(e));

  function dismiss(email: string) {
    setHidden((prev) => new Set(prev).add(email));
    startTransition(async () => {
      const res = await dismissIdentityAccount(email);
      if (res?.error) {
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(email);
          return next;
        });
        toast("error", res.error);
        return;
      }
      toast("success", `${email} marked as not a person.`, {
        label: "Undo",
        onClick: () => restore(email),
      });
    });
  }

  function restore(email: string) {
    startTransition(async () => {
      const res = await restoreIdentityAccount(email);
      if (res?.error) {
        toast("error", res.error);
        return;
      }
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(email);
        return next;
      });
      toast("success", `${email} will be checked again on the next sync.`);
    });
  }

  if (visible.length === 0 && dismissed.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Accounts with nobody behind them{" "}
          {visible.length > 0 && (
            <span className="text-muted-foreground">({visible.length})</span>
          )}
        </h2>
        {dismissed.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDismissed((s) => !s)}
            className="text-xs text-muted-foreground underline"
          >
            {showDismissed ? "Hide" : `${dismissed.length} marked as not a person`}
          </button>
        )}
      </div>

      {visible.length > 0 ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            These accounts can still sign in but match nobody on this page. Add the person, or
            record that the account isn&rsquo;t one — an auditor will ask either way.
          </p>
          <ul className="mt-3 divide-y divide-border">
            {visible.map((email) => (
              <li key={email} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 break-all text-sm text-foreground">{email}</span>
                {canWrite && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    leftIcon={<Ban className="h-3.5 w-3.5" />}
                    onClick={() => dismiss(email)}
                  >
                    Not a person
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          Every account at your identity provider matches someone on this page.
        </p>
      )}

      {showDismissed && dismissed.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-t border-border pt-2">
          {dismissed.map((d) => (
            <li key={d.email} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 break-all text-sm text-muted-foreground">
                {d.email}
                {d.reason && <span className="ml-2 text-xs">— {d.reason}</span>}
              </span>
              {canWrite && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  leftIcon={<Undo2 className="h-3.5 w-3.5" />}
                  onClick={() => restore(d.email)}
                >
                  Check again
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
