import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationCategory } from "@/lib/validation";

export interface NotifyPayload {
  /** Category — drives per-user prefs and the bell icon. */
  type: NotificationCategory;
  title: string;
  body?: string;
  /** App-relative path the notification deep-links to, e.g. "/controls/abc". */
  link?: string;
}

/**
 * Fan a notification out to specific company members.
 *
 * Writes the in-app rows via the notify_users() SECURITY DEFINER RPC — the sole
 * writer, which validates the caller's membership and honors each recipient's
 * in-app preference — then, when RESEND_API_KEY is set, sends a best-effort email
 * to the recipients who haven't disabled email for this category (the RPC returns
 * exactly those addresses).
 *
 * Fully fail-safe like logEvent(): it must NEVER break the action that triggered
 * it, so every error is swallowed. Call it AFTER the primary mutation succeeds.
 */
export async function notify(
  supabase: SupabaseClient,
  companyId: string,
  userIds: string[],
  payload: NotifyPayload,
): Promise<void> {
  if (userIds.length === 0) return;

  let emails: string[] = [];
  try {
    const { data } = await supabase.rpc("notify_users", {
      p_company_id: companyId,
      p_user_ids: userIds,
      p_type: payload.type,
      p_title: payload.title,
      p_body: payload.body ?? null,
      p_link: payload.link ?? null,
    });
    emails = ((data ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean);
  } catch {
    return; // in-app write failed — nothing else to attempt
  }

  await sendEmails(emails, payload);
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://shieldflow.cloud";
const EMAIL_FROM = process.env.NOTIFICATION_EMAIL_FROM ?? "ShieldFlow <noreply@shieldflow.cloud>";

/**
 * Best-effort transactional email via the Resend HTTP API — no SDK dependency,
 * just fetch. No-op when RESEND_API_KEY is absent, so the app runs fine without
 * it (in-app notifications still work). One request per recipient so addresses
 * are never exposed across teammates.
 */
async function sendEmails(emails: string[], payload: NotifyPayload): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || emails.length === 0) return;

  const link = payload.link ? `${APP_URL}${payload.link}` : APP_URL;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
    <h2 style="margin:0 0 8px;font-size:18px">${escapeHtml(payload.title)}</h2>
    ${payload.body ? `<p style="color:#444;margin:0 0 16px">${escapeHtml(payload.body)}</p>` : ""}
    <a href="${link}" style="display:inline-block;background:#0b1f3a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open ShieldFlow</a>
  </div>`;

  await Promise.allSettled(
    emails.map((to) =>
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: EMAIL_FROM, to, subject: payload.title, html }),
      }),
    ),
  );
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/**
 * Service-role notification fan-out for sessionless paths (the sync cron). The
 * notify_users() RPC can't be used here because it derives membership from
 * auth.uid(), which a service-role client doesn't have — so we insert in-app rows
 * directly (the admin client bypasses RLS), honoring each member's in-app pref.
 * In-app only and best-effort; never throws.
 */
export async function notifyCompanyViaAdmin(
  admin: SupabaseClient,
  companyId: string,
  payload: NotifyPayload,
): Promise<void> {
  try {
    const { data: members } = await admin
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId);
    const ids = (members ?? []).map((m: { user_id: string }) => m.user_id);
    if (ids.length === 0) return;

    const { data: prefs } = await admin
      .from("notification_prefs")
      .select("user_id, in_app_enabled")
      .eq("company_id", companyId)
      .eq("type", payload.type);
    const optedOut = new Set(
      (prefs ?? [])
        .filter((p: { in_app_enabled: boolean }) => p.in_app_enabled === false)
        .map((p: { user_id: string }) => p.user_id),
    );

    const rows = ids
      .filter((id) => !optedOut.has(id))
      .map((id) => ({
        company_id: companyId,
        user_id: id,
        type: payload.type,
        title: payload.title,
        body: payload.body ?? null,
        link: payload.link ?? null,
      }));
    if (rows.length > 0) await admin.from("notifications").insert(rows);
  } catch {
    // best-effort
  }
}
