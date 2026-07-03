import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  listTasks,
  getCallerAccess,
  getCompanyTeam,
  getControlsWithStatus,
  listRisks,
  listVendors,
  listPolicies,
} from "@/lib/db/queries";
import { TaskManager, type Linkable } from "@/components/tasks/TaskManager";
import { PageShell } from "@/components/ui/page";

export default async function TasksPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [tasks, access, team, controls, risks, vendors, policies] = await Promise.all([
    listTasks(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
    getCompanyTeam(supabase, company.id).catch(() => ({ members: [], invites: [] })),
    getControlsWithStatus(supabase, company.id),
    listRisks(supabase, company.id),
    listVendors(supabase, company.id),
    listPolicies(supabase, company.id),
  ]);
  const canWrite = access?.canWrite ?? false;

  // A compact, typed list for the "link this task to" picker — resolved to
  // real labels here so the client component never has to re-fetch or guess.
  const linkables: Linkable[] = [
    ...controls.map((c) => ({ type: "control" as const, id: c.id, label: `${c.code} · ${c.title}` })),
    ...risks.map((r) => ({ type: "risk" as const, id: r.id, label: r.title })),
    ...vendors.map((v) => ({ type: "vendor" as const, id: v.id, label: v.name })),
    ...policies.map((p) => ({ type: "policy" as const, id: p.id, label: p.title })),
  ];

  return (
    <PageShell
      layout="manager"
      title="Tasks"
      subtitle="Remediation work and recurring compliance obligations — assign owners, set due dates, and let recurring items (access reviews, pen tests, policy reviews) re-spawn when you complete them."
    >
      <TaskManager tasks={tasks} canWrite={canWrite} members={team.members} linkables={linkables} />
    </PageShell>
  );
}
