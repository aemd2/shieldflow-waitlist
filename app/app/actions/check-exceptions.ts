"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";

/**
 * "This resource is out of scope, because…" — recorded per check and resource,
 * with an optional expiry. The next scan reports it as accepted rather than
 * failing; the decision (who, when, why) is kept as evidence. An exception never
 * hides a resource: it stays listed, labelled with the reason.
 */

const createSchema = z.object({
  checkKey: z.string().regex(/^[a-z0-9]+\.[a-z0-9_]+$/),
  resourceId: z.string().min(3).max(300),
  label: z.string().max(300).optional(),
  reason: z.string().trim().min(5, "Say why — an auditor will read this.").max(500),
  expiresAt: z.string().datetime().nullable().optional(),
});

async function context() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const company = await getCompanyForUser(supabase, user.id).catch(() => null);
  if (!company) return { ok: false as const, error: "No company found." };
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { ok: false as const, error: denied };
  return { ok: true as const, supabase, user, company };
}

export async function createCheckException(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid exception." };
  const c = await context();
  if (!c.ok) return { error: c.error };

  const { error } = await c.supabase.from("check_exceptions").upsert(
    {
      company_id: c.company.id,
      check_key: parsed.data.checkKey,
      resource_id: parsed.data.resourceId,
      label: parsed.data.label ?? null,
      reason: parsed.data.reason,
      expires_at: parsed.data.expiresAt ?? null,
      created_by: c.user.id,
    },
    { onConflict: "company_id,check_key,resource_id" },
  );
  if (error) return { error: "Could not save. Please try again." };

  await logEvent(c.supabase, c.company.id, "check.exception_added", {
    type: "check",
    id: parsed.data.checkKey,
    label: parsed.data.label ?? parsed.data.resourceId,
    metadata: { reason: parsed.data.reason, expires_at: parsed.data.expiresAt ?? null },
  });
  revalidatePath("/integrations/aws");
  return { ok: true };
}

export async function deleteCheckException(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid exception." };
  const c = await context();
  if (!c.ok) return { error: c.error };
  const { data: row } = await c.supabase
    .from("check_exceptions")
    .select("check_key, label, resource_id")
    .eq("company_id", c.company.id)
    .eq("id", id)
    .maybeSingle();
  const { error } = await c.supabase.from("check_exceptions").delete().eq("company_id", c.company.id).eq("id", id);
  if (error) return { error: "Could not remove. Please try again." };
  await logEvent(c.supabase, c.company.id, "check.exception_removed", {
    type: "check",
    id: (row?.check_key as string | undefined) ?? undefined,
    label: (row?.label as string | undefined) ?? (row?.resource_id as string | undefined),
  });
  revalidatePath("/integrations/aws");
  return { ok: true };
}
