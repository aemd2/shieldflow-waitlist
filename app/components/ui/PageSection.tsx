import { cn } from "@/lib/cn";
import { SectionLabel } from "./SectionLabel";

/**
 * Groups related blocks under the shared uppercase section label.
 * Used on integrations, settings-style layouts, and other multi-section pages.
 */
export function PageSection({
  title,
  children,
  className,
  contentClassName,
  columns = 1,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  columns?: 1 | 2;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <SectionLabel>{title}</SectionLabel>
      <div
        className={cn(
          columns === 2 ? "grid gap-4 lg:grid-cols-2" : "space-y-4",
          contentClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
