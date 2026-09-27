import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// /reset-password is intentionally NOT public — the recovery link signs the
// user in first, so anyone landing there without a session gets bounced to login.
// "/" is the public marketing landing; the root page itself still redirects
// signed-in users into the app. Matching is exact-or-prefixed ("/" only ever
// matches the root, never /dashboard), so the rest of the app stays gated.
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/auth",
  "/forgot-password",
  "/trust",
  // Tester-plan invite links (/trial/<code>) are handed to prospects who have no
  // account yet — the page itself pitches the trial and routes them into signup.
  "/trial",
  // The product demo — shown to people before they have an account, by design.
  "/demo",
  "/privacy",
  "/terms",
  "/thanks",
];

/** Bounce an unauthenticated request to login (or signup for invite links). */
function redirectToAuth(request: NextRequest, path: string, sessionExpired: boolean) {
  // Preserve where they were headed (e.g. an /join?token= invite link) so the
  // login page can send them back after they authenticate.
  const dest = request.nextUrl.pathname + request.nextUrl.search;

  const url = request.nextUrl.clone();
  // Invitees following a /join link almost always need to CREATE an account,
  // so send them to signup (which cross-links to sign-in for the rare returning
  // auditor, carrying `next` along). Everyone else lands on login as before.
  url.pathname = path.startsWith("/join") ? "/signup" : "/login";
  url.search = ""; // drop the original query so it doesn't leak onto the auth page
  // Only flag "expired" if the browser actually carried an auth cookie that failed —
  // a first-time visitor with no cookie shouldn't see a session-expired banner.
  if (sessionExpired) url.searchParams.set("reason", "expired");
  if (dest !== "/" && dest !== "/login") url.searchParams.set("next", dest);
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  // Does the browser carry a session cookie at all? supabase.auth.getUser()
  // validates the token against Supabase's auth server, which is a network round
  // trip — and our database is in Ireland. For a visitor in the US that round
  // trip crosses the Atlantic before anything renders, and until now it was
  // being paid by people who have never signed up, on the marketing homepage.
  //
  // With no cookie there is no session to validate: the answer is already known.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  if (!hasAuthCookie) {
    return isPublic ? response : redirectToAuth(request, path, false);
  }

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

  // The cookie was there but didn't validate — expired or revoked.
  if (!user && !isPublic) return redirectToAuth(request, path, true);

  // "/" is the post-login hub: AuthForm and /api/auth/confirm both default their
  // `next` to it. That decision used to live in the page, which forced the whole
  // marketing homepage to be rendered per-request — so every US visitor waited on
  // a transatlantic round trip for a page with no personal content on it. Making
  // the call here lets `/` be a static, CDN-cached page.
  //
  // /dashboard re-checks and sends anyone without a company to /onboarding, so
  // the no-company path is unchanged.
  if (user && path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
