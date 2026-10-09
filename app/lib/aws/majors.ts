/** "8.0.35" → "8.0" (MySQL family), "15.4" → "15" (PostgreSQL family). */
export function majorVersion(engine: string, version: string): string {
  const parts = version.split(".");
  return /postgres/i.test(engine) ? parts[0] : parts.slice(0, 2).join(".");
}
