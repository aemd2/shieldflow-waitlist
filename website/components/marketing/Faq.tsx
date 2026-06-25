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
          <div key={i} className="card p-0">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="text-base font-medium text-foreground">{f.q}</span>
              {isOpen ? (
                <Minus className="h-5 w-5 shrink-0 text-[var(--brand-emerald)]" />
              ) : (
                <Plus className="h-5 w-5 shrink-0 text-muted-foreground" />
              )}
            </button>
            {isOpen && (
              <div className="px-5 pb-5 text-[15px] leading-relaxed text-muted-foreground">
                {f.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
