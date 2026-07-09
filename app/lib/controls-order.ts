// Shared "display order" for controls — the same grouping ControlList uses
// to render category sections, extracted so the control detail page's
// Previous/Next (see app/(app)/controls/[id]/page.tsx) walks controls in
// the exact order a user sees scrolling the dashboard list, not just a flat
// code sort (which would interleave categories).

export function groupControlsByCategory<T extends { category: string | null }>(
  controls: T[],
): Map<string, T[]> {
  const byCategory = new Map<string, T[]>();
  for (const c of controls) {
    const key = c.category ?? "Uncategorized";
    const list = byCategory.get(key);
    if (list) list.push(c);
    else byCategory.set(key, [c]);
  }
  return byCategory;
}

export function flattenControlOrder<T extends { category: string | null }>(controls: T[]): T[] {
  return Array.from(groupControlsByCategory(controls).values()).flat();
}
