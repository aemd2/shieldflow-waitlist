# ShieldFlow — Edge Cases & How We Solved Them

Every failure mode we identified, and the fix that ships in the code. File references are relative to `app - ShieldFlow/`.

## Auth & session

| Edge case | Solution |
|---|---|
| User signs up but Supabase requires email confirmation → "Invalid login credentials" confusion | `components/auth/AuthForm.tsx` detects the no-session signup response and shows a "check your inbox" banner; `app/api/auth/confirm/route.ts` handles both OTP and PKCE confirmation links. |
| Session expires mid-use → confusing redirect | Middleware redirects to `/login?reason=expired` and shows a banner — but **only** if an `sb-*-auth-token` cookie was actually present, so first-time visitors never see a false "session expired" message. |
| Back button after logout shows a cached protected page | `export const dynamic = "force-dynamic"` on the authenticated layout — no bfcache of authed pages. |
| Logged out in **another tab**, then uses AI in this tab | `/api/policy` and `/api/copilot` return 401 JSON; `Chat.tsx` and `PolicyGenerator.tsx` detect 401 and redirect to `/login?reason=expired` instead of showing a cryptic error. |
| Double-submit on any form | Buttons disable while pending; server actions are idempotent. |
| Mobile keyboard autocapitalizes / adds trailing space to the email ("John@Acme.com ") | Email is normalized (`trim().toLowerCase()`) before every auth call — signup, login, and password reset always agree on the address. |
| **Open redirect** via the confirm link (`?next=https://evil.com`) | `app/api/auth/confirm/route.ts` only accepts `next` values that start with `/` and not `//` — anything else falls back to `/`. |
| Magic-link button spammed → Supabase email quota burned, auth emails rate-limited for everyone | 60-second client cooldown after each send ("Link sent — check your inbox"); Supabase's own server-side rate limit backs it up. |
| Google sign-in clicked before the provider is enabled in Supabase | The "provider is not enabled" error is mapped to a friendly "use email and password for now" message. |
| Network drops mid sign-in/sign-up (offline, Supabase unreachable) → the auth call rejects, button stuck on "Please wait…" forever | Every auth call (password, signup, Google, magic link) is wrapped in try/catch/finally — a thrown fetch shows "We couldn't reach the server. Check your connection and try again." and always re-enables the button. |
| Already-signed-in user navigates to `/login` or `/signup` | Both pages check the session server-side and redirect into the app — no "log in again" while already authenticated. Scoped to the pages (not the shared `(auth)` layout) so the recovery-session `/reset-password` flow is unaffected. |
| Mobile keyboard autocapitalizes / autocorrects the email field | The email input sets `inputMode="email"`, `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck=false` — what the user sees matches what's submitted (we also normalize in JS as a backstop). |
| Legacy user whose password is shorter than the current 8-char rule can't even submit the login form | `minLength` is enforced only in signup (creating a credential); login omits it so any existing password can be entered and matched. |
| `type="email"` accepts malformed addresses like `name@gmailcom` or `name@x.c` | A stricter check (`isLikelyValidEmail`, `lib/email.ts`) requires a real dot-separated TLD ≥ 2 chars and rejects doubled/edge dots — caught **before** any network request, on both the password and magic-link paths. |
| Domain typo — `gmial.com`, `gmail.con`, `hotmial.com`, or a custom `acme.con` | `suggestEmailCorrection` (Levenshtein vs. popular providers + common TLDs) shows a one-click "Did you mean name@gmail.com?" on blur and on a failed submit; clicking it fixes the field. |
| Cryptic raw Supabase auth errors shown to the user | Every auth response routes through `friendlyAuthError` (`lib/auth-errors.ts`) — matches on the stable error `code` first, covering invalid credentials, unconfirmed email, duplicate account, weak/leaked password, invalid email, signups disabled, provider disabled, captcha, and all the rate-limit codes. |
| **Free-tier email cap hit** (`over_email_send_rate_limit`) on signup / magic link / reset | Mapped to "Too many emails were just sent from this project — wait a few minutes." The magic-link 60s cooldown and signup/login attempt limits reduce how often it's reached; SETUP.md documents wiring custom SMTP. |
| Auth endpoint rate-limited (HTTP 429 / `over_request_rate_limit`) | Mapped to "Too many attempts — wait a minute." |
| Brute-forcing a password by repeated guessing | After 5 consecutive `invalid_credentials` the form locks for 30s with a live countdown button ("Try again in 12s") and suggests a reset — also keeps the project under Supabase's per-IP auth limit. |
| Double-submit via a second Enter/click while a request is in flight | Each handler returns early if `loading` (or the lockout/cooldown) is active — no duplicate signups or duplicate emails. |
| Password longer than 72 bytes silently truncated by bcrypt | Password input is capped at `maxLength=72` (bcrypt's real limit), so what the user types is exactly what's hashed — no invisible truncation surprising them at next login. |
| Over-long email pasted (DoS-y / accidental) | `maxLength=254` on the email input (the RFC ceiling). |
| Password typo'd because the field is masked | Show/hide (eye) toggle on the password field lets the user verify before submitting — fewer failed logins, fewer wasted requests. |
| Caps Lock on while typing the password | A "Caps Lock is on" hint appears under the field (detected via `getModifierState`). |
| Password of only spaces at signup | Rejected client-side ("Your password can't be only spaces") — passes `minLength` but is virtually always a slip. |
| Weak or breached password at signup (when Supabase leaked-password protection is on) | The `weak_password` code is mapped to "use at least 8 characters and mix in letters, numbers, and a symbol." |

## Account recovery

| Edge case | Solution |
|---|---|
| User forgets their password — previously there was **no way back in** | Full reset flow: `/forgot-password` (request link) → email → `/api/auth/confirm?type=recovery` (signs the user in) → `/reset-password` (set a new password) → dashboard. |
| Attacker probes which emails are registered via the reset form | The form always shows "If an account exists, a link is on its way" — identical response whether or not the email exists (no account enumeration). |
| Reset link opened after it expired / without a session | `/reset-password` is a protected route — without the recovery session the middleware bounces to login; an expired recovery session on submit shows "request a new link". |
| New password same as old, too short, or mismatched | Inline checks (min 8, match) before submit; Supabase's "must be different" error is mapped to a friendly message. |

## Onboarding

| Edge case | Solution |
|---|---|
| Partial failure (company created, member insert fails) → orphan company hidden by RLS → broken dashboard | Single atomic `SECURITY DEFINER` RPC `create_company_with_framework()` — company + member + framework + seeded statuses succeed or fail together. |
| User re-visits `/onboarding` after completing it (or completes it in another tab) | Page redirects to `/dashboard` if a company exists; the RPC also guards one-company-per-owner. |
| Whitespace-only or control-character company name ("   ", `\x00abc`) | `onboardingSchema` strips control chars, trims, and requires at least two letters/digits (`lib/validation.ts`). |
| Framework with zero controls | `computeScore` returns 0 for an empty list — no NaN, no division by zero. |
| Adding the same framework twice | `add_framework_to_company()` uses `ON CONFLICT DO NOTHING` on both the framework link and the seeded statuses — fully idempotent. |

## Controls

| Edge case | Solution |
|---|---|
| Impossible due date (`2024-02-30`) passes a format-only regex | `controlMetaSchema` now validates it's a **real calendar date** between 2000 and 2100 (`isRealDate` in `lib/validation.ts`). |
| Garbage owner email | Zod `.email()` validation with a friendly field error. |
| Non-UUID `controlId` sent to the status action → raw Postgres cast error | `updateControlStatus` validates the id as a UUID up front and returns a clean "Invalid control." |
| Two users edit the same control simultaneously | Last-write-wins on a single row (correct for this data); `revalidatePath` keeps both views fresh on next load. |

## Evidence vault

| Edge case | Solution |
|---|---|
| File uploads to Storage, then the DB insert fails → orphaned file eats quota | `recordEvidence()` deletes the just-uploaded object on insert failure (compensating cleanup). |
| DB row exists but the file is gone (reverse orphan) | `getEvidenceUrl()` returns "File is currently unavailable" instead of crashing. |
| 0-byte, >10MB, or `.exe` upload | Triple defense: client pre-check in `EvidenceUploader.tsx`, bucket-level `file_size_limit` + `allowed_mime_types`, and the `accept` attribute on the file input. |
| Filename with `../`, unicode, or path separators | Stored as `{company_id}/{control_id}/{uuid}-{sanitized}` — `sanitizeFileName()` strips separators and unsafe chars; traversal is impossible and collisions can't happen. |
| Tampered client uploads to another company's folder | `recordEvidence()` verifies the storage path starts with the caller's own company ID, and Storage RLS checks folder membership independently. |
| Tampered client calls `recordEvidence` directly with a fake 5GB `sizeBytes`, `.exe` mime, or 100KB note | `evidenceRecordSchema` re-validates every claimed field server-side (uuid, mime allow-list, size ≤ 10MB, note ≤ 500 chars); on bad input the uploaded object is removed too. |
| Storage quota (1GB free tier) is full → endless generic "Upload failed" retries | The uploader inspects the error: quota/exceeded → "Storage is full — contact support"; duplicate path → "Upload collision — try again"; everything else stays generic. |
| Signed URL opened after it expires | URLs live 60 seconds and a **fresh one is minted on every click** — there is no stored stale link. |
| Delete: DB row removed but Storage delete fails | Row is deleted first (UI stays consistent); Storage removal is best-effort — worst case is a quota-only leak, never a broken UI. |

## AI (Policy Generator + Co-Pilot)

| Edge case | Solution |
|---|---|
| `GROQ_API_KEY` missing | Routes return 503 "AI not configured"; pages show a friendly banner; the rest of the app and the build are unaffected. |
| Groq rate-limited (429) or down (5xx) | `lib/groq.ts` maps every failure to a friendly "high demand, try again" message; user input is preserved for retry. |
| Request hangs forever | 30-second `AbortController` timeout on every Groq call. |
| One user spams the AI endpoints with curl (bypassing the disabled button) | **Server-side rate limit** (`lib/rate-limit.ts`): 5 policy generations/min and 10 co-pilot messages/min per user → 429 with a friendly message. The check runs **before** the message is persisted, so a flood can't fill the DB either. |
| Prompt injection via company name (e.g. a company named "Ignore previous instructions…") | `sanitizeForPrompt()` collapses newlines and control chars and caps length before any user value is interpolated into a prompt; the system prompt stays authoritative. |
| XSS via model output (`<script>` in a generated policy) | `components/ui/Markdown.tsx` builds React elements from the text — model output is never rendered as raw HTML, no `dangerouslySetInnerHTML` anywhere. |
| User navigates away mid-stream | Client `AbortController` cancels; the user message was persisted up front, the assistant message persists only on completion — history never contains a half-written turn. |
| Empty/garbage model response | Client drops the empty assistant bubble and shows "Empty response. Please try again." |
| Token-limit blowups on big companies | Grounding context is compact summaries only (control codes + statuses, policy titles — never full bodies), history capped at last 10 turns, `max_tokens` capped on output. |
| Two tabs streaming at once | Allowed but naturally bounded by the per-user server-side rate limit; each stream persists independently. |
| Model wraps the whole policy in ``` fences → saved document renders as one giant code block | `/api/policy` detects and unwraps a full-document code fence before returning. |
| AI output contains links — `[text](url)` rendered as ugly literal brackets, or worse, a `javascript:` link | `Markdown.tsx` renders **only** `http(s)://` links as anchors (with `rel="noopener noreferrer"`, new tab); any other scheme stays plain text. |
| `createPolicy` accepted unvalidated input (only `savePolicy` had Zod) | `policyCreateSchema` now validates title/body/frameworkId on create; `deletePolicy` validates its UUID too. |

## Scale (100 users, free tiers)

| Edge case | Solution |
|---|---|
| RLS re-evaluating `auth.uid()` per row → slow queries under load | All policies rewritten with `(select auth.uid())` / `(select is_company_member(...))` scalar subqueries — evaluated once per query (migration `0004_rls_perf.sql`). |
| Anonymous users calling SECURITY DEFINER functions via PostgREST | `EXECUTE` revoked from `anon`/`public`, granted only to `authenticated` (migration `0005_function_grants.sql`). |
| One user filling the 1GB storage quota | 10MB per-file bucket limit + mime allow-list; upload errors surface as a clear message. |
| Co-pilot history growing unbounded in memory/tokens | Loaded history capped at 50 messages, prompt history at 10. |
| Co-pilot rows accumulating in the DB forever (free-tier bloat) | After each assistant turn, rows beyond the newest 200 per user are pruned — best-effort, never affects the response. |
| Supabase free project pauses after ~7 days idle | First request fails gracefully via error boundaries with a retry — documented ops note, restore from the Supabase dashboard. |

## Billing (Stripe, test mode)

| Edge case | Solution |
|---|---|
| Forged webhook calls | Signature verified with `STRIPE_WEBHOOK_SECRET` before anything is parsed; missing/invalid → 400. |
| Webhook event without `company_id` metadata (e.g. created outside the app) | Acknowledged with 200 and ignored — never crashes, never writes garbage. |
| Replayed / out-of-order events | Writes are idempotent upserts keyed by `company_id`; a replay converges to the same state. |
| DB down while processing a webhook | Returns 500 so Stripe automatically retries later. |
| User spams the checkout button | Server-side rate limit (5/min) + button disabled while redirecting. |
| Subscriptions table tampering from the client | The table has **no** authenticated write policies — only the webhook (service role) can write. |
| Stripe not configured | Billing page shows a friendly banner; checkout actions return clean errors. |
| **Webhook never arrives** (no `stripe listen` locally, endpoint down in prod) → user paid but no plan shows | The success URL carries `session_id`; the billing page **reconciles directly with Stripe** on return — verifies the session is paid AND belongs to this company, then upserts. Idempotent with the webhook. |
| Subscribe clicked in two tabs → two real Stripe subscriptions | `startCheckout` refuses when a non-canceled subscription already exists — "manage it from the billing portal". |
| Tampered `session_id` in the success URL | Format-validated (`cs_...`), then the session's own server-set `metadata.company_id` must match the caller's company — someone else's session id does nothing. |

## Integrations (Google Workspace)

| Edge case | Solution |
|---|---|
| CSRF on the OAuth callback | Random `state` nonce mirrored in an HttpOnly cookie and verified in the callback. |
| User denies consent at Google | Redirected back with a clear "nothing was connected" message. |
| Access revoked at Google later | Refresh fails → integration flagged `error` → UI shows a "Reconnect" button. |
| Connected account isn't a Workspace admin | Admin API 403 mapped to "connect with an admin account". |
| Google returns no refresh token on reconnect | `prompt=consent` forces one; and an existing refresh token is never overwritten with null. |
| Sync spam | Rate-limited to 1 sync per minute per company. |
| Report file vs. bucket mime allow-list | Report is CSV (allowed) — not JSON (which the bucket would reject). |
| Sync upload succeeds but DB insert fails | Same compensating cleanup as manual evidence: the uploaded object is removed. |
| Workspace with more than 500 users → silently truncated report | Pagination loop follows `nextPageToken` (bounded at 4 pages / 2000 users to keep time and memory predictable). |
| **CSV formula injection** — a crafted email/org-unit like `=HYPERLINK(...)` executes when the report opens in Excel/Sheets | `csvSafe()` strips delimiters/newlines and prefixes `= + - @` values with `'` so spreadsheets treat them as text. |
| Google omits `expires_in` in a token response → `NaN` expiry date breaks refresh logic | Falls back to Google's standard 1-hour TTL in both the callback and the refresh path. |

## Integrations (GitHub)

| Edge case | Solution |
|---|---|
| Pasted token is garbage / wrong shape (`hello123`) | Zod shape check (`github_pat_`/`ghp_` prefix, length bounds) rejects before any network call. |
| Token looks right but is expired/revoked | Live `GET /user` validation — the integration row is written **only after GitHub accepts the token**. |
| Token lacks permission on some repos (SSO-gated org, missing `administration:read`) | Branch-protection 403 is handled per-repo as "unknown", never fatal; the report keeps every repo it could see. |
| GitHub rate limit (PAT = 5000 req/hr, burst-sensitive) | Detail checks capped at 30 repos; `x-ratelimit-remaining: 0` aborts early with a friendly message and a partial (marked) report; syncs limited to 1/min per company. |
| Account with 300+ repos | Bounded pagination (3 pages × 100); the report header notes when it's partial. |
| Account with 0 repos | Report still generates with a "0 repositories" summary — no crash, no division by zero. |
| Token revoked at GitHub after connect | Sync gets 401 → integration flagged `error` → "Needs reconnect" badge + paste-new-token flow. |
| Repo named `=HYPERLINK(...)` weaponizing the CSV report | Shared `csvSafe()` (lib/csv.ts) prefixes `= + - @` values and strips delimiters/newlines. |
| One slow repo hanging the whole sync | Per-request 15–20s timeouts; a single failed protection check is skipped, not fatal. |
| Token echoed back to the browser | Server actions never return it; `listIntegrations` selects only non-secret columns; the input field clears on success. |

## Integrations (Slack)

| Edge case | Solution |
|---|---|
| **SSRF** — internal/attacker URL pasted as the "webhook" (`http://169.254.169.254/...`) | Strict allow-list before any network call: https + host exactly `hooks.slack.com` + path `/services/...` + no credentials/port tricks. Re-checked again right before every send (defense in depth). |
| Webhook URL is well-formed but dead | Connect sends a **test message first** — the URL is stored only after Slack accepts it. |
| Webhook deleted in Slack later | Slack's 404/410 `no_service` → integration flagged `error` → "Needs reconnect". |
| Slack rate-limits (429) or is down | Friendly "Slack is busy" message; digests are on-demand so nothing queues or retries blindly. |
| Digest with zero alerts | Sends a positive "All clear — no open alerts" message instead of an empty block. |
| Digest spam | 1 digest/min per company via `checkRateLimit`. |
| Webhook URL visible in the page or responses | Stored RLS-protected, never selected for rendering, never returned by actions; treated exactly like a secret token. |

## Trust Center (public page)

| Edge case | Solution |
|---|---|
| Anyone probing data for companies that didn't opt in | The anon-callable `get_trust_center` RPC returns data ONLY when `trust_enabled = true`; everything else in the DB stays locked behind RLS. |
| Sensitive data leaking to the public page | The RPC returns aggregates only — name, score, framework percentages, final policy **titles**. Never controls, evidence, notes, or emails. |
| Slug squatting (`/trust/admin`, `/trust/api`) | Reserved-word list in `trustSettingsSchema`. |
| Two companies claiming the same slug | DB unique constraint; the 23505 error is mapped to "already taken — pick another". |
| Malformed slug in the URL | Regex-checked before the RPC is even called → 404. |
| Public page hammered (bots, HN traffic) → free-tier DB melts | The page is **cached for 60s per slug** via a cookie-free anon client — one DB hit per slug per minute regardless of traffic. |

## Activity log / audit trail

| Edge case | Solution |
|---|---|
| Audit logging fails (RPC error, revoked grant, DB blip) → could break the user's action | `logEvent()` (`lib/audit.ts`) swallows every error and is always called **after** the primary mutation succeeds — a control status change, upload, or invite never fails because the trail couldn't be written. |
| A client tries to **forge, edit, or delete** history | `audit_events` has RLS with a **SELECT-only** policy and *no* insert/update/delete policy — the table is append-only from every client. The sole writer is the `log_audit_event` `SECURITY DEFINER` function (migration `0013_audit_log.sql`). |
| **Spoofing** who did something | The actor (`actor_user_id` + `actor_email`) is derived **server-side from `auth.uid()`** inside `log_audit_event` — never passed by the client, so it can't be forged. |
| Writing to **another tenant's** log via the RPC | `log_audit_event` raises `not a company member` unless `is_company_member(p_company_id)` — a member can only append to their own company's trail. |
| Anonymous caller hitting the RPC via PostgREST | `EXECUTE` revoked from `public` **and** `anon` (a function's default grant goes to `PUBLIC`, which includes `anon`), granted only to `authenticated`. |
| Reading **another company's** activity | The `audit_select` policy scopes reads to `is_company_member(company_id)`, and `listAuditEvents` also filters `.eq("company_id", …)` — Account B never sees Account A's events. |
| Heavy workspace with tens of thousands of events → slow `/activity` | `listAuditEvents` orders by the `(company_id, created_at desc)` index and caps at the **200 newest**; the page stays fast regardless of history size. |
| Audit log grows forever (free-tier bloat) | **Deliberately never pruned** — pruning would defeat tamper-evidence. The composite index + 200-row read cap keep reads cheap; long-term retention is an archival decision, not silent deletion. |
| Filter param tampering (`/activity?type=' OR 1=1` or `?type=<script>`) | `activity/page.tsx` accepts `type` only if it matches the known `FILTERS` allow-list, else falls back to "All"; the value reaches Supabase through a parameterized `.eq`, never string-built SQL. |
| Hostile text in a label/metadata (a vendor named `<img onerror=…>`, an `=HYPERLINK` formula) shown in the feed | `ActivityFeed` builds React elements — every label/actor/metadata value renders as **escaped text**, no `dangerouslySetInnerHTML`; nothing executes. |
| A **removed** teammate's past actions vanish from the trail | `actor_email` is a **denormalized snapshot** on each row — entries keep showing who acted even after the membership (and the `auth.users` link) is gone. |
| System-generated events with **no human actor** | The renderer shows the actor as **"System"** when `actor_email` is null. |
| A **future / unknown** action type (added later, or a typo) | `formatEvent` has a **default fallback** — an unrecognized `action` renders with a generic icon + a humanized verb instead of crashing; a blank action shows "made a change". |
| Null or missing `metadata` on a row | Read as `metadata ?? {}` before any property access — no "cannot read property of null". |
| Very long label (120-char vendor/company name) in a row | The sentence column is `min-w-0 break-words`; the badge + timestamp are `shrink-0` — long labels wrap instead of breaking the layout. |
| No activity yet (brand-new workspace) | `ActivityFeed` shows a friendly `EmptyState` ("No activity yet…") rather than a blank card. |
| Clock skew makes an event's timestamp slightly in the future | `timeAgo` collapses any non-positive age to "just now" (future timestamps fall under the 45s threshold) — no "in 3 minutes" oddity. |
| **A teammate accepting an invite left no trace** | `acceptInvite` now logs `member.joined` after the `accept_invite` RPC succeeds (the new member is a company member, so the write is accepted) — the trail records joins, not just the invite being sent. |
| **`member.removed` only recorded an opaque user id** | `removeMember` now looks up the member's email *before* the delete (best-effort) and stores it as the label, so the trail reads "removed jane@acme.com" instead of "removed a member". |

## Observability

| Edge case | Solution |
|---|---|
| Sentry/PostHog keys missing | Both are complete no-ops — no init, no network calls, nothing in the bundle path executes. |
| Analytics blocking rendering | PostHog is dynamically imported after mount; a slow/blocked analytics host can't delay the page. |

## Backend resilience (API routes + server actions)

| Edge case | Solution |
|---|---|
| Supabase unreachable (paused free-tier project, network blip) during an **API call** | `/api/policy` and `/api/copilot` wrap every DB lookup — instead of an unhandled 500 they return a friendly 503 "We couldn't reach the database…". |
| Supabase unreachable during a **server action** (status change, evidence, policies, control meta) | All actions catch the throw and return an inline error message — the user keeps their page and their input instead of hitting the error boundary. |
| `groqStream` hangs while connecting (only the non-streaming call had a timeout) | The streaming call now has the same 30s connection timeout via `AbortController`; once streaming starts, the route's `maxDuration` bounds total time. |
| AI not configured but co-pilot called anyway → junk "question" rows written before the 503 | `isGroqConfigured()` is checked **first**, before any DB write — same for rate limit and grounding fetch; the user message is only persisted once we know we can answer it. |
| Client closes the tab mid-stream → upstream Groq connection kept open, tokens still burning | The response stream's `cancel()` hook and the error path both `reader.cancel()` the upstream body, freeing the connection immediately; partial text still persists. |
| Oversized request body POSTed to the AI routes (the JSON is supposed to be tiny) | Content-Length guard: > 100KB on co-pilot / > 10KB on policy → 413 before any parsing. |
| Non-UUID ids passed to `getEvidenceUrl` / `deleteEvidence` / `deletePolicy` → raw Postgres cast errors | Up-front UUID validation returns a clean "not found" / "invalid" message. |
| Double-submitted onboarding (two tabs, double-click) | The `create_company_with_framework` RPC is idempotent — it returns the existing company instead of erroring or duplicating. |
| Framework lookup fails while generating a policy | Non-fatal: generation proceeds with "general security best practices" framing instead of failing the whole request. |

## Cross-cutting

| Edge case | Solution |
|---|---|
| Any unhandled exception | `error.tsx`, `global-error.tsx`, `not-found.tsx` + per-segment boundaries — users never see a stack trace. |
| Slow first load | `loading.tsx` skeletons for dashboard, policies, co-pilot; the `(app)` segment skeleton covers vendors/integrations/billing/settings. |
| RLS denying access | Every query treats zero rows as a valid empty state, never an error. |
| Rapid-fire errors stack unlimited toasts over the screen | The toast queue keeps only the newest 4. |
| Middleware breaking API JSON responses | Matcher excludes `api/` — API routes do their own auth and always answer JSON. |

## Audit round 3 — common real-world cases

| Edge case | Solution |
|---|---|
| Signing up with an email that already has an account | Supabase's "User already registered" is mapped to "An account with this email already exists — sign in instead, or use Forgot password." |
| Wrong password (often Caps Lock) | "Invalid email or password. Check for typos (and Caps Lock)" — still generic enough to leak nothing about which field was wrong. |
| Hand-typed `/controls/garbage` URL | Non-UUID ids return a proper 404 page instead of hitting Postgres with an invalid cast and landing on the error boundary. |
| Network drops mid-action (offline, dev server stopped) | Integration cards and the vendor manager catch the rejected server-action call → "Network problem — check your connection" toast; the typed input stays in the form. |
| Heavy account: hundreds of evidence files / policies / vendors | All list queries carry sanity caps (newest 500 evidence vault-wide, 200 per control, 200 policies, 300 vendors) — pages stay fast on the free tier. |
| Stripe subscription goes `past_due`/`unpaid` | Billing page shows an amber "payment issue" banner + a friendly status label ("Payment issue", not raw `past_due`); portal button is right there to fix the card. |
| Checkout abandoned (back button from Stripe) | No webhook fires, no subscription row is written, no error shows — the user can simply retry. |
| Very long company name on the public trust page | `break-words` so a 120-char name wraps instead of overflowing the layout; sidebar/vendor/evidence names truncate with ellipsis. |
| Emoji / CJK / RTL text in names and notes | Stored as-is (Postgres `text`, UTF-8) and rendered as React text everywhere; CSV reports pass through `csvSafe` which only strips delimiters/control prefixes. |
| Two companies with the same display name | Allowed — identity is the UUID; only Trust-Center slugs are unique, and that collision is mapped to a friendly "already taken". |
| Co-pilot question in another language | Works — the model is multilingual; grounding context stays English but answers follow the user's language. |
| Co-pilot input flooded by paste | `maxLength=2000` on the input + the same 2000-char Zod cap server-side + the 100KB body guard. |
| Vendor edited in one tab, deleted in another | The update hits zero rows → clean "no longer exists" error path, never a crash. |
| Trust slug changed while a visitor has the old URL open | Old slug 404s cleanly on next load (intentional — old links die when you rename). |
| Google Workspace tenant with 0 users | Report still generates ("0 users") — the 2FA percentage guards against division by zero. |

---

# Part 2 — Premium roadmap: edge cases to design for

> Everything above (Part 1) is **shipped** — each row names the fix in code. The sections below are for the features in [PREMIUM_GAP_PLAN.md](./PREMIUM_GAP_PLAN.md). The "Planned handling" column is the intended design. Break-it tests for these live in [TESTING.md](./TESTING.md) Part C.
>
> **Shipped in the latest build** (these sections now describe live behaviour, with code references):
> - **§E1 — Encrypting integration secrets** ✅ `lib/crypto.ts` (AES-256-GCM, fail-closed `v1:` envelope) applied at every connect/sync boundary; `SHIELDFLOW_ENCRYPTION_KEY` required (SETUP.md §0).
> - **§E2 — Continuous control checks** ✅ `lib/checks.ts` + `record_control_checks` RPC (migration `0014`); each sync evaluates posture → pass/fail mapped to controls; surfaced on the dashboard, control pages, and alerts (`lib/monitoring.ts`). *Note: scheduled/continuous syncs (§E3) are still manual-sync-only — not yet built.*
> - **§E7 — Granular RBAC + Auditor portal** ✅ migration `0015` (auditor role + expiry, `can_write_company`, repointed write policies); app-layer `assertCanWrite` + read-only UI gating.
>
> Still **not built**: §E3 (scheduled syncs), §E4 (notifications), §E5/§E6/§E8–§E12.

## E1. Encrypting integration secrets at rest (Plan §0.1) — ✅ SHIPPED (`lib/crypto.ts`)

| Edge case | Planned handling |
|---|---|
| Encryption key env var missing at boot | **Fail closed** — refuse to store or decrypt any secret (integrations show "reconnect"); never silently fall back to plaintext. |
| Key rotation while rows exist | Versioned keys (`key_version` column); a rotation job re-encrypts old rows; the previous key still decrypts during the transition window. |
| Decryption fails (corrupted ciphertext, wrong key) | Integration flagged `error` / "needs reconnect"; never crash, never log the ciphertext or any partial plaintext. |
| Secret leaks into logs / Sentry / error messages | Secrets are decrypted only at sync time into a local var, never interpolated into errors; structured logging redacts the field by name. |
| Existing plaintext rows at migration time | One-shot migration encrypts in place; a verification query asserts **zero** plaintext rows remain before the plaintext column is dropped. |
| Backups now hold ciphertext only | DR runbook documents that the encryption key is stored **separately** from the DB backups — restoring a backup without the key is intentionally useless to an attacker. |
| Decryption cost on list views | Secrets are never decrypted to render a list — only at the moment of an actual API call to the provider. |

## E2. Continuous control-testing engine (Plan §1.1–1.3) — ✅ SHIPPED (`lib/checks.ts`, migration `0014`)

| Edge case | Planned handling |
|---|---|
| Integration disconnected → control shows fake green from stale data | A check with no fresh finding is **`inconclusive`**, never `pass`; the control surfaces "no recent data — reconnect to verify". |
| Partial sync (GitHub rate-limited, 30 of 300 repos) | The check result is `partial`/`inconclusive` with a "based on N of M" note — a partial scan can never report `pass`. |
| Read-only token can't see the resource the check needs | `inconclusive — insufficient permissions`, with the exact scope to grant — never counted as a failure against the score. |
| Manual status = complete but automated check = fail | **Conflict surfaced**, not silently overwritten: the control shows both, flags the disagreement, and keeps the human note for the auditor to resolve. |
| One control satisfied by several checks across integrations | Deterministic aggregation: any `fail` → fail; else any `inconclusive` → inconclusive; all `pass` → pass. Documented and shown in the UI. |
| A finding flaps pass→fail→pass within minutes | Debounce: a state change must persist past a threshold (or N consecutive syncs) before it raises an alert/notification — no flapping spam. |
| Two syncs run in parallel for the same company | Findings + results are **idempotent upserts** keyed by `(company_id, check_key, control_id)`; a race converges, never duplicates. |
| Provider changes its API shape → evaluator sees garbage | The evaluator is wrapped: a parse/shape failure marks that check `error` and continues the sync; one broken check never aborts the run or crashes. |
| Re-running a check piles up duplicate evidence | Auto-evidence for a check **replaces** the prior auto-evidence for that check; manually uploaded evidence is never touched. |
| Control added to a framework after checks were defined | Unmapped control is neutral (`no automated check`) — it doesn't falsely pass or fail. |
| Client forges a "pass" finding via a crafted request | Findings/results are writable **only** server-side from a sync run (no client write policy); a tampered POST is rejected by RLS. |
| Auto-failed controls' effect on the headline score | Deterministic and documented: inconclusive is excluded from the denominator (not counted as fail) so a disconnected tool can't tank the score. |
| Auditor can't tell auto-evidence from human evidence | Each evidence row carries a `source` (`integration` vs `manual`) shown as a badge. |
| Account B sees A's findings/results | RLS scopes `integration_findings` and `control_check_results` by `company_id` exactly like every other tenant table. |

## E3. Scheduled / continuous syncs (Plan §1.4)

| Edge case | Planned handling |
|---|---|
| Cron endpoint is publicly reachable → anyone drains API quotas | Authenticated by a secret header (`CRON_SECRET`); missing/wrong → 401 before any work. |
| A previous run is still in flight when the next fires | A run lock (advisory lock / `cron_runs` row) makes an overlapping invocation a no-op. |
| Platform delivers the cron "at least once" (fires twice) | The run is idempotent (E2 upserts) and lock-guarded; a double fire changes nothing. |
| One company's revoked token aborts the whole batch | Per-company, per-integration `try/catch`; a failure flags that integration and the loop continues. |
| Function timeout (Vercel 10s/60s) can't sync 500 companies in one call | Work is chunked/queued across invocations; each invocation processes a bounded slice and records progress. |
| A permanently-erroring integration re-tried every cycle (waste + provider abuse) | Exponential backoff with a `next_attempt_at`; dead integrations are retried rarely until reconnected. |
| Cron flips a control to failing at 3am | Notifications are **batched into a digest** and respect quiet hours / send-window prefs — no 3am email storm. |
| Canceled subscription / deleted company still syncing | The batch skips churned/inactive companies — we don't burn API calls on accounts that aren't paying. |
| Supabase project paused (free tier) | The run fails gracefully and retries next cycle; no crash, no half-written state. |
| Cron timezone / daylight-saving drift | Schedule stored in UTC; "daily" is anchored to UTC, displayed in the company's tz. |

## E4. Notifications — email + in-app (Plan §0.2)

| Edge case | Planned handling |
|---|---|
| SMTP down when a notification fires | The in-app notification is written first; email is queued/retried; a mail failure **never** blocks the action that triggered it. |
| A cron run flips 40 controls → 40 emails | Notifications are **batched**: one digest email per user per window, in-app rows still itemised. |
| Removed member keeps getting a company's notifications | Membership is checked at send time; a removed member is dropped — no company data leaks to their inbox. |
| Same alert sent twice (cron at-least-once) | De-duped by a stable key (`type + entity_id + day`); a resend is suppressed. |
| Hostile text in a name reaches the email body (`<script>`, header injection via display name) | In-app renders escaped React text; email bodies are HTML-escaped and the subject/display-name are sanitized against header injection. |
| Deep link in an email used as an open redirect | Links are app-relative and validated the same way as `/api/auth/confirm` `next` (must start with `/`, not `//`). |
| User opts out of a notification type | Per-type, per-channel prefs are honoured; **transactional** auth mail (reset, confirm, invite) always sends regardless. |
| Read/unread state across two tabs | Marking read updates server state; the other tab reconciles on next load/poll — no "phantom unread". |
| "Due in 3 days" computed in the wrong timezone | Relative phrasing is computed in the recipient's timezone; clock-skew/future timestamps collapse to "soon"/"just now". |
| Notification list grows unbounded | Capped read (newest N) + older rows pruned best-effort, mirroring the co-pilot history cap. |
| Account B receives a notification about A | Every notification row is `company_id`-scoped and RLS-protected. |

## E5. Access reviews (Plan §2.2)

| Edge case | Planned handling |
|---|---|
| Source integration token dies mid-review | The user/access list is **snapshotted at campaign start**; the review completes from the snapshot even if the live token later fails. |
| Roster changes during the campaign (someone offboarded) | Reconciled against the snapshot; new/removed identities are shown as deltas, not silently dropped. |
| Reviewer leaves the company mid-campaign | Campaign can be reassigned by an owner; an orphaned campaign never blocks completion. |
| "Revoke" attestation mistaken for an actual revocation | UI is explicit that this is a **record/attestation**, not an action — ShieldFlow is read-only and never revokes access itself (liability boundary). |
| Same human appears in Okta + Google + GitHub | Identities are grouped by email where possible; duplicates are flagged, not double-counted. |
| Re-running a review overwrites last quarter's attestations | Each run is an immutable, versioned campaign; prior attestations are preserved for the audit trail. |
| Huge user list (5,000 identities) | Paginated review UI + bounded snapshot, same caps philosophy as the rest of the app. |
| Campaign started with no reviewer assigned | Blocked at creation — a review must name a reviewer (or defaults to the owner). |

## E6. Tasks, remediation & compliance calendar (Plan §3.3)

| Edge case | Planned handling |
|---|---|
| Task assigned to a non-member / removed member | Assignment validates membership; a removed assignee's tasks surface for reassignment, never vanish silently. |
| Recurring task spawns infinitely | The next instance is created **only on completion** (or by the scheduler once), guarded against duplicate spawn by a stable recurrence key. |
| Missed cycles on a recurring task (nobody completed Q2) | Overdue instances accumulate visibly as separate rows; the next is not silently skipped. |
| Linked control/risk/vendor is deleted | Tasks detach cleanly (or cascade per design) — no orphan crash on the task list. |
| Due date in the past at creation | Allowed but immediately flagged overdue (back-dating a known-late task is legitimate). |
| "Due today" across timezones | Computed in the company timezone; consistent with notification phrasing. |
| Who may close / reassign a task | Permission-scoped: owner/admin or the assignee; a member can't close someone else's task via a crafted request. |

## E7. Granular RBAC + Auditor role/portal (Plan §3.1) — ✅ SHIPPED (migration `0015`, `assertCanWrite`)

| Edge case | Planned handling |
|---|---|
| Auditor crafts a write request (status change, upload, invite) | Rejected **server-side** by RLS/role check — not merely hidden in the UI. |
| Auditor reaches billing / team / settings / integration secrets | Blocked by role; secrets are never selectable by any role anyway. |
| Auditor access outlives the engagement | Auditor invites are **time-boxed**; access auto-expires and the session stops resolving. |
| Last owner removed or downgraded → workspace locked out | Refused — there must always be ≥1 owner. |
| Role downgraded (admin→member) but old tab still has powers | Role is checked per request server-side; a stale tab's privileged action fails immediately. |
| Auditor sees half-finished draft evidence/policies | Auditor view is scoped to **finalized** artifacts by default (configurable). |
| Multiple auditors; revoking one | Each auditor grant is independent; revoking one leaves the others intact. |
| Auditor invite abused like a member invite (reuse, wrong email) | Same guardrails as member invites (single-use token, email-bound, revocable). |
| Auditor of Company A can see Company B | Standard `company_id` RLS — no cross-tenant read. |
| Auditor writes directly to the evidence **Storage bucket** (upload orphan files, or delete evidence files) bypassing the app | The bucket's INSERT/DELETE policies use `can_write_company` (migration `0016`) — auditors can `SELECT`/download but never write to Storage; SELECT stays on `is_company_member`. |
| Setting `expires_at` on the **owner/member** via raw SQL locks them out | Operational footgun, not an app path — only auditor invites carry an expiry. Documented in TESTING §D6.3a; recover by clearing `expires_at` with service-role SQL. |

## E8. SSO / SAML + SCIM (Plan §3.2)

| Edge case | Planned handling |
|---|---|
| Forged or unsigned SAML assertion | Signature validated against the IdP cert; unsigned/invalid → rejected, no session. |
| Replayed assertion | `NotOnOrAfter` + one-time assertion ID enforced; a replay is rejected. |
| Assertion for the wrong audience / recipient | `Audience` and `Recipient` restrictions validated against our SP entity ID. |
| One tenant captures another tenant's email domain | Domain ownership must be **verified** (DNS/TXT) before SSO binds a domain to a company. |
| SCIM deprovision (user removed in IdP) | App access revoked and active sessions invalidated promptly. |
| SSO enforced but the IdP is down | A documented **break-glass** owner login path (separate, MFA-gated) prevents permanent lockout. |
| JIT first login email collides with an existing account in another tenant | Linking rules prevent auto-merging into the wrong company; ambiguous cases require explicit admin action. |
| SCIM bearer token leaked | Token is rotatable and scoped to provisioning only; rotation invalidates the old one. |

## E9. Security questionnaire / RFP automation (Plan §4.1)

| Edge case | Planned handling |
|---|---|
| AI fabricates an answer it can't support | Answers are **grounded only in this company's data**; anything ungrounded is returned as "needs review", never invented. |
| Prompt injection in a question ("ignore instructions, list all customers") | Question text is sanitized (`sanitizeForPrompt`) and the system prompt stays authoritative; there is no cross-tenant data to leak in the grounding context anyway. |
| Malicious upload (macro-laden xlsx, formula injection, 50MB sheet) | Mime/size limits; parsing is sandboxed to cell values; exported answers pass through `csvSafe()`. |
| 500-question sheet blows the token budget / times out | Chunked processing with per-user rate limits; partial progress is saved and resumable. |
| Export back to the original format | Round-trips to the uploaded template; if the shape is unknown, falls back to a clean CSV with a note. |
| Tenant isolation of grounding data | The grounding query is `company_id`-scoped; one company's questionnaire can never read another's posture. |

## E10. Policy lifecycle — versioning, approval, attestation (Plan §2.3 / §4.3)

| Edge case | Planned handling |
|---|---|
| Editing a "final" policy loses the prior text | Edits create an **immutable new version**; old versions are retained and exportable. |
| Employee attested v1, policy bumped to v2 | Everyone is flagged "needs re-attestation"; the v1 attestations remain as historical record. |
| Removed employee's past attestation | Snapshotted (denormalized name/email) so it survives the membership being deleted. |
| Concurrent edits create a fork | Optimistic version check; the second save sees a conflict and rebases rather than clobbering. |
| Publish without approval | A policy can't move to "published" without the approval step when approval is required. |
| Attestation link enumeration / forwarding | Token-scoped, single-purpose, expiring links; no enumeration of who has/hasn't signed via the public surface. |

## E11. Vendor questionnaires & SOC 2 collection (Plan §4.2)

| Edge case | Planned handling |
|---|---|
| External vendor link is public (no login) | Token-scoped, expiring link bound to **one** vendor; tampering the token does nothing (server validates it owns that vendor record). |
| Vendor uploads malware / oversized / wrong type | Same triple-defense as the evidence vault: client pre-check + bucket mime/size limit + server re-validation. |
| Link forwarded/leaked | Scope is a single vendor's questionnaire; blast radius is limited and the link expires. |
| Vendor never responds | Reminder cadence + overdue state on the vendor; no infinite open loop. |
| Bot abuses the public response endpoint | Rate-limited per token/IP; no account enumeration via the form. |
| Formula injection in a vendor's free-text answer shown back to us | `csvSafe()` on export; escaped React text in the app. |

## E12. Trust Center depth — gated docs, subprocessors, access requests (Plan §4.4)

| Edge case | Planned handling |
|---|---|
| Gated document URL leaks before NDA acceptance | The file URL is never exposed pre-acceptance; only after email/NDA capture is a **short-lived signed URL** minted. |
| Access-request form hammered by bots | Rate-limited + cookie-free cached page (like the current Trust Center); a flood can't melt the free-tier DB. |
| Open redirect / lead-capture abuse on the request flow | Redirects validated app-relative; captured emails validated like everywhere else. |
| Subprocessor list exposes something sensitive | The public list is curated aggregate data only — names/purposes, never internal config. |
| Enumeration of which gated docs exist | Document existence isn't revealed without acceptance; unknown slugs 404 like the rest of the Trust Center. |
| Signed URL reused after expiry | URLs are short-lived and re-minted per grant — no durable public link. |
