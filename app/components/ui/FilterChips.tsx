import Link from "next/link";
import { cn } from "@/lib/cn";

export type FilterChip = {
  label: string;
  /** When omitted, the chip represents "all" / no filter. */
  value?: string;
  href: string;
};

/**
 * Link-based filter pills — same look on Activity and any future filtered lists.
 */
export function FilterChips({
  items,
  activeValue,
  className,
}: {
  items: FilterChip[];
  activeValue?: string;
  className?: string;
}) {
  return (
    <nav className={cn("flex flex-wrap gap-2", className)}>
      {items.map((item) => {
        const isActive = item.value === activeValue;
        return (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              "rounded-full px-3 py-1 text-sm transition-colors",
              isActive
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
