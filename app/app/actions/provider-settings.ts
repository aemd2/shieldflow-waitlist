"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { PROVIDER_BY_KEY } from "@/lib/integrations/registry";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

/**
 * Save an integration page's settings. Which keys exist and their bounds come
 * from the provider's registry entry, so nothing outside them can be written.
 */
export async function updateProviderSettings(provider: unknown, input: unknown) {
  const entry = typeof provider === "string" ? PROVIDER_BY_KEY.get(provider) : undefined;
  if (!entry?.settings?.length) return { error: "This integration has no settings." };
  const values = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const patch: Record<string, number> = {};
  for (const f of entry.settings) {
    const v = values[f.key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < f.min || v > f.max) return { error: `${f.label} must be ${f.min}–${f.max} ${f.unit}.` };
    patch[f.key] = v;
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const company = await getCompanyForUser(supabase, user.id).catch(() => null);
  if (!company) return { error: "No company found." };
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };
  const { data: integ } = await supabase.from("integrations").select("id, metadata").eq("company_id", company.id).eq("provider", entry.key).maybeSingle();
  if (!integ) return { error: `${entry.title} isn't connected yet.` };
  const meta = (integ.metadata as Record<string, unknown> | null) ?? {};
  const current = (meta.settings as Record<string, unknown> | undefined) ?? {};
  const { error } = await supabase.from("integrations").update({ metadata: { ...meta, settings: { ...current, ...patch } } }).eq("id", integ.id);
  if (error) return { error: DB_ERROR };
  revalidatePath(`/integrations/${entry.key}`);
  return { ok: true };
}
