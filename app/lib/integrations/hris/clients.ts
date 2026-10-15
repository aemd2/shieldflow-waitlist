/**
 * Read the employee list from an HR system, read-only, and normalise it.
 * Personio and HiBob are the common choice in Europe, BambooHR in the US. Each
 * returns current employees *and* leavers with their leaving date — the one
 * thing a hand-kept Personnel list gets wrong.
 */

export type HrisProvider = "personio" | "hibob" | "bamboohr";

export interface HrEmployee {
  externalId: string;
  name: string;
  /** Work email; null when the HR record has none (then accounts can't be matched). */
  email: string | null;
  title: string | null;
  /** YYYY-MM-DD */
  startDate: string | null;
  /** Last working day / termination date, YYYY-MM-DD; may be in the future (notice period). */
  endDate: string | null;
  /** The HR system's own active flag. */
  active: boolean;
}

export interface HrRead {
  employees: HrEmployee[];
  /** More people than one scan reads. */
  truncated: boolean;
  /** Fields the credentials aren't allowed to read (Personio whitelists attributes per credential). */
  missingFields: string[];
}

export class HrisError extends Error {
  constructor(
    public kind: "auth" | "forbidden" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "HrisError";
  }
}

const day = (v: unknown): string | null => {
  if (typeof v !== "string" || !v || v.startsWith("0000")) return null;
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};
const email = (v: unknown): string | null => (typeof v === "string" && v.includes("@") ? v.trim().toLowerCase() : null);

async function call(url: string, init: RequestInit, label: string): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) }).catch(() => {
    throw new HrisError("unavailable", `Couldn't reach ${label}. Please try again.`);
  });
  if (res.status === 401) throw new HrisError("auth", `${label} rejected the credentials — check them, or create new ones, and reconnect.`);
  if (res.status === 403) throw new HrisError("forbidden", `These ${label} credentials can't read employees — give them read access to people (including former employees).`);
  if (res.status === 429) throw new HrisError("unavailable", `${label} rate limit reached. Try again in a minute.`);
  if (!res.ok) throw new HrisError("unavailable", `${label} is unavailable right now (HTTP ${res.status}).`);
  return res;
}

// ------------------------------------------------------------------ Personio

export interface PersonioCreds {
  clientId: string;
  clientSecret: string;
}

type PAttr = { value?: unknown };
const pv = (a: Record<string, PAttr>, k: string) => a[k]?.value;

export async function readPersonio(c: PersonioCreds): Promise<HrRead> {
  const base = "https://api.personio.de/v1";
  const auth = await call(`${base}/auth?client_id=${encodeURIComponent(c.clientId)}&client_secret=${encodeURIComponent(c.clientSecret)}`, { method: "POST", headers: { Accept: "application/json" } }, "Personio");
  const aj = (await auth.json()) as { success?: boolean; data?: { token?: string } };
  let token = aj.data?.token;
  if (!token) throw new HrisError("auth", "Personio rejected the credentials — check the client ID and secret.");

  const employees = new Map<string, HrEmployee>();
  const seenFields = new Set<string>();
  let total = Infinity;
  // Personio's `offset` is an item offset in the docs and a page index in practice
  // on some accounts: start with items, fall back to pages if a call adds nothing new.
  let mode: "items" | "pages" = "items";
  let pageNo = 0;
  for (let i = 0; i < 60 && employees.size < total; i++) {
    const offset = mode === "items" ? employees.size : pageNo;
    const res = await call(`${base}/company/employees?limit=200&offset=${offset}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "X-Personio-App-ID": "SHIELDFLOW" } }, "Personio");
    // v1 may rotate the token on every response.
    const next = res.headers.get("authorization");
    if (next) token = next.replace(/^Bearer\s+/i, "");
    const j = (await res.json()) as { metadata?: { total_elements?: number }; data?: { attributes?: Record<string, PAttr> }[] };
    if (typeof j.metadata?.total_elements === "number") total = j.metadata.total_elements;
    const before = employees.size;
    for (const row of j.data ?? []) {
      const a = row.attributes ?? {};
      for (const k of Object.keys(a)) seenFields.add(k);
      const id = String(pv(a, "id") ?? "");
      if (!id) continue;
      const first = String(pv(a, "preferred_name") || pv(a, "first_name") || "").trim();
      const last = String(pv(a, "last_name") ?? "").trim();
      const end = day(pv(a, "last_working_day")) ?? day(pv(a, "termination_date")) ?? day(pv(a, "contract_end_date"));
      employees.set(id, {
        externalId: id,
        name: `${first} ${last}`.trim() || String(pv(a, "email") ?? id),
        email: email(pv(a, "email")),
        title: (pv(a, "position") as string | undefined) || null,
        startDate: day(pv(a, "hire_date")),
        endDate: end,
        active: String(pv(a, "status") ?? "active").toLowerCase() !== "inactive",
      });
    }
    if (employees.size === before) {
      // The second call added nothing although more exist: offsets are page numbers here.
      if (mode === "items" && i === 1 && employees.size < total) {
        mode = "pages";
        pageNo = 1;
        continue;
      }
      break;
    }
    if (mode === "pages") pageNo++;
  }
  const missingFields = ["email", "status", "hire_date", "termination_date"].filter((f) => seenFields.size && !seenFields.has(f));
  return { employees: [...employees.values()], truncated: Number.isFinite(total) && employees.size < total, missingFields };
}

// --------------------------------------------------------------------- HiBob

export interface HiBobCreds {
  serviceUserId: string;
  token: string;
}

export async function readHiBob(c: HiBobCreds): Promise<HrRead> {
  const res = await call(
    "https://api.hibob.com/v1/people/search",
    {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${c.serviceUserId}:${c.token}`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        showInactive: true,
        fields: ["root.id", "root.displayName", "root.email", "work.title", "work.startDate", "internal.terminationDate", "internal.status", "internal.lifecycleStatus"],
      }),
    },
    "HiBob",
  );
  const j = (await res.json()) as {
    employees?: { id?: string; displayName?: string; email?: string; work?: { title?: string; startDate?: string }; internal?: { terminationDate?: string | null; status?: string; lifecycleStatus?: string } }[];
  };
  const employees = (j.employees ?? [])
    .filter((e) => e.id)
    .map(
      (e): HrEmployee => ({
        externalId: String(e.id),
        name: e.displayName || e.email || String(e.id),
        email: email(e.email),
        title: e.work?.title || null,
        startDate: day(e.work?.startDate),
        endDate: day(e.internal?.terminationDate),
        active: (e.internal?.status ?? "Active").toLowerCase() !== "inactive" && (e.internal?.lifecycleStatus ?? "").toLowerCase() !== "terminated",
      }),
    );
  const missingFields = j.employees?.length && j.employees.every((e) => e.internal === undefined) ? ["internal.terminationDate (the service user needs the 'Lifecycle' / 'Internal' field permission)"] : [];
  return { employees, truncated: false, missingFields };
}

// ------------------------------------------------------------------ BambooHR

export interface BambooCreds {
  subdomain: string;
  apiKey: string;
}

export function normalizeBambooSubdomain(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.bamboohr\.com.*$/, "").replace(/\/.*$/, "");
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(s) ? s : null;
}

export async function readBamboo(c: BambooCreds): Promise<HrRead> {
  const sub = normalizeBambooSubdomain(c.subdomain);
  if (!sub) throw new HrisError("auth", "That BambooHR subdomain doesn't look right — it's the part before .bamboohr.com.");
  const res = await call(
    `https://api.bamboohr.com/api/gateway.php/${sub}/v1/reports/custom?format=JSON&onlyCurrent=false`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${c.apiKey}:x`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ title: "ShieldFlow", fields: ["id", "displayName", "firstName", "lastName", "workEmail", "jobTitle", "hireDate", "terminationDate", "status"] }),
    },
    "BambooHR",
  );
  const j = (await res.json()) as { employees?: Record<string, string | null>[] };
  const employees = (j.employees ?? [])
    .filter((e) => e.id)
    .map(
      (e): HrEmployee => ({
        externalId: String(e.id),
        name: e.displayName || `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || String(e.id),
        email: email(e.workEmail),
        title: e.jobTitle || null,
        startDate: day(e.hireDate),
        endDate: day(e.terminationDate),
        active: (e.status ?? "Active").toLowerCase() === "active",
      }),
    );
  return { employees, truncated: false, missingFields: [] };
}

export async function readHris(provider: HrisProvider, creds: unknown): Promise<HrRead> {
  if (provider === "personio") return readPersonio(creds as PersonioCreds);
  if (provider === "hibob") return readHiBob(creds as HiBobCreds);
  return readBamboo(creds as BambooCreds);
}

/** Where someone is in their employment on a given day. */
export function hrState(e: HrEmployee, today: string): "active" | "leaving" | "left" {
  if (e.endDate && e.endDate <= today) return "left";
  if (e.endDate && e.endDate > today) return "leaving";
  return e.active ? "active" : "left";
}
