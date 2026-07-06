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

export interface ParsedRosterRow {
  subject: string;
  access: string;
}

/**
 * Parse the 2-column roster template (subject,access) used by the access
 * review CSV upload. Deliberately naive — no quoted-field/embedded-comma
 * support, matching how this app already parses pasted roster text elsewhere.
 * Tolerates a header row, blank lines, and \r\n or \n line endings.
 */
export function parseRosterCsv(csvText: string): ParsedRosterRow[] {
  const lines = csvText.split(/\r\n|\n/).map((l) => l.trim()).filter(Boolean);
  const rows: ParsedRosterRow[] = [];
  for (const line of lines) {
    const [rawSubject, rawAccess = ""] = line.split(",");
    const subject = (rawSubject ?? "").trim();
    const access = rawAccess.trim();
    if (!subject) continue;
    if (subject.toLowerCase() === "subject" && access.toLowerCase() === "access") continue; // header row
    rows.push({ subject, access });
  }
  return rows;
}

export interface ParsedPersonnelRow {
  name: string;
  email: string;
  role_title: string;
  started_at: string;
}

/**
 * Parse the 4-column personnel template (name,email,role_title,started_at).
 * Same naive-split philosophy as parseRosterCsv — no quoted-field support.
 * Only `name` is required; the other three may be blank.
 */
export function parsePersonnelCsv(csvText: string): ParsedPersonnelRow[] {
  const lines = csvText.split(/\r\n|\n/).map((l) => l.trim()).filter(Boolean);
  const rows: ParsedPersonnelRow[] = [];
  for (const line of lines) {
    const [rawName, rawEmail = "", rawRole = "", rawStarted = ""] = line.split(",");
    const name = (rawName ?? "").trim();
    const email = rawEmail.trim();
    const role_title = rawRole.trim();
    const started_at = rawStarted.trim();
    if (!name) continue;
    if (name.toLowerCase() === "name" && email.toLowerCase() === "email") continue; // header row
    rows.push({ name, email, role_title, started_at });
  }
  return rows;
}
