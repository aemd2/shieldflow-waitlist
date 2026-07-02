"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { visibleNav, type NavRole } from "./nav-items";

// The mobile counterpart to the desktop Sidebar: a hamburger button that opens
// a slide-out drawer. Shown only below the `md` breakpoint (the Sidebar takes
// over at ≥768px), so navigation is reachable at every screen width.
export function MobileNav({
  companyName,
  role,
  sprintReady = false,
}: {
  companyName: string;
  role: NavRole | null;
  sprintReady?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const items = visibleNav(role, sprintReady);

  // Close the drawer whenever the route changes (e.g. after a link click).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While the drawer is open: lock body scroll and let Esc close it.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="md:hidden print:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex items-center rounded-md p-2 hover:bg-secondary"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="relative flex w-64 max-w-[80%] flex-col border-r border-border bg-card p-4">
            <div className="mb-6 flex items-start justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <BrandMark className="h-7 w-7 shrink-0" />
                <div className="min-w-0">
                  <div className="text-base font-bold text-foreground">ShieldFlow</div>
                  <div className="truncate text-xs text-muted-foreground">{companyName}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1 hover:bg-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="space-y-1 text-sm">
              {items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors ${
                      active ? "bg-secondary font-medium text-foreground" : "hover:bg-secondary"
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}
    </div>
  );
}
