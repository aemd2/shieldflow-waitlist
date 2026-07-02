import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listNotifications } from "@/lib/db/queries";
import { NotificationList } from "@/components/notifications/NotificationList";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function NotificationsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const notifications = await listNotifications(supabase, user.id, company.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        subtitle="Updates about your controls, integrations and team."
      />
      <NotificationList notifications={notifications} />
    </div>
  );
}
