import { cn } from "@/lib/cn";

/**
 * Master–detail pages — Policies, Questionnaires, Access reviews.
 * Fixed-width sidebar list + flexible detail pane.
 */
export function WorkspaceLayout({
  header,
  sidebar,
  children,
  sidebarWidth = "md",
}: {
  header?: React.ReactNode;
  sidebar: React.ReactNode;
  children: React.ReactNode;
  sidebarWidth?: "md" | "lg";
}) {
  const cols =
    sidebarWidth === "lg" ? "lg:grid-cols-[320px_1fr]" : "lg:grid-cols-[300px_1fr]";

  return (
    <div className="space-y-4">
      {header ? <div className="flex justify-end">{header}</div> : null}
      <div className={cn("grid gap-6", cols)}>
        <div className="space-y-4">{sidebar}</div>
        <div>{children}</div>
      </div>
    </div>
  );
}

/** Left-pane list card shell used by every workspace page. */
export function SidebarListPanel({
  title,
  emptyMessage = "None yet.",
  isEmpty,
  children,
}: {
  title: string;
  emptyMessage?: string;
  isEmpty?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="card p-0">
      <div className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">
        {title}
      </div>
      {isEmpty ? (
        <div className="px-5 py-6 text-center text-xs text-muted-foreground">{emptyMessage}</div>
      ) : (
        <ul className="divide-y divide-border">{children}</ul>
      )}
    </div>
  );
}

export function SidebarListButton({
  selected,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center justify-between gap-2 px-5 py-3 text-left text-sm hover:bg-secondary",
          selected && "bg-secondary",
        )}
      >
        {children}
      </button>
    </li>
  );
}

/** Right-pane placeholder when nothing is selected. */
export function WorkspaceDetailEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="card flex h-full min-h-64 items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
