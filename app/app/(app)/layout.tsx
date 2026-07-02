import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getCallerAccess, countUnreadNotifications } from "@/lib/db/queries";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";

// Authed pages must never be served from the browser bfcache after logout.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  // Onboarding pages render even when no company exists yet — handled in those pages.

  const access = company ? await getCallerAccess(supabase, company.id, user.id) : null;
  const role = access?.role ?? null;
  const readOnly = access?.role === "auditor";
  const unread = company ? await countUnreadNotifications(supabase, user.id, company.id) : 0;

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="flex h-screen overflow-hidden bg-secondary">
          {company && <Sidebar companyName={company.name} role={role} />}
          <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar email={user.email ?? ""} companyName={company?.name} role={role} readOnly={readOnly} unread={unread} />
            {readOnly && (
              <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-6 py-2 text-xs text-amber-800 print:hidden">
                You have <strong>read-only auditor access</strong>. You can review controls,
                evidence and reports, but can&apos;t make changes.
              </div>
            )}
            <main className="flex-1 overflow-y-auto p-6 md:p-8">{children}</main>
          </div>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
