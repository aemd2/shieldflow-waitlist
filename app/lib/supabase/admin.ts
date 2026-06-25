// Service-role Supabase client — BYPASSES RLS. Server-only, and only for code
// paths that have no user session by design (currently: the Stripe webhook).
// Never import this from anything reachable by client components.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function isAdminConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function createAdminSupabase(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
