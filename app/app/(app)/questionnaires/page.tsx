import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  listQuestionnaires,
  listQuestionnaireItems,
  getCallerAccess,
} from "@/lib/db/queries";
import { isGroqConfigured } from "@/lib/groq";
import { QuestionnaireWorkspace } from "@/components/questionnaires/QuestionnaireWorkspace";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function QuestionnairesPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [questionnaires, items, access] = await Promise.all([
    listQuestionnaires(supabase, company.id),
    listQuestionnaireItems(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
  ]);
  const canWrite = access?.canWrite ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security questionnaires"
        subtitle="Paste a customer or RFP security questionnaire, draft answers with AI grounded only in your compliance data, review what needs a human, and export to CSV."
      />
      <QuestionnaireWorkspace
        questionnaires={questionnaires}
        items={items}
        aiEnabled={isGroqConfigured()}
        canWrite={canWrite}
      />
    </div>
  );
}
