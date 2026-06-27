"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { faqs } from "@/lib/site";

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="space-y-3">
      {faqs.map((f, i) => {
        const isOpen = open === i;
        return (
          <div
            key={i}
            className={`overflow-hidden rounded-xl border transition-colors ${
              isOpen
                ? "border-[var(--mkt-accent)]/40 bg-white/[0.05]"
                : "border-white/10 bg-white/[0.02] hover:border-white/20"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
            >
              <span className="text-base font-semibold text-white sm:text-lg">{f.q}</span>
              {isOpen ? (
                <Minus className="h-5 w-5 shrink-0 text-[var(--mkt-accent-bright)]" />
              ) : (
                <Plus className="h-5 w-5 shrink-0 text-white/40" />
              )}
            </button>
            {isOpen && (
              <div className="px-5 pb-5 text-[15px] leading-relaxed text-white/65 sm:px-6">
                {f.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
