import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { AuthForm } from "@/components/auth/AuthForm";

export default async function LoginPage() {
  // Already signed in? Don't show the login form — send them into the app.
  // (Scoped to this page, not the shared (auth) layout, so the recovery-session
  // flow on /reset-password keeps working.)
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/");

  return (
    <Suspense fallback={<div className="card h-80 animate-pulse" />}>
      <AuthForm mode="login" />
    </Suspense>
  );
}
