import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getControlWithStatus,
  listEvidence,
  getChecksForControl,
  getCallerAccess,
} from "@/lib/db/queries";
import type { ControlCheck } from "@/lib/db/queries";
import { StatusPicker } from "@/components/dashboard/StatusPicker";
import { ControlMetaForm } from "@/components/controls/ControlMetaForm";
import { EvidenceUploader } from "@/components/evidence/EvidenceUploader";
import { EvidenceList } from "@/components/evidence/EvidenceList";

export default async function ControlDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A hand-typed /controls/garbage URL would hit Postgres with an invalid uuid
  // cast and land on the error boundary — a 404 is the truthful answer.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const control = await getControlWithStatus(supabase, company.id, id);
  if (!control) notFound();

  const [evidence, checks, access] = await Promise.all([
    listEvidence(supabase, company.id, id),
    getChecksForControl(supabase, company.id, id),
    getCallerAccess(supabase, company.id, user.id),
  ]);

  const canWrite = access?.canWrite ?? false;
  const hasFailingCheck = checks.some((c) => c.result === "fail");

  const statusLabel =
    control.status === "complete"
      ? "Complete"
      : control.status === "in_progress"
        ? "In progress"
        : "Not started";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Back to dashboard
      </Link>

      <div className="card space-y-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {control.category ?? "Control"} &middot; {control.code}
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">{control.title}</h1>
        </div>

        {control.description && (
          <p className="text-sm leading-relaxed text-muted-foreground">{control.description}</p>
        )}

        <div className="border-t border-border pt-4">
          <div className="mb-2 text-sm font-medium">Status</div>
          {canWrite ? (
            <StatusPicker controlId={control.id} current={control.status} />
          ) : (
            <div className="text-sm text-muted-foreground">{statusLabel}</div>
          )}
          {control.status === "complete" && hasFailingCheck && (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This control is marked complete, but an automated check below is failing. Review the
              evidence or fix the underlying setting.
            </div>
          )}
        </div>
      </div>

      {checks.length > 0 && (
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Automated checks</h2>
          <ul className="space-y-2">
            {checks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Evaluated automatically from connected integrations. Re-sync the integration to refresh.
          </p>
        </div>
      )}

      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Ownership &amp; due date</h2>
        {canWrite ? (
          <ControlMetaForm
            controlId={control.id}
            ownerEmail={control.owner_email}
            dueDate={control.due_date}
            notes={control.notes}
          />
        ) : (
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <dt className="text-muted-foreground">Owner</dt>
            <dd className="col-span-2 text-foreground">{control.owner_email ?? "—"}</dd>
            <dt className="text-muted-foreground">Due date</dt>
            <dd className="col-span-2 text-foreground">{control.due_date ?? "—"}</dd>
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="col-span-2 whitespace-pre-wrap text-foreground">{control.notes ?? "—"}</dd>
          </dl>
        )}
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Evidence <span className="text-muted-foreground">({evidence.length})</span>
          </h2>
          {canWrite && <EvidenceUploader companyId={company.id} controlId={control.id} />}
        </div>
        <EvidenceList items={evidence} controlId={control.id} canWrite={canWrite} />
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: ControlCheck }) {
  const style = {
    pass: "border-emerald-300 bg-emerald-50 text-emerald-800",
    fail: "border-destructive/30 bg-destructive/10 text-destructive",
    inconclusive: "border-border bg-secondary text-muted-foreground",
  }[check.result];
  const label = { pass: "Pass", fail: "Fail", inconclusive: "Inconclusive" }[check.result];
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${style}`}>
        {label}
      </span>
      <div className="min-w-0">
        <div className="text-sm text-foreground">{check.detail ?? check.check_key}</div>
        <div className="text-xs text-muted-foreground">
          {check.provider} &middot; {new Date(check.evaluated_at).toLocaleDateString()}
        </div>
      </div>
    </li>
  );
}
