import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { JiraError } from "@/lib/jira";
import { LinearError } from "@/lib/linear";
import { exceptionMap, resourceKey, Verdict, type CheckDef, type CheckOutcome, type ExceptionRow } from "@/lib/checks-core";
import { jiraIncidents, jiraTickets, linearIncidents, linearTickets, type IncidentInfo, type JiraCreds, type TicketInfo, type Tracker } from "@/lib/integrations/tickets/clients";
import { loadExceptions, saveScan, type ProviderScan } from "@/lib/integrations/scan-store";

/**
 * Jira / Linear scan: resolve the ticket behind each merged change (so the
 * change population reads ticket → pull request → review → merge), keep the
 * incident population, and say which recent changes have no real ticket.
 */

const CHANGE = ["CC8.1", "A.8.32", "Req 6"];
const WINDOW_DAYS = 30;
const RECHECK_DAYS = 7;

export function trackerChecks(t: Tracker): CheckDef<"changes">[] {
  const title = t === "jira" ? "Jira" : "Linear";
  return [
    {
      key: `${t}.changes_linked`,
      title: `Every merged change points to a ${title} ticket`,
      area: "changes",
      severity: "low",
      informational: true,
      why: "Auditors trace a sample of production changes back to the request that asked for them. A ticket ID in the branch name or title, that really exists, makes that trace one click.",
      controlCodes: CHANGE,
      apiCalls: t === "jira" ? ["GET /rest/api/3/issue/{key} (summary, status)"] : ["GraphQL issue(id) { identifier title state }"],
      fix: { console: `Start branch names or pull-request titles with the ticket ID (e.g. ENG-42-fix-login). ${title}'s GitHub/GitLab app can enforce it.` },
    },
  ];
}

export const TRACKER_AREAS = [{ area: "changes", title: "Change tickets" }];

export interface TrackerExtra {
  checked: number;
  found: number;
  missing: string[];
  incidents: IncidentInfo[];
  unlinked: { repo: string; number: number; title: string; ticket: string | null; provider: string }[];
}

interface ChangeRow {
  provider: string;
  repo: string;
  number: number;
  title: string;
  ticket: string | null;
  merged_at: string;
  ticket_checked_at: string | null;
  ticket_title: string | null;
}

export function evaluateTracker(t: Tracker, changes: ChangeRow[], exceptions: ExceptionRow[], now: Date): CheckOutcome[] {
  if (!changes.length) return [];
  const v = new Verdict(`${t}.changes_linked`, exceptionMap(exceptions, now));
  const since = now.getTime() - WINDOW_DAYS * 86_400_000;
  const recent = changes.filter((c) => Date.parse(c.merged_at) >= since);
  for (const c of recent) {
    const sep = c.provider === "gitlab" ? "!" : "#";
    const id = resourceKey(c.repo.split("/")[0], null, "change", `${c.repo}${sep}${c.number}`);
    if (!c.ticket) v.flag({ id, label: `${c.repo}${sep}${c.number} — ${c.title.slice(0, 60)} (no ticket ID)`, region: null });
    else if (c.ticket_checked_at && !c.ticket_title) v.flag({ id, label: `${c.repo}${sep}${c.number} — ${c.ticket} doesn't exist`, region: null });
    else if (!c.ticket_checked_at) v.gap(`${c.ticket} not looked up yet`);
  }
  return [
    v.settle(
      recent.length ? `All ${recent.length} changes merged in the last ${WINDOW_DAYS} days point to a real ticket.` : `No changes merged in the last ${WINDOW_DAYS} days.`,
      (n) => `${n} of ${recent.length} changes merged in the last ${WINDOW_DAYS} days have no ticket, or one that doesn't exist.`,
    ),
  ];
}

export async function scanTracker(db: SupabaseClient, tracker: Tracker, integ: { id: string; company_id: string; access_token: string | null; metadata: Record<string, unknown> | null }): Promise<ProviderScan<TrackerExtra>> {
  const started = Date.now();
  let secret: string;
  try {
    secret = decryptSecret(integ.access_token ?? "");
  } catch {
    throw tracker === "jira" ? new JiraError("auth", "Stored credentials are unreadable — please reconnect Jira.") : new LinearError("auth", "Stored credentials are unreadable — please reconnect Linear.");
  }
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data } = await db
    .from("code_changes")
    .select("provider, repo, number, title, ticket, merged_at, ticket_checked_at, ticket_title")
    .eq("company_id", integ.company_id)
    .gte("merged_at", since)
    .order("merged_at", { ascending: false })
    .limit(1000);
  const changes = (data ?? []) as ChangeRow[];

  // Look up each ticket not checked in the last week (200 per scan).
  const stale = Date.now() - RECHECK_DAYS * 86_400_000;
  const keys = [...new Set(changes.filter((c) => c.ticket && (!c.ticket_checked_at || Date.parse(c.ticket_checked_at) < stale)).map((c) => c.ticket!))].slice(0, 200);
  let found = new Map<string, TicketInfo | null>();
  if (keys.length) found = tracker === "jira" ? await jiraTickets(JSON.parse(secret) as JiraCreds, keys) : await linearTickets(secret, keys);
  const checkedAt = new Date().toISOString();
  for (const [key, info] of found) {
    await db
      .from("code_changes")
      .update({ ticket_title: info?.title ?? null, ticket_status: info?.status ?? null, ticket_url: info?.url ?? null, ticket_checked_at: checkedAt })
      .eq("company_id", integ.company_id)
      .eq("ticket", key);
    for (const c of changes) if (c.ticket === key) Object.assign(c, { ticket_checked_at: checkedAt, ticket_title: info?.title ?? null });
  }

  const incidents = tracker === "jira" ? await jiraIncidents(JSON.parse(secret) as JiraCreds) : await linearIncidents(secret);
  if (incidents.length) {
    await db.from("incident_records").upsert(
      incidents.map((i) => ({ company_id: integ.company_id, provider: tracker, key: i.key, title: i.title.slice(0, 300), status: i.status, url: i.url, created_at_source: i.created, resolved_at: i.resolved })),
      { onConflict: "company_id,provider,key" },
    );
  }

  const exceptions = await loadExceptions(db, integ.company_id, tracker);
  const results = evaluateTracker(tracker, changes, exceptions, new Date());
  const recent = changes.filter((c) => Date.parse(c.merged_at) >= Date.now() - WINDOW_DAYS * 86_400_000);
  const scan: ProviderScan<TrackerExtra> = {
    provider: tracker,
    scannedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    results,
    roster: null,
    extra: {
      checked: found.size,
      found: [...found.values()].filter(Boolean).length,
      missing: [...found.entries()].filter(([, v]) => !v).map(([k]) => k),
      incidents: incidents.slice(0, 200),
      unlinked: recent.filter((c) => !c.ticket || (c.ticket_checked_at && !c.ticket_title)).slice(0, 100).map((c) => ({ repo: c.repo, number: c.number, title: c.title, ticket: c.ticket, provider: c.provider })),
    },
  };
  await saveScan(db, integ.id, scan);
  return scan;
}
