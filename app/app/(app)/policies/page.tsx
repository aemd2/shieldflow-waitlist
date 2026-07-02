import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  listFrameworks,
  listSelectedFrameworkIds,
  listPolicies,
  listPolicyAcknowledgements,
  getCompanyMemberCount,
  getCallerAccess,
} from "@/lib/db/queries";
import { isGroqConfigured } from "@/lib/groq";
import { PolicyWorkspace } from "@/components/policies/PolicyGenerator";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{ policy?: string }>;
}) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const { policy: policyParam } = await searchParams;

  const [policies, allFrameworks, selectedIds, access, acks, memberCount] = await Promise.all([
    listPolicies(supabase, company.id),
    listFrameworks(supabase),
    listSelectedFrameworkIds(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
    listPolicyAcknowledgements(supabase, company.id),
    getCompanyMemberCount(supabase, company.id),
  ]);
  const frameworks = allFrameworks.filter((f) => selectedIds.includes(f.id));
  const canWrite = access?.canWrite ?? false;
  const canApprove = access?.role === "owner" || access?.role === "admin";
  const isAuditor = access?.role === "auditor";
  // Notification deep-links land as ?policy=<uuid> — only honour ids in this workspace.
  const initialPolicyId =
    policyParam && policies.some((p) => p.id === policyParam) ? policyParam : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Policies"
        subtitle="Generate audit-ready policy documents with AI, then edit and finalize."
      />

      {!isGroqConfigured() && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          AI is not configured yet. Add a <code>GROQ_API_KEY</code> to{" "}
          <code>.env.local</code> to enable policy generation. You can still view and edit
          existing policies.
        </div>
      )}

      <PolicyWorkspace
        frameworks={frameworks}
        policies={policies}
        aiEnabled={isGroqConfigured()}
        canWrite={canWrite}
        canApprove={canApprove}
        isAuditor={isAuditor}
        acks={acks}
        memberCount={memberCount}
        currentUserId={user.id}
        initialPolicyId={initialPolicyId}
      />
    </div>
  );
}
