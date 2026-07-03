import { cn } from "@/lib/cn";

/**
 * Shared page shell for every authenticated route.
 * Keeps vertical rhythm, max-width, and full-height chat layouts consistent.
 */
export type AppPageWidth = "full" | "narrow" | "compact" | "document" | "fill";

const WIDTH: Record<AppPageWidth, string> = {
  full: "",
  narrow: "mx-auto max-w-3xl",
  compact: "mx-auto max-w-2xl",
  document: "mx-auto max-w-4xl",
  fill: "mx-auto flex h-[calc(100vh-8rem)] max-w-3xl min-h-0 flex-col gap-6",
};

export function AppPage({
  width = "full",
  className,
  children,
}: {
  width?: AppPageWidth;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        width === "fill" ? WIDTH.fill : cn("space-y-6", WIDTH[width]),
        className,
      )}
    >
      {children}
    </div>
  );
}
