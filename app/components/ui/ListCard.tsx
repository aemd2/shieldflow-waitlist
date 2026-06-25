import { cn } from "@/lib/cn";

/** The shared "card with a divided list of rows" shell (vendors, risks, training, evidence). */
export function ListCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("card p-0", className)}>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

export function ListRow({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-center justify-between gap-4 px-5 py-3", className)}>{children}</li>
  );
}
