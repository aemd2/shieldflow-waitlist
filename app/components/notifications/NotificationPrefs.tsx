"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
} from "@/lib/validation";
import { updateNotificationPref } from "@/app/actions/notifications";
import type { NotificationPref } from "@/lib/db/queries";

type Pref = { email: boolean; inApp: boolean };
type PrefMap = Record<string, Pref>;

const NETWORK = "Network problem — check your connection and try again.";

export function NotificationPrefs({
  prefs,
  readOnly = false,
}: {
  prefs: NotificationPref[];
  readOnly?: boolean;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [map, setMap] = useState<PrefMap>(() => {
    const m: PrefMap = {};
    for (const c of NOTIFICATION_CATEGORIES) m[c] = { email: true, inApp: true }; // missing row = opted in
    for (const p of prefs) m[p.type] = { email: p.email_enabled, inApp: p.in_app_enabled };
    return m;
  });

  function toggle(type: NotificationCategory, field: keyof Pref) {
    if (readOnly) return; // auditors are read-only — never write
    const prev = map[type];
    const next = { ...prev, [field]: !prev[field] };
    setMap((m) => ({ ...m, [type]: next })); // optimistic
    start(async () => {
      const res = await updateNotificationPref({
        type,
        email_enabled: next.email,
        in_app_enabled: next.inApp,
      }).catch(() => ({ error: NETWORK }));
      if (res?.error) {
        toast("error", res.error);
        setMap((m) => ({ ...m, [type]: prev })); // revert on failure
      }
    });
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
        <p className="text-xs text-muted-foreground">
          {readOnly
            ? "These are read-only for auditor access — you can't change notification settings."
            : "Choose how you hear about each kind of update. Email is sent only when enabled."}
        </p>
      </div>

      <div>
        <div className="grid grid-cols-[1fr_3rem_3rem] items-center gap-3 px-1 pb-1 text-xs font-medium text-muted-foreground">
          <span>Category</span>
          <span className="text-center">In-app</span>
          <span className="text-center">Email</span>
        </div>
        <div className="divide-y divide-border">
          {NOTIFICATION_CATEGORIES.map((c) => (
            <div key={c} className="grid grid-cols-[1fr_3rem_3rem] items-center gap-3 px-1 py-2">
              <span className="text-sm text-foreground">{NOTIFICATION_CATEGORY_LABELS[c]}</span>
              <div className="flex justify-center">
                <Toggle
                  checked={map[c].inApp}
                  disabled={pending || readOnly}
                  label={`In-app ${NOTIFICATION_CATEGORY_LABELS[c]}`}
                  onChange={() => toggle(c, "inApp")}
                />
              </div>
              <div className="flex justify-center">
                <Toggle
                  checked={map[c].email}
                  disabled={pending || readOnly}
                  label={`Email ${NOTIFICATION_CATEGORY_LABELS[c]}`}
                  onChange={() => toggle(c, "email")}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Small navy checkbox matching the auth form's custom checkbox style. */
function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
        checked
          ? "border-[var(--brand-navy)] bg-[var(--brand-navy)]"
          : "border-border bg-card hover:border-[var(--brand-navy)]"
      } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      {checked && (
        <svg
          viewBox="0 0 10 8"
          className="h-3 w-3 text-white"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="1,4 3.5,6.5 9,1" />
        </svg>
      )}
    </button>
  );
}
