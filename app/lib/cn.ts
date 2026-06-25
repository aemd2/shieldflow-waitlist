type ClassValue = string | number | bigint | boolean | null | undefined;

/** Minimal class-name joiner (clsx-style, no dependency). Falsy values are dropped;
 *  pass `className` last so consumer overrides win. */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
