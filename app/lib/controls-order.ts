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

/**
 * Natural sort for control codes, so "A.5.2" comes before "A.5.10" rather than
 * after it. A plain localeCompare orders ISO 27001's Annex A as A.5.1, A.5.10,
 * A.5.11 … A.5.19, A.5.2 — barely noticeable when the framework had 15 controls,
 * actively confusing at 93. Splits each code into digit and non-digit runs and
 * compares numerically where both sides are numeric.
 *
 * Works for every code shape in the product: "CC6.10", "A.8.34", "Req 10",
 * "164.312(e)(1)", "Art.21.2(a)".
 */
export function compareControlCodes(a: string, b: string): number {
  const split = (s: string) => s.match(/\d+|\D+/g) ?? [];
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) {
    const x = pa[i];
    const y = pb[i];
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    if (nx && ny) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
    } else {
      const diff = x.localeCompare(y);
      if (diff !== 0) return diff;
    }
  }
  return pa.length - pb.length;
}
