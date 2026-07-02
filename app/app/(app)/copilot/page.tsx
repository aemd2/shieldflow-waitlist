import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listCopilotMessages } from "@/lib/db/queries";
import { isGroqConfigured } from "@/lib/groq";
import { Chat } from "@/components/copilot/Chat";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function CopilotPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const history = await listCopilotMessages(supabase, company.id, user.id, 50);

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <div className="mb-4">
        <PageHeader
          title="Compliance Co-Pilot"
          subtitle="Ask about your controls, gaps, and what to do next. Grounded in your live data."
        />
      </div>

      {!isGroqConfigured() && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          AI is not configured yet. Add a <code>GROQ_API_KEY</code> to <code>.env.local</code> to
          start chatting.
        </div>
      )}

      <Chat
        initialMessages={history.map((m) => ({ role: m.role, content: m.content }))}
        aiEnabled={isGroqConfigured()}
      />
    </div>
  );
}
