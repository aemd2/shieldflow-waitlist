"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { visibleNavSections, type NavRole } from "./nav-items";

export function Sidebar({
  companyName,
  role,
  sprintReady = false,
}: {
  companyName: string;
  role: NavRole | null;
  sprintReady?: boolean;
}) {
  const pathname = usePathname();
  const sections = visibleNavSections(role, sprintReady);
  return (
    <aside className="hidden h-full w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-card p-4 md:flex print:hidden">
      <div className="mb-6 flex shrink-0 items-center gap-2">
        <BrandMark className="h-7 w-7 shrink-0" />
        <div className="min-w-0">
          <div className="text-base font-bold text-foreground">ShieldFlow</div>
          <div className="truncate text-xs text-muted-foreground">{companyName}</div>
        </div>
      </div>
      <nav className="space-y-4 text-sm">
        {sections.map((section, i) => (
          <div key={section.label ?? i}>
            {section.label && (
              <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.label}
              </div>
            )}
            <div className="space-y-1">
              {section.items.map(({ href, label, icon: Icon }) => {
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
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
