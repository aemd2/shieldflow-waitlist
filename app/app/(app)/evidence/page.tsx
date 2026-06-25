import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getControlsWithStatus,
  listAllEvidence,
} from "@/lib/db/queries";

export default async function EvidencePage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [evidence, controls] = await Promise.all([
    listAllEvidence(supabase, company.id),
    getControlsWithStatus(supabase, company.id),
  ]);
  const controlById = new Map(controls.map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Evidence vault</h1>
        <p className="text-sm text-muted-foreground">
          All evidence collected across your controls. Upload from any control page.
        </p>
      </div>

      {evidence.length === 0 ? (
        <div className="card text-center text-sm text-muted-foreground">
          No evidence yet. Open a control and upload your first file.
        </div>
      ) : (
        <section className="card p-0">
          <ul className="divide-y divide-border">
            {evidence.map((ev) => {
              const c = ev.control_id ? controlById.get(ev.control_id) : null;
              return (
                <li key={ev.id} className="flex items-center justify-between gap-4 px-6 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {ev.file_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(ev.created_at).toLocaleDateString()}
                      {c && <> · linked to {c.code}</>}
                    </div>
                  </div>
                  {c && (
                    <Link
                      href={`/controls/${c.id}`}
                      className="shrink-0 text-xs text-foreground underline"
                    >
                      View control
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
