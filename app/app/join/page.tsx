import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { JoinClient } from "@/components/join/JoinClient";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary p-6">
        <div className="card w-full max-w-md space-y-2 text-center">
          <h1 className="text-xl font-semibold text-foreground">Invalid invite link</h1>
          <p className="text-sm text-muted-foreground">
            This invite link is missing its code. Ask the person who invited you to send it again.
          </p>
        </div>
      </div>
    );
  }

  // Backstop — middleware already redirects unauthenticated users here with `next`.
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/join?token=${token}`)}`);
  }

  return <JoinClient token={token} email={user.email ?? ""} />;
}
