/**
 * CSV-injection guard: a value starting with = + - @ executes as a formula
 * when the report is opened in Excel/Sheets. External data (Google emails,
 * GitHub repo names, org unit paths) can carry these — prefix with ' so
 * spreadsheet apps treat them as text. Also strip the delimiter/quotes/
 * newlines since our reports are built by simple joining.
 */
export function csvSafe(value: string): string {
  const cleaned = value.replace(/[",\r\n]/g, " ").trim();
  return /^[=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
}
