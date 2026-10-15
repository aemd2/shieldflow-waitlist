import type { SupabaseClient } from "@supabase/supabase-js";
import { getControlsWithStatus, listFrameworks, listSelectedFrameworkIds } from "@/lib/db/queries";
import { computeScore } from "@/lib/score";
import { loadAlerts } from "@/lib/workspace-alerts";
import { decryptSecret } from "@/lib/crypto";
import { sendSlackMessage, SlackError } from "@/lib/slack";
import { PROVIDERS } from "@/lib/integrations/registry";
import { CHECK_PROVIDER_LABELS } from "@/lib/checks";

/**
 * Slack, on its own: a message when a check turns red in the morning scan, and
 * a weekly digest on Mondays — both on by default once Slack is connected, both
 * switchable off on the Slack card.
 */

export interface SlackSettings {
  alerts: boolean;
  weekly: boolean;
}

export function slackSettings(metadata: unknown): SlackSettings {
  const s = ((metadata as { slack?: Partial<SlackSettings> } | null)?.slack ?? {}) as Partial<SlackSettings>;
  return { alerts: s.alerts !== false, weekly: s.weekly !== false };
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://shieldflow.cloud").replace(/\/$/, "");

/** The digest text: score, framework progress, the top open alerts. */
export async function buildDigestText(db: SupabaseClient, companyId: string, companyName: string): Promise<string> {
  const [controls, allFrameworks, selectedIds] = await Promise.all([getControlsWithStatus(db, companyId), listFrameworks(db), listSelectedFrameworkIds(db, companyId)]);
  const frameworks = allFrameworks.filter((f) => selectedIds.includes(f.id));
  const score = computeScore(controls.map((c) => c.status));
  const frameworkProgress = frameworks.map((f) => ({ name: f.name, pct: computeScore(controls.filter((c) => c.framework_id === f.id).map((c) => c.status)) }));
  const alerts = await loadAlerts(db, companyId, controls, frameworkProgress);
  const high = alerts.filter((a) => a.severity === "high").length;
  const warning = alerts.filter((a) => a.severity === "warning").length;
  const info = alerts.filter((a) => a.severity === "info").length;
  const lines = [`:shield: *ShieldFlow compliance digest — ${companyName}*`, `Overall score: *${score}%*`, frameworkProgress.map((fp) => `• ${fp.name}: ${fp.pct}%`).join("\n")];
  if (alerts.length === 0) {
    // Zero alerts is a result worth celebrating, not an empty message.
    lines.push(`:white_check_mark: *All clear* — no open alerts.`);
  } else {
    lines.push(
      `Open alerts: *${alerts.length}* (${high} high, ${warning} warning, ${info} info)`,
      ...alerts.slice(0, 5).map((a) => `${a.severity === "high" ? ":red_circle:" : a.severity === "warning" ? ":large_yellow_circle:" : ":large_blue_circle:"} ${a.title} — ${a.detail}`),
    );
    if (alerts.length > 5) lines.push(`…and ${alerts.length - 5} more in the dashboard.`);
  }
  lines.push(`<${appUrl()}/dashboard|Open ShieldFlow>`);
  return lines.filter(Boolean).join("\n");
}

const CHECK_TITLE = new Map(PROVIDERS.flatMap((p) => p.checks.map((c) => [c.key, { title: c.title, page: p.key }] as const)));

/** "Turned red" message for checks that just started failing. */
export function redChecksText(companyName: string, turnedRed: { checkKey: string; detail: string }[]): string {
  const lines = [`:red_circle: *${turnedRed.length} ${turnedRed.length === 1 ? "check" : "checks"} started failing — ${companyName}*`];
  for (const r of turnedRed.slice(0, 8)) {
    const known = CHECK_TITLE.get(r.checkKey);
    const provider = CHECK_PROVIDER_LABELS[r.checkKey.split(".")[0]] ?? r.checkKey.split(".")[0];
    const link = known ? `${appUrl()}/integrations/${known.page}` : `${appUrl()}/dashboard`;
    lines.push(`• *${provider}:* <${link}|${known?.title ?? r.checkKey}> — ${r.detail.slice(0, 200)}`);
  }
  if (turnedRed.length > 8) lines.push(`…and ${turnedRed.length - 8} more.`);
  return lines.join("\n");
}

/** Post to the workspace's Slack, if connected and the setting allows. Marks the integration on a revoked webhook. Never throws. */
export async function postToSlack(db: SupabaseClient, companyId: string, kind: keyof SlackSettings, text: () => Promise<string> | string): Promise<boolean> {
  try {
    const { data: integ } = await db.from("integrations").select("id, access_token, status, metadata").eq("company_id", companyId).eq("provider", "slack").maybeSingle();
    if (!integ?.access_token || integ.status !== "connected" || !slackSettings(integ.metadata)[kind]) return false;
    const meta = (integ.metadata as Record<string, unknown> | null) ?? {};
    if (kind === "weekly") {
      const last = meta.lastWeeklyAt as string | undefined;
      if (last && Date.now() - Date.parse(last) < 6 * 86_400_000) return false;
    }
    try {
      await sendSlackMessage(decryptSecret(integ.access_token as string), await text());
    } catch (err) {
      if (err instanceof SlackError && err.kind === "revoked") await db.from("integrations").update({ status: "error" }).eq("id", integ.id);
      return false;
    }
    const stamp = kind === "weekly" ? { lastWeeklyAt: new Date().toISOString() } : { lastAlertAt: new Date().toISOString() };
    await db.from("integrations").update({ metadata: { ...meta, ...stamp }, last_synced_at: new Date().toISOString() }).eq("id", integ.id);
    return true;
  } catch {
    return false;
  }
}
