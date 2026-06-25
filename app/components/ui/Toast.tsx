"use client";

import { createContext, useCallback, useContext, useState } from "react";

type ToastKind = "success" | "error";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<(kind: ToastKind, message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    // Keep only the newest 4 — rapid-fire errors must not wallpaper the screen.
    setItems((prev) => [...prev, { id, kind, message }].slice(-4));
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 print:hidden">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`max-w-sm rounded-md px-4 py-3 text-sm shadow-lg ${
              t.kind === "success"
                ? "bg-[var(--brand-emerald)] text-[var(--accent-foreground)]"
                : "bg-destructive text-destructive-foreground"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
