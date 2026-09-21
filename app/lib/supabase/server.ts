import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware refreshes the session.
          }
        },
      },
    },
  );
}

/**
 * The signed-in user for this request, fetched at most once.
 *
 * supabase.auth.getUser() is a network call — it validates the token against
 * Supabase's auth server rather than trusting the cookie, which is exactly why
 * it's the right function to use on the server. The cost is a round trip, and
 * our auth server is in Ireland.
 *
 * Every authed page rendered it twice: once in (app)/layout.tsx and again in the
 * page itself, in the same render pass. React's cache() collapses those to one
 * call per request. For a visitor in the US that removes a full transatlantic
 * round trip from every single page load.
 *
 * Deliberately still a real validation, not a cookie read — the saving comes
 * from not repeating the question, not from trusting the answer less.
 */
export const getRequestUser = cache(async () => {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
