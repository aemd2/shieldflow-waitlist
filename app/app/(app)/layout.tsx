import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getCallerAccess,
  countUnreadNotifications,
  getControlsWithStatus,
  listIntegrations,
  listPolicies,
  listCopilotMessages,
  type CallerAccess,
  type Integration,
} from "@/lib/db/queries";
import { computeSprint } from "@/lib/setup";
import { isGroqConfigured } from "@/lib/groq";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { CopilotPanelProvider } from "@/components/copilot/CopilotPanelProvider";

// Authed pages must never be served from the browser bfcache after logout.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  // Onboarding pages render even when no company exists yet — handled in those pages.

  let access: CallerAccess | null = null;
  let unread = 0;
  // Whether "Getting started" still belongs in the nav — derived live from the
  // same 14-Day Sprint engine as the dashboard banner and guide page (never a
  // persisted flag, so it can't drift from reality). Once true, the nav item
  // drops out rather than sitting pinned at the top forever post-completion —
  // the Dashboard already carries the same "you're done" signal.
  let sprintReady = false;
  let copilotHistory: { role: "user" | "assistant"; content: string }[] = [];

  if (company) {
    const [acc, unreadCount, controls, integrations, policies, history] = await Promise.all([
      getCallerAccess(supabase, company.id, user.id),
      countUnreadNotifications(supabase, user.id, company.id),
      getControlsWithStatus(supabase, company.id),
      listIntegrations(supabase, company.id).catch(() => [] as Integration[]),
      listPolicies(supabase, company.id),
      listCopilotMessages(supabase, company.id, user.id, 50),
    ]);
    access = acc;
    unread = unreadCount;
    sprintReady = computeSprint({
      connectedIntegrations: integrations.filter((i) => i.status === "connected").length,
      controls,
      approvedPolicies: policies.filter((p) => p.status === "final").length,
    }).ready;
    copilotHistory = history.map((m) => ({ role: m.role, content: m.content }));
  }

  const role = access?.role ?? null;
  const readOnly = access?.role === "auditor";

  return (
    <ToastProvider>
      <ConfirmProvider>
        <CopilotPanelProvider initialMessages={copilotHistory} aiEnabled={isGroqConfigured()}>
          <div className="flex h-screen overflow-hidden bg-secondary">
            {company && <Sidebar companyName={company.name} role={role} sprintReady={sprintReady} />}
            <div className="flex flex-1 flex-col overflow-hidden">
              <Topbar
                email={user.email ?? ""}
                companyName={company?.name}
                role={role}
                readOnly={readOnly}
                unread={unread}
                sprintReady={sprintReady}
              />
              {readOnly && (
                <div className="shrink-0 border-b border-warning-border bg-warning-muted px-6 py-2 text-xs text-warning print:hidden">
                  You have <strong>read-only auditor access</strong>. You can review controls,
                  evidence and reports, but can&apos;t make changes.
                </div>
              )}
              <main className="flex-1 overflow-y-auto p-6 md:p-8">{children}</main>
            </div>
          </div>
        </CopilotPanelProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
