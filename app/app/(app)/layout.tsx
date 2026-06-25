import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getCallerAccess } from "@/lib/db/queries";
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
  const readOnly = access?.role === "auditor";

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="flex min-h-screen bg-secondary">
          {company && <Sidebar companyName={company.name} />}
          <div className="flex flex-1 flex-col">
            <Topbar email={user.email ?? ""} companyName={company?.name} readOnly={readOnly} />
            {readOnly && (
              <div className="border-b border-amber-300 bg-amber-50 px-6 py-2 text-xs text-amber-800 print:hidden">
                You have <strong>read-only auditor access</strong>. You can review controls,
                evidence and reports, but can&apos;t make changes.
              </div>
            )}
            <main className="flex-1 p-6 md:p-8">{children}</main>
          </div>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
