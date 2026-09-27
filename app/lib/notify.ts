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
 * directly (the admin client bypasses RLS) and resolve email recipients the same
 * way the RPC does.
 *
 * This used to write the in-app row and stop, which made the whole daily check
 * pointless: it would find a control had started failing and tell nobody unless
 * they happened to log in and look at the bell. The alert only earns its keep if
 * it reaches you before your customer does.
 *
 * The two preferences are independent on purpose — someone can mute the bell and
 * still want the email, or the reverse — so email recipients are filtered on
 * email_enabled, never on the in-app set.
 *
 * Best-effort throughout; never throws.
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
      .select("user_id, in_app_enabled, email_enabled")
      .eq("company_id", companyId)
      .eq("type", payload.type);
    const prefRows = (prefs ?? []) as {
      user_id: string;
      in_app_enabled: boolean;
      email_enabled: boolean;
    }[];

    // Both prefs default to true when a member has no row, matching the RPC's
    // coalesce(..., true).
    const inAppOptedOut = new Set(
      prefRows.filter((p) => p.in_app_enabled === false).map((p) => p.user_id),
    );
    const emailOptedOut = new Set(
      prefRows.filter((p) => p.email_enabled === false).map((p) => p.user_id),
    );

    const rows = ids
      .filter((id) => !inAppOptedOut.has(id))
      .map((id) => ({
        company_id: companyId,
        user_id: id,
        type: payload.type,
        title: payload.title,
        body: payload.body ?? null,
        link: payload.link ?? null,
      }));
    if (rows.length > 0) await admin.from("notifications").insert(rows);

    // auth.users isn't exposed through PostgREST, so addresses come from the
    // admin auth API rather than a join. One lookup per recipient, settled
    // individually so one failure can't cost everyone else their email.
    const recipients = ids.filter((id) => !emailOptedOut.has(id));
    if (recipients.length === 0) return;

    const looked = await Promise.allSettled(
      recipients.map((id) => admin.auth.admin.getUserById(id)),
    );
    const emails = looked
      .map((r) => (r.status === "fulfilled" ? r.value.data?.user?.email : null))
      .filter((e): e is string => Boolean(e));

    await sendEmails(emails, payload);
  } catch {
    // best-effort
  }
}
