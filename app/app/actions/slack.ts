"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getControlsWithStatus,
  listFrameworks,
  listSelectedFrameworkIds,
  listVendors,
} from "@/lib/db/queries";
import { computeScore } from "@/lib/score";
import { computeAlerts } from "@/lib/monitoring";
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
    const [controls, allFrameworks, selectedIds, vendors] = await Promise.all([
      getControlsWithStatus(supabase, company.id),
      listFrameworks(supabase),
      listSelectedFrameworkIds(supabase, company.id),
      listVendors(supabase, company.id),
    ]);
    const frameworks = allFrameworks.filter((f) => selectedIds.includes(f.id));
    const score = computeScore(controls.map((c) => c.status));
    const frameworkProgress = frameworks.map((f) => ({
      name: f.name,
      pct: computeScore(controls.filter((c) => c.framework_id === f.id).map((c) => c.status)),
    }));
    const alerts = computeAlerts(controls, frameworkProgress, vendors);

    const high = alerts.filter((a) => a.severity === "high").length;
    const warning = alerts.filter((a) => a.severity === "warning").length;
    const info = alerts.filter((a) => a.severity === "info").length;

    const lines = [
      `:shield: *ShieldFlow compliance digest — ${company.name}*`,
      `Overall score: *${score}%*`,
      frameworkProgress.map((fp) => `• ${fp.name}: ${fp.pct}%`).join("\n"),
    ];
    if (alerts.length === 0) {
      // Zero alerts is a result worth celebrating, not an empty message.
      lines.push(`:white_check_mark: *All clear* — no open alerts.`);
    } else {
      lines.push(
        `Open alerts: *${alerts.length}* (${high} high, ${warning} warning, ${info} info)`,
        ...alerts.slice(0, 5).map((a) => {
          const icon =
            a.severity === "high" ? ":red_circle:" : a.severity === "warning" ? ":large_yellow_circle:" : ":large_blue_circle:";
          return `${icon} ${a.title} — ${a.detail}`;
        }),
      );
      if (alerts.length > 5) lines.push(`…and ${alerts.length - 5} more in the dashboard.`);
    }
    text = lines.filter(Boolean).join("\n");
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
