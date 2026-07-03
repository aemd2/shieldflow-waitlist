import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listCopilotMessages } from "@/lib/db/queries";
import { isGroqConfigured } from "@/lib/groq";
import { Chat } from "@/components/copilot/Chat";
import { PageShell, Alert } from "@/components/ui/page";

export default async function CopilotPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const history = await listCopilotMessages(supabase, company.id, user.id, 50);

  return (
    <PageShell
      layout="stack"
      width="fill"
      title="Compliance Co-Pilot"
      subtitle="Ask about your controls, gaps, and what to do next. Grounded in your live data."
      alert={
        !isGroqConfigured() ? (
          <Alert variant="warning">
            AI is not configured yet. Add a <code>GROQ_API_KEY</code> to <code>.env.local</code> to
            start chatting.
          </Alert>
        ) : undefined
      }
    >
      <Chat
        initialMessages={history.map((m) => ({ role: m.role, content: m.content }))}
        aiEnabled={isGroqConfigured()}
      />
    </PageShell>
  );
}
