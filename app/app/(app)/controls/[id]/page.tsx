import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getControlWithStatus,
  listEvidence,
  getChecksForControl,
  getCallerAccess,
  listFrameworks,
  getCompanyTeam,
  listControlOrderForCompany,
} from "@/lib/db/queries";
import type { ControlCheck } from "@/lib/db/queries";
import { flattenControlOrder } from "@/lib/controls-order";
import { StatusPicker } from "@/components/dashboard/StatusPicker";
import { CriticalityBadge } from "@/components/controls/CriticalityBadge";
import { ControlMetaForm } from "@/components/controls/ControlMetaForm";
import { EvidenceUploader } from "@/components/evidence/EvidenceUploader";
import { EvidenceList } from "@/components/evidence/EvidenceList";
import { PageShell, Alert } from "@/components/ui/page";

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

  const [evidence, checks, access, frameworks, team, controlOrder] = await Promise.all([
    listEvidence(supabase, company.id, id),
    getChecksForControl(supabase, company.id, id),
    getCallerAccess(supabase, company.id, user.id),
    listFrameworks(supabase),
    getCompanyTeam(supabase, company.id).catch(() => ({ members: [], invites: [] })),
    listControlOrderForCompany(supabase, company.id).catch(() => []),
  ]);

  // Same category grouping ControlList renders on the dashboard, flattened —
  // so Previous/Next steps through controls in the order the user actually
  // sees them scrolling the list, not an arbitrary global code sort.
  const ordered = flattenControlOrder(controlOrder);
  const myIndex = ordered.findIndex((c) => c.id === control.id);
  const prevControl = myIndex > 0 ? ordered[myIndex - 1] : null;
  const nextControl = myIndex >= 0 && myIndex < ordered.length - 1 ? ordered[myIndex + 1] : null;

  const framework = frameworks.find((f) => f.id === control.framework_id);
  const suggestedEvidence = (control.suggested_evidence ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const canWrite = access?.canWrite ?? false;
  const hasFailingCheck = checks.some((c) => c.result === "fail");

  const statusLabel =
    control.status === "complete"
      ? "Complete"
      : control.status === "in_progress"
        ? "In progress"
        : "Not started";

  return (
    <PageShell
      layout="stack"
      title={control.title}
      subtitle={`${framework ? `${framework.name} · ` : ""}${control.category ?? "Control"} · ${control.code}`}
      actions={<CriticalityBadge criticality={control.criticality} />}
      banner={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            &larr; Back to dashboard
          </Link>
          {ordered.length > 1 && (
            <div className="flex items-center gap-3 text-sm">
              {prevControl ? (
                <Link
                  href={`/controls/${prevControl.id}`}
                  className="flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground"
                  title={`${prevControl.code} · ${prevControl.title}`}
                >
                  <ChevronLeft className="h-4 w-4 shrink-0" />
                  <span className="max-w-[10rem] truncate sm:max-w-[16rem]">{prevControl.code}</span>
                </Link>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground/40">
                  <ChevronLeft className="h-4 w-4" />
                </span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">
                {myIndex >= 0 ? `${myIndex + 1} of ${ordered.length}` : null}
              </span>
              {nextControl ? (
                <Link
                  href={`/controls/${nextControl.id}`}
                  className="flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground"
                  title={`${nextControl.code} · ${nextControl.title}`}
                >
                  <span className="max-w-[10rem] truncate sm:max-w-[16rem]">{nextControl.code}</span>
                  <ChevronRight className="h-4 w-4 shrink-0" />
                </Link>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground/40">
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
            </div>
          )}
        </div>
      }
    >
      <div className="card space-y-4">
        {control.description && (
          <p className="text-sm leading-relaxed text-muted-foreground">{control.description}</p>
        )}

        <div className={control.description ? "border-t border-border pt-4" : undefined}>
          <div className="mb-2 text-sm font-medium">Status</div>
          {canWrite ? (
            <StatusPicker controlId={control.id} current={control.status} />
          ) : (
            <div className="text-sm text-muted-foreground">{statusLabel}</div>
          )}
          {control.status === "complete" && hasFailingCheck && (
            <Alert variant="warning" className="mt-3 text-xs">
              This control is marked complete, but an automated check below is failing. Review the
              evidence or fix the underlying setting.
            </Alert>
          )}
        </div>
      </div>

      {control.guidance && (
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold text-foreground">How to satisfy this control</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{control.guidance}</p>
        </div>
      )}

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
            members={team.members}
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
        {suggestedEvidence.length > 0 && (
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Evidence auditors typically expect
            </div>
            <ul className="mt-2 space-y-1">
              {suggestedEvidence.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        <EvidenceList items={evidence} controlId={control.id} canWrite={canWrite} />
      </div>
    </PageShell>
  );
}

function CheckRow({ check }: { check: ControlCheck }) {
  const style = {
    pass: "border-success-border bg-success-muted text-success",
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
