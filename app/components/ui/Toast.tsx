"use client";

import { createContext, useCallback, useContext, useState } from "react";

type ToastKind = "success" | "error";
export interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

type PushToast = (kind: ToastKind, message: string, action?: ToastAction) => void;

const ToastContext = createContext<PushToast>(() => {});

/** `toast("success", "Deleted", { label: "Undo", onClick: () => ... })` — the
 * action makes the toast linger long enough to actually click it. */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<PushToast>((kind, message, action) => {
    const id = Date.now() + Math.random();
    // Keep only the newest 4 — rapid-fire errors must not wallpaper the screen.
    setItems((prev) => [...prev, { id, kind, message, action }].slice(-4));
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), action ? 5000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 print:hidden">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`flex max-w-sm items-center gap-3 rounded-md px-4 py-3 text-sm shadow-lg ${
              t.kind === "success"
                ? "bg-[var(--brand-emerald)] text-[var(--accent-foreground)]"
                : "bg-destructive text-destructive-foreground"
            }`}
          >
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 font-semibold underline underline-offset-2"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
