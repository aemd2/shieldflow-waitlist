import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// /reset-password is intentionally NOT public — the recovery link signs the
// user in first, so anyone landing there without a session gets bounced to login.
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/auth",
  "/forgot-password",
  "/trust",
  "/privacy",
  "/terms",
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    // Preserve where they were headed (e.g. an /join?token= invite link) so the
    // login page can send them back after they authenticate.
    const dest = request.nextUrl.pathname + request.nextUrl.search;

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = ""; // drop the original query so it doesn't leak onto /login
    // Only flag "expired" if the browser actually carried an auth cookie that failed —
    // a first-time visitor with no cookie shouldn't see a session-expired banner.
    const hadAuthCookie = request.cookies
      .getAll()
      .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
    if (hadAuthCookie) url.searchParams.set("reason", "expired");
    if (dest !== "/" && dest !== "/login") url.searchParams.set("next", dest);
    return NextResponse.redirect(url);
  }

  return response;
}
