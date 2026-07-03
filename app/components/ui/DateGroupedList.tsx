import { cn } from "@/lib/cn";
import { SectionLabel } from "./SectionLabel";
import { ListCard } from "./ListCard";

export type DateGroup<T> = { label: string; items: T[] };

/** Groups rows under Today / Yesterday / … headers — shared by Activity and Evidence. */
export function DateGroupedList<T>({
  groups,
  renderItem,
  className,
}: {
  groups: DateGroup<T>[];
  renderItem: (item: T) => React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-5", className)}>
      {groups.map((group) => (
        <div key={group.label}>
          <SectionLabel className="mb-2 px-1">{group.label}</SectionLabel>
          <ListCard>
            {group.items.map((item) => renderItem(item))}
          </ListCard>
        </div>
      ))}
    </div>
  );
}
