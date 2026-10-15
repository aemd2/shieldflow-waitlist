"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertFeature, assertIntegrationSlot } from "@/lib/plan-server";
import { buildDigestText } from "@/lib/slack-alerts";
import { sendSlackMessage, isValidSlackWebhook, SlackError } from "@/lib/slack";
import { slackWebhookSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/audit";
import { INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { encryptSecret, decryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

/**
 * Connect Slack with an incoming-webhook URL. Strictly validated (SSRF guard:
 * only https://hooks.slack.com/services/...), then proven live with a test
 * message — the URL is only stored after Slack accepts the post.
 */
export async function connectSlack(input: { webhookUrl: string }) {
  const parsed = slackWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid webhook URL." };
  }
  if (!isValidSlackWebhook(parsed.data.webhookUrl)) {
    return {
      error:
        "That isn't a Slack incoming-webhook URL. It must start with https://hooks.slack.com/services/...",
    };
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };
  const denied =
    (await assertCanWrite(supabase, company.id, user.id)) ??
    (await assertIntegrationSlot(supabase, company.id, "slack"));
  if (denied) return { error: denied };
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  try {
    await sendSlackMessage(
      parsed.data.webhookUrl,
      `:shield: *ShieldFlow connected* — compliance alerts for *${company.name}* will arrive in this channel.`,
    );
  } catch (err) {
    return { error: err instanceof SlackError ? err.userMessage : "Couldn't reach Slack." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "slack",
      access_token: encryptSecret(parsed.data.webhookUrl),
      status: "connected",
      connected_by: user.id,
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "slack",
    label: INTEGRATION_LABELS.slack,
  });

  revalidatePath("/integrations");
  return { ok: true };
}

/**
 * Post a compliance digest (score + top alerts) to the connected channel.
 * Reuses the exact same data + rules as the dashboard, so Slack and the
 * dashboard can never disagree.
 */
export async function sendComplianceDigest() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };
  const denied =
    (await assertCanWrite(supabase, company.id, user.id)) ??
    (await assertFeature(supabase, company.id, "integrations"));
  if (denied) return { error: denied };

  if (!checkRateLimit(`slack-digest:${company.id}`, 1, 60_000)) {
    return { error: "A digest was just sent — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, status")
    .eq("company_id", company.id)
    .eq("provider", "slack")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "Slack isn't connected yet." };
  }

  let text: string;
  try {
    text = await buildDigestText(supabase, company.id, company.name);
  } catch {
    return { error: DB_ERROR };
  }

  let webhookUrl: string;
  try {
    webhookUrl = decryptSecret(integ.access_token);
  } catch {
    return { error: "Stored Slack webhook is unreadable — please reconnect." };
  }

  try {
    await sendSlackMessage(webhookUrl, text);
  } catch (err) {
    if (err instanceof SlackError && err.kind === "revoked") {
      await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
      revalidatePath("/integrations");
    }
    return { error: err instanceof SlackError ? err.userMessage : "Couldn't reach Slack." };
  }

  await supabase
    .from("integrations")
    .update({ last_synced_at: new Date().toISOString(), status: "connected" })
    .eq("id", integ.id);

  revalidatePath("/integrations");
  return { ok: true };
}

export async function disconnectSlack() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };

  const { error } = await supabase
    .from("integrations")
    .delete()
    .eq("company_id", company.id)
    .eq("provider", "slack");
  if (error) return { error: "Could not disconnect. Please try again." };

  await logEvent(supabase, company.id, "integration.disconnected", {
    type: "integration",
    id: "slack",
    label: INTEGRATION_LABELS.slack,
  });

  revalidatePath("/integrations");
  return { ok: true };
}

/** Slack alerts (a check turned red) and the Monday digest — both on unless switched off. */
export async function updateSlackSettings(input: unknown) {
  const v = (input && typeof input === "object" ? input : {}) as { alerts?: unknown; weekly?: unknown };
  if ((v.alerts !== undefined && typeof v.alerts !== "boolean") || (v.weekly !== undefined && typeof v.weekly !== "boolean")) return { error: "Invalid settings." };
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const company = await getCompanyForUser(supabase, user.id).catch(() => null);
  if (!company) return { error: "No company found." };
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };
  const { data: integ } = await supabase.from("integrations").select("id, metadata").eq("company_id", company.id).eq("provider", "slack").maybeSingle();
  if (!integ) return { error: "Slack isn't connected yet." };
  const meta = (integ.metadata as Record<string, unknown> | null) ?? {};
  const current = (meta.slack as Record<string, unknown> | undefined) ?? {};
  const next = { ...current, ...(v.alerts !== undefined ? { alerts: v.alerts } : {}), ...(v.weekly !== undefined ? { weekly: v.weekly } : {}) };
  const { error } = await supabase.from("integrations").update({ metadata: { ...meta, slack: next } }).eq("id", integ.id);
  if (error) return { error: DB_ERROR };
  revalidatePath("/integrations");
  return { ok: true };
}
