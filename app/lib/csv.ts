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

// ---------------------------------------------------------------------------
// Personnel import parser. Real HR/IT exports are messy — different column
// orders, First/Last name split, employee-ID columns, semicolon delimiters
// (EU Excel), quoted fields, UTF-8 BOM, non-English headers. Competitors
// (Drata) reject anything but their exact template; we map columns instead.
// Pure functions, no dependencies — also imported client-side by the
// bulk-add paste box so paste and upload share one code path.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** "alice.smith" -> "Alice Smith". Non-ASCII locals pass through uncapitalized
 * rather than mangled. Also used when a Team invite creates a Personnel row. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._+-]/)
    .filter(Boolean)
    .map((s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s))
    .join(" ");
}

/** Split one line on a delimiter, honoring "quoted, fields" and doubled quotes. */
function splitDelimited(line: string, delim: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/** Pick the delimiter that appears most across the first few lines —
 * counted outside quoted sections, so `"Doe, Jane";...` still picks `;`. */
function sniffDelimiter(lines: string[]): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = lines
      .slice(0, 5)
      .reduce((sum, l) => sum + (l.replace(/"[^"]*"/g, "").split(d).length - 1), 0);
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

// Header aliases (normalized: lowercase, spaces/underscores/dashes stripped).
// The alias list is an accelerator, not the decider — content-based detection
// below handles headers in languages this list has never heard of.
const HEADER_ALIASES: Record<string, "name" | "first" | "last" | "email" | "role" | "started" | "ignore"> = {
  // name — note: several of these mean *surname* when they appear NEXT TO a
  // first-name column (French Nom, German Name, Italian Nome, Turkish Ad);
  // the pairing rules after header mapping resolve that.
  name: "name", fullname: "name", employeename: "name", employee: "name",
  nom: "name", nombre: "name", nome: "name", naam: "name", ad: "name",
  име: "name", имя: "name",
  // first / last (joined)
  firstname: "first", givenname: "first", vorname: "first", prénom: "first", prenom: "first",
  voornaam: "first", imię: "first", imie: "first",
  lastname: "last", surname: "last", familyname: "last", nachname: "last",
  cognome: "last", soyad: "last", achternaam: "last", apellido: "last", apellidos: "last",
  sobrenome: "last", nazwisko: "last", фамилия: "last",
  // email
  email: "email", "e-mail": "email", mail: "email", emailaddress: "email",
  workemail: "email", courriel: "email", correo: "email", имейл: "email", почта: "email",
  eposta: "email",
  // role
  role: "role", roletitle: "role", title: "role", jobtitle: "role", position: "role",
  pozisyon: "role", functie: "role", ruolo: "role", cargo: "role", stanowisko: "role",
  puesto: "role", funktion: "role", длъжност: "role", должность: "role",
  // started_at
  started: "started", startedat: "started", startdate: "started", hiredate: "started", joined: "started",
  // known noise — mapped to nothing instead of polluting name
  id: "ignore", employeeid: "ignore", number: "ignore", phone: "ignore", phonenumber: "ignore",
  department: "ignore", status: "ignore", location: "ignore", manager: "ignore", mfa: "ignore",
};

function normalizeHeader(cell: string): string {
  return cell.toLowerCase().replace(/[\s_-]/g, "");
}

/** Accept YYYY-MM-DD as-is; convert unambiguous D/M/Y variants; else "". */
function normalizeDate(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/);
  if (!m) return "";
  const [, a, b, c] = m;
  const pad = (s: string) => s.padStart(2, "0");
  if (a.length === 4) return `${a}-${pad(b)}-${pad(c)}`; // 2026/01/15
  if (c.length === 4) {
    const first = Number(a);
    const second = Number(b);
    // One part > 12 disambiguates day vs month; ambiguous dates are dropped
    // rather than guessed wrong (US vs EU order).
    if (first > 12 && second <= 12) return `${c}-${pad(b)}-${pad(a)}`; // 15.01.2026
    if (second > 12 && first <= 12) return `${c}-${pad(a)}-${pad(b)}`; // 01/15/2026
  }
  return "";
}

function looksLikeDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(v);
}

type ColumnRole = "name" | "first" | "last" | "email" | "role" | "started" | "ignore";

/** Classify columns by content when there's no recognizable header row.
 * `null` = unassigned (candidate text column); "ignore" = actively excluded
 * (numeric IDs, phone numbers) so it can never be mistaken for a name. */
function inferColumns(rows: string[][]): ColumnRole[] {
  const width = Math.max(...rows.map((r) => r.length));
  const assigned: (ColumnRole | null)[] = new Array(width).fill(null);

  const share = (idx: number, test: (v: string) => boolean) => {
    const values = rows.map((r) => (r[idx] ?? "").trim()).filter(Boolean);
    if (values.length === 0) return 0;
    return values.filter(test).length / values.length;
  };

  // Email first — it's the most recognizable signal.
  let emailIdx = -1;
  let emailBest = 0;
  for (let i = 0; i < width; i++) {
    const s = share(i, (v) => EMAIL_RE.test(v));
    if (s > 0.5 && s > emailBest) {
      emailIdx = i;
      emailBest = s;
    }
  }
  if (emailIdx >= 0) assigned[emailIdx] = "email";

  for (let i = 0; i < width; i++) {
    if (i === emailIdx) continue;
    if (share(i, looksLikeDate) > 0.5) assigned[i] = "started";
    else if (share(i, (v) => /^[\d\s()+-]+$/.test(v)) > 0.5) assigned[i] = "ignore"; // IDs / phones
  }

  // Remaining unassigned text columns: first -> name, second -> role.
  const textCols = assigned.map((r, i) => (r === null ? i : -1)).filter((i) => i >= 0);
  if (textCols.length > 0) assigned[textCols[0]] = "name";
  if (textCols.length > 1) assigned[textCols[1]] = "role";
  return assigned.map((r) => r ?? "ignore");
}

/**
 * Parse a personnel list — CSV upload or pasted text — into rows. Handles:
 * quoted fields, comma/semicolon/tab/pipe delimiters, UTF-8 BOM, a header
 * row in any language (detected by aliases OR by content mismatch with the
 * data below), any column order, First+Last name splits, ID/phone columns
 * (ignored), and rows missing a name (derived from the email). Only `name`
 * ends up required; other fields may be blank.
 */
export function parsePersonnelCsv(csvText: string): ParsedPersonnelRow[] {
  const text = csvText.replace(/^\uFEFF/, ""); // Excel's UTF-8 BOM
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const delim = sniffDelimiter(lines);
  const grid = lines.map((l) => splitDelimited(l, delim));

  // --- Header detection -----------------------------------------------------
  const headerCells = grid[0].map(normalizeHeader);
  const aliasHits = headerCells.filter((c) => c in HEADER_ALIASES).length;
  let roles: ColumnRole[];
  let dataStart: number;

  if (aliasHits >= 1 && aliasHits >= Math.ceil(headerCells.filter(Boolean).length / 2)) {
    // Recognized header row (at least half the non-empty cells are known names).
    roles = grid[0].map((c) => HEADER_ALIASES[normalizeHeader(c)] ?? "ignore");
    // Pairing rules: many languages label the surname column with their word
    // for "name" — French Prénom/Nom, German Vorname/Name, Turkish Ad/Soyad,
    // Italian Nome/Cognome. When a first-name column exists, a "name" column
    // is the surname (and vice versa) — otherwise the given name would be
    // silently dropped in favor of the surname-as-full-name.
    if (roles.includes("first") && roles.includes("name") && !roles.includes("last")) {
      roles = roles.map((r) => (r === "name" ? "last" : r));
    } else if (roles.includes("last") && roles.includes("name") && !roles.includes("first")) {
      roles = roles.map((r) => (r === "name" ? "first" : r));
    }
    dataStart = 1;
  } else {
    // No recognizable header — classify columns by their content.
    const body = grid.length > 1 ? grid.slice(1) : grid;
    roles = inferColumns(body);
    // Language-independent header check: if the column the data says is
    // "email" has a non-email first cell (e.g. "E-Mail", "Имейл"), row 0 is
    // a header in a language the alias list doesn't know. Same for dates.
    const emailIdx = roles.indexOf("email");
    const startedIdx = roles.indexOf("started");
    const firstRowIsHeader =
      grid.length > 1 &&
      ((emailIdx >= 0 && Boolean(grid[0][emailIdx]) && !EMAIL_RE.test(grid[0][emailIdx])) ||
        (emailIdx < 0 && startedIdx >= 0 && Boolean(grid[0][startedIdx]) && !looksLikeDate(grid[0][startedIdx])));
    dataStart = firstRowIsHeader ? 1 : 0;
    if (dataStart === 0) roles = inferColumns(grid);
  }

  // --- Row extraction --------------------------------------------------------
  const rows: ParsedPersonnelRow[] = [];
  for (let r = dataStart; r < grid.length; r++) {
    const cells = grid[r];
    if (cells.every((c) => !c)) continue;

    let name = "";
    let first = "";
    let last = "";
    let email = "";
    let role_title = "";
    let started_at = "";

    for (let i = 0; i < cells.length; i++) {
      const value = (cells[i] ?? "").trim();
      if (!value) continue;
      switch (roles[i]) {
        case "name": if (!name) name = value; break;
        case "first": first = value; break;
        case "last": last = value; break;
        case "email": if (!email && EMAIL_RE.test(value)) email = value; break;
        case "role": if (!role_title) role_title = value; break;
        case "started": if (!started_at) started_at = normalizeDate(value); break;
      }
    }

    if (!name && (first || last)) name = [first, last].filter(Boolean).join(" ");
    if (!name && email) name = nameFromEmail(email);
    if (!name) continue;
    rows.push({ name, email, role_title, started_at });
  }
  return rows;
}
