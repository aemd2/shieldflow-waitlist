import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getControlsWithStatus,
  listFrameworks,
  listSelectedFrameworkIds,
  listVendors,
  listPolicies,
  listAllEvidence,
} from "@/lib/db/queries";
import { computeScore, countStatuses } from "@/lib/score";
import { computeAlerts } from "@/lib/monitoring";
import { PrintButton } from "@/components/reports/PrintButton";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  complete: "Complete",
  in_progress: "In progress",
  not_started: "Not started",
};

const RISK_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export default async function ReportsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [controls, allFrameworks, selectedIds, vendors, policies, evidence] = await Promise.all([
    getControlsWithStatus(supabase, company.id),
    listFrameworks(supabase),
    listSelectedFrameworkIds(supabase, company.id),
    listVendors(supabase, company.id),
    listPolicies(supabase, company.id),
    listAllEvidence(supabase, company.id),
  ]);

  const frameworks = allFrameworks.filter((f) => selectedIds.includes(f.id));
  const statuses = controls.map((c) => c.status);
  const score = computeScore(statuses);
  const counts = countStatuses(statuses);

  const frameworkProgress = frameworks.map((f) => {
    const subset = controls.filter((c) => c.framework_id === f.id).map((c) => c.status);
    return { id: f.id, name: f.name, pct: computeScore(subset) };
  });

  const alerts = computeAlerts(controls, frameworkProgress, vendors);
  const finalPolicies = policies.filter((p) => p.status === "final");
  const generatedAt = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Toolbar — hidden when printing */}
      <div className="print:hidden">
        <PageHeader
          title="Audit report"
          subtitle="A one-page compliance snapshot to share with auditors and prospects. Save it as a PDF."
          actions={<PrintButton />}
        />
      </div>

      {/* The printable report */}
      <article className="report mx-auto max-w-4xl rounded-lg border border-border bg-white p-8 text-sm text-foreground print:max-w-none print:rounded-none print:border-0 print:p-0">
        {/* Header */}
        <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-[var(--brand-emerald)]">
              ShieldFlow · Compliance Report
            </div>
            <h2 className="mt-1 text-2xl font-bold">{company.name}</h2>
            <div className="mt-1 text-xs text-muted-foreground">
              {frameworks.length > 0
                ? frameworks.map((f) => f.name).join(" · ")
                : "No frameworks selected"}{" "}
              · Generated {generatedAt}
            </div>
          </div>
          <div className="text-right">
            <div className="text-4xl font-bold text-[var(--brand-emerald)]">{score}%</div>
            <div className="text-xs text-muted-foreground">Overall readiness</div>
          </div>
        </header>

        {/* Executive summary */}
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Summary
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Controls complete" value={`${counts.complete}/${controls.length}`} />
            <Metric label="In progress" value={counts.in_progress} />
            <Metric label="Not started" value={counts.not_started} />
            <Metric label="Open alerts" value={alerts.length} />
            <Metric label="Frameworks" value={frameworks.length} />
            <Metric label="Final policies" value={finalPolicies.length} />
            <Metric label="Evidence files" value={evidence.length} />
            <Metric label="Vendors tracked" value={vendors.length} />
          </div>
        </section>

        {/* Framework progress */}
        {frameworkProgress.length > 0 && (
          <Section title="Framework progress">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {frameworkProgress.map((fp) => (
                  <tr key={fp.id} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-4">{fp.name}</td>
                    <td className="py-1.5 text-right font-medium">{fp.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Open alerts */}
        {alerts.length > 0 && (
          <Section title={`Open items (${alerts.length})`}>
            <ul className="space-y-1">
              {alerts.slice(0, 25).map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="font-semibold uppercase text-[10px] tracking-wide text-muted-foreground">
                    {a.severity}
                  </span>
                  <span className="text-muted-foreground">{a.detail}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Controls detail */}
        <Section title={`Controls (${controls.length})`}>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Code</th>
                <th className="py-1.5 pr-3 font-medium">Control</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium">Owner</th>
                <th className="py-1.5 pr-3 font-medium">Due</th>
                <th className="py-1.5 text-right font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {controls.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3 whitespace-nowrap font-mono">{c.code}</td>
                  <td className="py-1.5 pr-3">{c.title}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{STATUS_LABEL[c.status] ?? c.status}</td>
                  <td className="py-1.5 pr-3">{c.owner_email ?? "—"}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{c.due_date ?? "—"}</td>
                  <td className="py-1.5 text-right">{c.evidenceCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* Policies */}
        {finalPolicies.length > 0 && (
          <Section title={`Published policies (${finalPolicies.length})`}>
            <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
              {finalPolicies.map((p) => (
                <li key={p.id}>{p.title}</li>
              ))}
            </ul>
          </Section>
        )}

        {/* Vendors */}
        {vendors.length > 0 && (
          <Section title={`Vendors (${vendors.length})`}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Vendor</th>
                  <th className="py-1.5 pr-3 font-medium">Category</th>
                  <th className="py-1.5 pr-3 font-medium">Risk</th>
                  <th className="py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3">{v.name}</td>
                    <td className="py-1.5 pr-3">{v.category ?? "—"}</td>
                    <td className="py-1.5 pr-3">{RISK_LABEL[v.risk_level] ?? v.risk_level}</td>
                    <td className="py-1.5">{v.status.replace("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Footer */}
        <footer className="mt-8 border-t border-border pt-3 text-[10px] text-muted-foreground">
          Confidential — prepared for {company.name}. Generated by ShieldFlow on {generatedAt}.
          This report reflects self-attested compliance status and is not a substitute for a formal audit.
        </footer>
      </article>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 break-inside-avoid">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
