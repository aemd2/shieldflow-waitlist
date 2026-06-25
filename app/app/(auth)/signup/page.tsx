import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { AuthForm } from "@/components/auth/AuthForm";

export default async function SignupPage() {
  // Already signed in? Skip the signup form and go to the app.
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/");

  return (
    <Suspense fallback={<div className="card h-80 animate-pulse" />}>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
