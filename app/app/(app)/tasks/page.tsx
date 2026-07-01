import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listTasks, getCallerAccess, getCompanyTeam } from "@/lib/db/queries";
import { TaskManager } from "@/components/tasks/TaskManager";

export default async function TasksPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [tasks, access, team] = await Promise.all([
    listTasks(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
    getCompanyTeam(supabase, company.id).catch(() => ({ members: [], invites: [] })),
  ]);
  const canWrite = access?.canWrite ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Remediation work and recurring compliance obligations — assign owners, set due
          dates, and let recurring items (access reviews, pen tests, policy reviews) re-spawn
          when you complete them.
        </p>
      </div>
      <TaskManager tasks={tasks} canWrite={canWrite} members={team.members} />
    </div>
  );
}
