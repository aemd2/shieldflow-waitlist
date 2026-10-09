import type { SupabaseClient } from "@supabase/supabase-js";
import { AWS_CHECK_BY_KEY } from "@/lib/aws/catalog";
import { resourceId } from "@/lib/aws/evaluate";
import type { NotifyPayload } from "@/lib/notify";
import type { AccountScan } from "@/lib/aws/types";
import { plural } from "@/lib/plural";

/**
 * "This week in AWS" — one Monday message for the person with four hours a week
 * for compliance: what broke, what got fixed, what was changed by hand without a
 * reason, and the one fix to do first. Built from check_history (so "newly
 * failing" means since last week, not since yesterday), the change store and
 * the last scan. Sent at most once every six days.
 */

const DAY = 86_400_000;
const SEVERITY = { high: 0, medium: 1, low: 2 } as const;

export async function awsWeeklyDigest(admin: SupabaseClient, companyId: string, now = new Date()): Promise<NotifyPayload | null> {
  const { data: umbrella } = await admin
    .from("integrations")
    .select("id, status, metadata")
    .eq("company_id", companyId)
    .eq("provider", "aws")
    .maybeSingle();
  if (!umbrella || umbrella.status !== "connected") return null;
  const meta = (umbrella.metadata ?? {}) as Record<string, unknown>;
  const last = typeof meta.lastWeeklyDigest === "string" ? Date.parse(meta.lastWeeklyDigest) : 0;
  if (now.getTime() - last < 6 * DAY) return null;

  const [{ data: history }, { data: changes }, { data: reasons }, { data: accounts }] = await Promise.all([
    admin
      .from("check_history")
      .select("check_key, result, observed_at")
      .eq("company_id", companyId)
      .eq("provider", "aws")
      .gte("observed_at", new Date(now.getTime() - 9 * DAY).toISOString())
      .order("observed_at", { ascending: true }),
    admin
      .from("aws_change_events")
      .select("event_id, account_id, region")
      .eq("company_id", companyId)
      .gte("event_time", new Date(now.getTime() - 7 * DAY).toISOString()),
    admin.from("check_exceptions").select("resource_id").eq("company_id", companyId).eq("check_key", "aws.manual_changes"),
    admin.from("aws_accounts").select("in_scope, last_scan").eq("company_id", companyId),
  ]);

  // Verdict per check a week ago and now.
  const weekAgo = now.getTime() - 7 * DAY;
  const before = new Map<string, string>();
  const latest = new Map<string, string>();
  for (const h of (history ?? []) as { check_key: string; result: string; observed_at: string }[]) {
    if (Date.parse(h.observed_at) <= weekAgo) before.set(h.check_key, h.result);
    latest.set(h.check_key, h.result);
  }
  let broke = 0;
  let fixed = 0;
  for (const [key, result] of latest) {
    const was = before.get(key);
    if (!was || AWS_CHECK_BY_KEY.get(key)?.informational) continue;
    if (was !== "fail" && result === "fail") broke++;
    if (was === "fail" && result !== "fail") fixed++;
  }
  const failingNow = [...latest.entries()].filter(([k, r]) => r === "fail" && !AWS_CHECK_BY_KEY.get(k)?.informational).length;

  const explained = new Set(((reasons ?? []) as { resource_id: string }[]).map((r) => r.resource_id));
  const unexplained = ((changes ?? []) as { event_id: string; account_id: string; region: string }[]).filter(
    (c) => !explained.has(resourceId(c.account_id, c.region, "change", c.event_id)),
  ).length;

  // The one fix to do first: the most severe failing check in production.
  const top = ((accounts ?? []) as { in_scope: boolean; last_scan: AccountScan | null }[])
    .filter((a) => a.in_scope && a.last_scan)
    .flatMap((a) => a.last_scan!.results)
    .filter((r) => r.result === "fail" && !AWS_CHECK_BY_KEY.get(r.key)?.informational)
    .map((r) => ({ r, def: AWS_CHECK_BY_KEY.get(r.key)! }))
    .filter((x) => x.def)
    .sort((a, b) => SEVERITY[a.def.severity] - SEVERITY[b.def.severity] || b.r.failingCount - a.r.failingCount)[0];

  if (!latest.size && !unexplained) return null;

  await admin
    .from("integrations")
    .update({ metadata: { ...meta, lastWeeklyDigest: now.toISOString() } })
    .eq("id", umbrella.id);

  const parts = [
    before.size ? `${plural(broke, "check")} started failing and ${fixed} got fixed since last week; ${failingNow} failing now.` : `${failingNow} ${failingNow === 1 ? "check is" : "checks are"} failing.`,
    unexplained ? `${plural(unexplained, "change")} made by hand in production without a recorded reason.` : "No unexplained changes made by hand.",
    top ? `Fix first: ${top.def.title}${top.r.resources[0] ? ` — ${top.r.resources[0].label}` : ""}.` : "Nothing to fix first. 🎉",
  ];
  return {
    type: "integration",
    title: "This week in AWS",
    body: parts.join(" "),
    link: "/integrations/aws",
  };
}
