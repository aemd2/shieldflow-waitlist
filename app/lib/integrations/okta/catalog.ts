import type { CheckDef } from "@/lib/checks-core";

export type OktaArea = "signin" | "admins" | "people" | "apps";

export const OKTA_AREAS: { area: OktaArea; title: string }[] = [
  { area: "signin", title: "Sign-in security" },
  { area: "admins", title: "Administrators" },
  { area: "people", title: "People & access" },
  { area: "apps", title: "Single sign-on" },
];

const MFA = ["CC6.1", "A.8.5", "164.312(d)", "164.312(a)(1)", "Req 8", "Art. 32"];
const ACCESS = ["CC6.2", "CC6.3", "A.5.16", "A.5.18"];
const PRIV = ["CC6.3", "A.8.2", "A.5.15"];
const PASSWORDS = ["CC6.1", "A.5.17", "Req 8"];

export const OKTA_CHECKS: CheckDef<OktaArea>[] = [
  {
    key: "okta.mfa",
    title: "Everyone has a second factor",
    area: "signin",
    severity: "high",
    why: "Okta is the key to every app behind it. An account with only a password is one phish away from all of them.",
    controlCodes: MFA,
    apiCalls: ["GET /api/v1/users", "GET /api/v1/users/{id}/factors (every active user)"],
    fix: { console: "Okta Admin → Security → Authenticators → Enrollment → require Okta Verify (or a security key) for everyone; ask each listed person to enrol." },
  },
  {
    key: "okta.mfa_strong",
    title: "No one relies on SMS, voice or email codes alone",
    area: "signin",
    severity: "medium",
    why: "SMS, voice calls and email codes can be intercepted or redirected (SIM swaps, mailbox takeover). Okta Verify push or a security key can't.",
    controlCodes: [],
    apiCalls: ["GET /api/v1/users/{id}/factors"],
    fix: { console: "Okta Admin → Security → Authenticators → set Phone and Email to 'Recovery only'; ask each listed person to add Okta Verify or a security key." },
  },
  {
    key: "okta.password_policy",
    title: "Passwords are at least 8 characters",
    area: "signin",
    severity: "medium",
    why: "The default password policy is the floor for everyone who isn't in a stricter group.",
    controlCodes: PASSWORDS,
    apiCalls: ["GET /api/v1/policies?type=PASSWORD"],
    fix: { console: "Okta Admin → Security → Authenticators → Password → Default policy → Minimum length 12 (or at least 8 with MFA everywhere)." },
  },
  {
    key: "okta.admins_mfa",
    title: "Every administrator has a strong second factor",
    area: "admins",
    severity: "high",
    why: "An admin can reset anyone's factors and change every policy. Their account needs Okta Verify or a security key — not just a password or an SMS.",
    controlCodes: MFA,
    apiCalls: ["GET /api/v1/iam/assignees/users", "GET /api/v1/users/{id}/roles", "GET /api/v1/users/{id}/factors"],
    fix: { console: "Have the admin enrol Okta Verify or a security key now; then add an admin-console authentication policy requiring phishing-resistant MFA." },
  },
  {
    key: "okta.super_admins",
    title: "Three or fewer Super Administrators",
    area: "admins",
    severity: "medium",
    why: "Super Administrators can do anything, including turning off every policy here. Two or three, with narrower roles for the rest.",
    controlCodes: PRIV,
    apiCalls: ["GET /api/v1/iam/assignees/users", "GET /api/v1/users/{id}/roles"],
    fix: { console: "Okta Admin → Security → Administrators → the person → replace Super Administrator with Org, App or Help Desk Administrator." },
  },
  {
    key: "okta.offboarding_drift",
    title: "Leavers are deactivated in Okta",
    area: "people",
    severity: "high",
    why: "A leaver's Okta account still signs in to every app behind it.",
    controlCodes: ACCESS,
    apiCalls: ["GET /api/v1/users"],
    fix: { console: "Okta Admin → Directory → People → the person → Deactivate (Okta then deprovisions their apps)." },
  },
  {
    key: "okta.untracked_accounts",
    title: "Every account belongs to someone you know",
    area: "people",
    severity: "medium",
    why: "An account nobody can name is a leaver nobody recorded, a shared login, or a contractor nobody tracked.",
    controlCodes: ACCESS,
    apiCalls: ["GET /api/v1/users"],
    fix: { console: "Add the person in Personnel, or mark the account as not a person." },
  },
  {
    key: "okta.dormant",
    title: "No accounts unused for 90 days",
    area: "people",
    severity: "medium",
    why: "An active account nobody has signed in with for months is usually a leaver or a forgotten shared login — still able to reach every app.",
    controlCodes: [],
    apiCalls: ["GET /api/v1/users (lastLogin)"],
    fix: { console: "Okta Admin → Directory → People → the person → Suspend or Deactivate." },
  },
  {
    key: "okta.sso_coverage",
    title: "Apps use real single sign-on, not a stored password",
    area: "apps",
    severity: "medium",
    why: "An app where Okta types a stored password still has that password — it works without Okta, so deactivating someone doesn't lock them out.",
    controlCodes: ACCESS,
    apiCalls: ["GET /api/v1/apps"],
    fix: { console: "For each listed app, switch it to SAML or OpenID Connect if it supports it (Okta Integration Network shows which); then rotate the stored password." },
  },
];

export const OKTA_READS = [
  ["Read-Only Administrator token", "users and last sign-in, their factor types, admin roles, the password policy, the app list"],
] as const;
