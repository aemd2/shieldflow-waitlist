"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { personnelSchema, personnelBulkCreateSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { decryptSecret, encryptIfConfigured } from "@/lib/crypto";
import { parsePersonnelCsv } from "@/lib/csv";
import { fetchUsersRaw as fetchOktaUsersRaw, OktaError } from "@/lib/okta";
import { fetchWorkspaceUsers, refreshAccessToken, GoogleError } from "@/lib/google";
import type { RosterProvider } from "@/app/actions/access-reviews";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";
const MAX_CSV_BYTES = 512 * 1024; // 512KB — generous for a 4-column personnel list

async function companyOrError(): Promise<
  { company: Company; supabase: Awaited<ReturnType<typeof createServerSupabase>> } | { error: string }
> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  try {
    const company = await getCompanyForUser(supabase, user.id);
    if (!company) return { error: "No company found." };
    const denied = await assertCanWrite(supabase, company.id, user.id);
    if (denied) return { error: denied };
    return { company, supabase };
  } catch {
    return { error: DB_ERROR };
  }
}

function row(d: z.infer<typeof personnelSchema>) {
  return {
    name: d.name,
    email: d.email || null,
    role_title: d.role_title || null,
    started_at: d.started_at || null,
  };
}

export async function createPerson(input: unknown) {
  const parsed = personnelSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid person data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("personnel")
    .insert({ company_id: res.company.id, ...row(parsed.data) });
  if (error) return { error: "Could not add the person. Please try again." };

  await logEvent(res.supabase, res.company.id, "personnel.created", { type: "personnel", label: parsed.data.name });
  revalidatePath("/personnel");
  return { ok: true };
}

/** "alice.smith" -> "Alice Smith" — same placeholder-name derivation used
 * when a Team invite creates a Personnel row with no real name available. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._+]/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
}

/**
 * Live, on-demand roster pull for the bulk-add form — no persistence beyond
 * what the user then actually submits. Reuses the exact credential-decrypt
 * path each provider's own sync already uses (same shape as pullRosterFrom
 * in access-reviews.ts). Rate-limited separately from Sync/pullRosterFrom so
 * none of the three fight over one budget.
 */
export async function pullPersonnelFrom(provider: RosterProvider) {
  const res = await companyOrError();
  if ("error" in res) return { error: res.error };
  const { supabase, company } = res;

  if (!checkRateLimit(`personnel-pull:${company.id}:${provider}`, 3, 60_000)) {
    return { error: "Pulled recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, refresh_token, token_expires_at, status, metadata")
    .eq("company_id", company.id)
    .eq("provider", provider)
    .maybeSingle();
  if (!integ || integ.status === "disconnected") {
    return { error: "That integration isn't connected yet." };
  }

  try {
    if (provider === "okta") {
      const meta = (integ.metadata ?? {}) as { host?: string };
      let creds: { host: string; token: string };
      try {
        creds = JSON.parse(decryptSecret(integ.access_token as string));
      } catch {
        return { error: "Stored credentials are corrupt — please reconnect Okta." };
      }
      const users = await fetchOktaUsersRaw(creds.host ?? meta.host ?? "", creds.token);
      return {
        ok: true as const,
        rows: users
          .filter((u) => u.status === "ACTIVE")
          .map((u) => ({ name: u.name || nameFromEmail(u.email), email: u.email, role_title: "" })),
      };
    }

    // google_workspace
    let accessToken: string;
    try {
      accessToken = decryptSecret(integ.access_token as string);
    } catch {
      return { error: "Stored Google credentials are unreadable — please reconnect." };
    }
    const expiresAt = integ.token_expires_at ? new Date(integ.token_expires_at as string).getTime() : 0;
    if (expiresAt < Date.now() + 60_000) {
      if (!integ.refresh_token) return { error: "Google access expired. Please reconnect the integration." };
      const fresh = await refreshAccessToken(decryptSecret(integ.refresh_token as string));
      accessToken = fresh.access_token;
      const ttl = Number.isFinite(fresh.expires_in) ? fresh.expires_in : 3600;
      await supabase
        .from("integrations")
        .update({
          access_token: encryptIfConfigured(fresh.access_token),
          token_expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
          status: "connected",
        })
        .eq("id", integ.id);
    }
    const users = await fetchWorkspaceUsers(accessToken);
    return {
      ok: true as const,
      rows: users
        .filter((u) => !u.suspended)
        .map((u) => ({ name: u.fullName || nameFromEmail(u.primaryEmail), email: u.primaryEmail, role_title: "" })),
    };
  } catch (err) {
    if (err instanceof OktaError || err instanceof GoogleError) return { error: err.userMessage };
    return { error: "Couldn't pull the roster. Please try again." };
  }
}

/**
 * Parse an uploaded personnel CSV (name,email,role_title,started_at) for the
 * bulk-add form. Client reads the File via file.text() and posts the raw
 * string here — no Storage upload, no persistence; transient parse input,
 * same trust tier as pasting text into the box it supplements.
 */
export async function parseUploadedPersonnelCsv(csvText: string) {
  if (typeof csvText !== "string") return { error: "Invalid file." };
  if (csvText.length === 0) return { error: "That file is empty." };
  if (csvText.length > MAX_CSV_BYTES) return { error: "That file is too large (max 512KB)." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const rows = parsePersonnelCsv(csvText);
  if (rows.length === 0) return { error: "No rows found — check the file matches the template." };
  if (rows.length > 500) return { error: "That's a lot of rows — split it into a couple of batches." };

  return { ok: true as const, rows };
}

/** Insert many personnel rows at once — the bulk-add form's Save action. */
export async function createPeopleBulk(input: unknown) {
  const parsed = personnelBulkCreateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid people data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const rows = parsed.data.people.map((p) => ({
    company_id: res.company.id,
    name: p.name,
    email: p.email || null,
    role_title: p.role_title || null,
    started_at: p.started_at || null,
  }));
  const { error } = await res.supabase.from("personnel").insert(rows);
  if (error) return { error: "Could not add these people. Please try again." };

  await logEvent(res.supabase, res.company.id, "personnel.bulk_created", {
    type: "personnel",
    metadata: { count: rows.length },
  });
  revalidatePath("/personnel");
  return { ok: true, count: rows.length };
}

export async function updatePerson(id: string, input: unknown) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid person." };
  const parsed = personnelSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid person data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("personnel")
    .update(row(parsed.data))
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not save. Please try again." };

  revalidatePath("/personnel");
  return { ok: true };
}

/** Offboard: mark inactive and stamp the end date (the audit-relevant event). */
export async function offboardPerson(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid person." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: existing } = await res.supabase
    .from("personnel")
    .select("name")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await res.supabase
    .from("personnel")
    .update({ status: "offboarded", ended_at: new Date().toISOString().slice(0, 10) })
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not offboard. Please try again." };

  await logEvent(res.supabase, res.company.id, "personnel.offboarded", {
    type: "personnel",
    id,
    label: (existing?.name as string | undefined) ?? undefined,
  });
  revalidatePath("/personnel");
  return { ok: true };
}

export async function reactivatePerson(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid person." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("personnel")
    .update({ status: "active", ended_at: null })
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not reactivate. Please try again." };

  revalidatePath("/personnel");
  return { ok: true };
}

export async function deletePerson(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid person." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: existing } = await res.supabase
    .from("personnel")
    .select("name")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await res.supabase
    .from("personnel")
    .delete()
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete." };

  await logEvent(res.supabase, res.company.id, "personnel.deleted", {
    type: "personnel",
    id,
    label: (existing?.name as string | undefined) ?? undefined,
  });
  revalidatePath("/personnel");
  return { ok: true };
}
