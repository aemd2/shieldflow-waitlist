# SSO / SAML + SCIM — joint session plan (Phase 3.2)

The one premium gap left. It can't be finished solo because validating SAML needs a
real identity provider (IdP). This is the plan for a working session together.

---

## Recommended approach: phase it

**Phase A — SAML SSO via Supabase Auth (do this first).** Covers ~90% of what
"we need SSO" means in procurement. The app already runs on Supabase Auth, so this
is the least new surface.

**Phase B — SCIM deprovisioning via WorkOS (only when a deal needs it).** Supabase
Auth does **not** offer a SCIM provisioning endpoint, so true SCIM auto-deprovision
needs WorkOS Directory Sync (or similar). Defer until an enterprise prospect asks —
Phase A unblocks most.

> Alternative: do **both** SSO + SCIM through **WorkOS** from the start (one vendor,
> unified API) if you'd rather not split. Trade-off: a second auth vendor + cost vs.
> Supabase-native. Decide in the session (see Open decisions).

---

## What you need to bring

- **Supabase Pro plan** (SAML SSO is a Pro feature) on project `fxhnzwzzizksxahlydzf`.
- A **test IdP**: an Okta developer account (free) or Microsoft Entra ID test tenant.
- A **domain you control** for the test org (to verify domain ownership), e.g. a
  subdomain of shieldflow.cloud.
- (Phase B only) a **WorkOS** account (free dev environment).

---

## Phase A — SAML SSO, step by step

1. **Enable SSO in Supabase** (Auth → Providers → SAML / SSO) on Pro.
2. **Register the IdP** with Supabase via the CLI/Management API: add the IdP's
   metadata URL, map a domain (e.g. `acme.com`) → that SSO connection. Supabase
   issues the SP metadata / ACS URL to paste into Okta/Entra.
3. **App: "Sign in with SSO"** — add to [components/auth/AuthForm.tsx](../app/components/auth/AuthForm.tsx):
   an email-domain box → call `supabase.auth.signInWithSSO({ domain })` → redirect to
   the IdP. On return, the existing `/api/auth/confirm` flow lands them in the app.
4. **JIT provisioning** — on first SSO login a Supabase user exists but has **no
   company membership**. Decide the rule: auto-join the company that owns the verified
   domain (needs a `domain → company` mapping table), or land on `/onboarding`. For a
   single-tenant-per-domain model, add a `company_sso_domains` table and a
   `SECURITY DEFINER` RPC that adds the new user to that company as `member` on first
   login.
5. **Break-glass** — keep email/password working for at least the owner so a broken
   IdP never locks the company out (don't hard-disable password auth).
6. **Session invalidation** — on offboard/removal, the existing `remove_member` cuts
   app access (RLS); SSO just controls *login*, not authorization.

## Phase B — SCIM (WorkOS Directory Sync), later

1. WorkOS environment → Directory Sync → connect the customer's IdP directory.
2. A webhook endpoint `app/api/scim/webhook` (signature-verified) handles
   `user.deactivated` → look up the app user by email → call `remove_member` (or
   disable) → **invalidate their sessions**. `user.created` can pre-provision membership.
3. Map WorkOS organization → ShieldFlow company.

---

## App changes checklist (for the session)

- [ ] `components/auth/AuthForm.tsx`: "Sign in with SSO" (email-domain → `signInWithSSO`).
- [ ] `company_sso_domains` table + JIT-membership `SECURITY DEFINER` RPC (Phase A).
- [ ] Domain-ownership verification before a domain can be claimed for SSO (so one
      tenant can't capture another's domain).
- [ ] Owner-only **SSO settings** UI in `/settings` (enter IdP metadata / connection).
- [ ] Break-glass: never disable password login for the owner.
- [ ] (Phase B) `app/api/scim/webhook` signature-verified deprovision → `remove_member`
      + session invalidation.

## Security tests (must pass before enabling for a customer)

- [ ] Forged / unsigned SAML assertion → rejected.
- [ ] Replayed assertion (reused `InResponseTo` / expired `NotOnOrAfter`) → rejected.
- [ ] Wrong-audience assertion → rejected.
- [ ] Domain capture: company B can't claim company A's already-verified domain.
- [ ] SCIM deprovision (Phase B) → access revoked immediately, sessions invalidated.
- [ ] IdP down → owner can still sign in via break-glass password.

## Open decisions (answer in the session)

1. **Supabase Auth SSO** (native, Pro) **vs WorkOS** (SSO + SCIM in one, extra vendor)?
   Recommendation: Supabase for SAML now, WorkOS for SCIM later.
2. **JIT model**: one company per verified domain (auto-join) vs land-on-onboarding?
3. Is **SCIM** needed for the first enterprise deal, or is SAML SSO enough to start?
