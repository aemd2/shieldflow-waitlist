"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { visibleNav, type NavRole } from "./nav-items";

export function Sidebar({ companyName, role }: { companyName: string; role: NavRole | null }) {
  const pathname = usePathname();
  const items = visibleNav(role);
  return (
    <aside className="hidden w-60 flex-col border-r border-border bg-card p-4 md:flex print:hidden">
      <div className="mb-6 flex items-center gap-2">
        <BrandMark className="h-7 w-7 shrink-0" />
        <div className="min-w-0">
          <div className="text-base font-bold text-foreground">ShieldFlow</div>
          <div className="truncate text-xs text-muted-foreground">{companyName}</div>
        </div>
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
  );
}
