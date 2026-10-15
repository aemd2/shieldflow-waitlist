import type { CheckDef } from "@/lib/checks-core";

export type GoogleArea = "signin" | "admins" | "people" | "apps";

export const GOOGLE_AREAS: { area: GoogleArea; title: string }[] = [
  { area: "signin", title: "Sign-in security" },
  { area: "admins", title: "Administrators" },
  { area: "people", title: "People & access" },
  { area: "apps", title: "Third-party apps" },
];

const MFA = ["CC6.1", "A.8.5", "164.312(d)", "164.312(a)(1)", "Req 8", "Art. 32"];
const ACCESS = ["CC6.2", "CC6.3", "A.5.16", "A.5.18"];
const PRIV = ["CC6.3", "A.8.2", "A.5.15"];
const VENDORS = ["CC9.2", "A.5.19", "A.5.21"];

const ENFORCE_2SV =
  "Google Admin console → Security → Authentication → 2-step verification → pick the organisational unit ({id}) → Allow users to turn on 2-Step Verification + Enforcement: On (give people a week's notice with 'new user enrollment period').";

export const GOOGLE_CHECKS: CheckDef<GoogleArea>[] = [
  {
    key: "google.2sv_enforced",
    title: "2-step verification is enforced for everyone",
    area: "signin",
    severity: "high",
    why: "Enrolled isn't the same as enforced: if 2-step verification is only allowed, anyone can turn it off and new joiners never turn it on. Auditors ask for the enforcement setting, not a percentage.",
    controlCodes: MFA,
    apiCalls: ["GET admin/directory/v1/users (isEnforcedIn2Sv)"],
    fix: { console: ENFORCE_2SV },
  },
  {
    key: "google.2fa",
    title: "Everyone has 2-step verification turned on",
    area: "signin",
    severity: "high",
    why: "Each account without a second factor is one phished password away from your email, documents and every app that signs in with Google.",
    controlCodes: MFA,
    apiCalls: ["GET admin/directory/v1/users (isEnrolledIn2Sv)"],
    fix: { console: "Ask each listed person to turn it on at myaccount.google.com/signinoptions/two-step-verification — then enforce it so it can't lapse (see the check above)." },
  },
  {
    key: "google.admins_2sv",
    title: "Every administrator has 2-step verification",
    area: "admins",
    severity: "high",
    why: "An admin account without a second factor can reset everyone else's — it's the one account an attacker wants most.",
    controlCodes: MFA,
    apiCalls: ["GET admin/directory/v1/users (isAdmin, isDelegatedAdmin, isEnrolledIn2Sv)"],
    fix: { console: "Have the admin turn on 2-step verification now (a security key is best for admins), or remove their admin role: Admin console → Directory → Users → the person → Admin roles and privileges." },
  },
  {
    key: "google.super_admins",
    title: "Three or fewer super admins",
    area: "admins",
    severity: "medium",
    why: "Super admins can do anything, including turning off every control on this page. Two or three — with the rest on narrower admin roles — is the usual bar.",
    controlCodes: PRIV,
    apiCalls: ["GET admin/directory/v1/users (isAdmin)"],
    fix: { console: "Admin console → Account → Admin roles → Super Admin → Admins → unassign anyone who doesn't need it day to day; give them a narrower role (User Management, Groups, Help Desk) instead." },
  },
  {
    key: "google.offboarding_drift",
    title: "Leavers' accounts are suspended",
    area: "people",
    severity: "high",
    why: "A leaver's Google account still opens their email, their Drive and every app they signed into with Google.",
    controlCodes: ACCESS,
    apiCalls: ["GET admin/directory/v1/users (suspended, archived)"],
    fix: { console: "Admin console → Directory → Users → the person → Suspend (or delete after transferring their data)." },
  },
  {
    key: "google.untracked_accounts",
    title: "Every account belongs to someone you know",
    area: "people",
    severity: "medium",
    why: "An account nobody can name is a leaver nobody recorded, a shared login, or a contractor nobody tracked.",
    controlCodes: ACCESS,
    apiCalls: ["GET admin/directory/v1/users"],
    fix: { console: "Add the person in Personnel, or mark the account as not a person (a shared mailbox that can't sign in, a service account)." },
  },
  {
    key: "google.dormant",
    title: "No accounts unused for 90 days",
    area: "people",
    severity: "medium",
    why: "An account nobody has used in months is usually a leaver or a forgotten shared login — still live, still with access, and nobody would notice it being used.",
    controlCodes: [],
    apiCalls: ["GET admin/directory/v1/users (lastLoginTime, creationTime)"],
    fix: { console: "Admin console → Directory → Users → the person → Suspend, if nobody needs it. If it's a shared mailbox, convert it to a Google Group." },
  },
  {
    key: "google.oauth_apps",
    title: "Apps with access to mail or all of Drive",
    area: "apps",
    severity: "medium",
    informational: true,
    why: "Every app someone lets read their Gmail or their whole Drive is a vendor holding your data — often one nobody approved. Add the ones you keep to Vendors; block the rest.",
    controlCodes: VENDORS,
    apiCalls: ["GET admin/reports/v1/activity/users/all/applications/token (authorize, revoke — last 180 days)"],
    fix: {
      console:
        "Keep it: add it to Vendors and mark it here as approved. Block it: Admin console → Security → Access and data control → API controls → Manage third-party app access → the app → Blocked.",
    },
  },
];

export const GOOGLE_CHECK_BY_KEY = new Map(GOOGLE_CHECKS.map((c) => [c.key, c]));

/** Scopes that hand an app someone's mail, all their files, or admin powers. */
export function riskyScopes(scopes: string[]): string[] {
  const out = new Set<string>();
  for (const s of scopes) {
    if (s === "https://mail.google.com/" || /\/auth\/gmail\.(readonly|modify|compose|insert|metadata)$/.test(s)) out.add("Gmail");
    else if (/\/auth\/drive(\.readonly)?$/.test(s)) out.add("all of Drive");
    else if (/\/auth\/admin\./.test(s)) out.add("admin settings");
    else if (/\/auth\/cloud-platform$/.test(s)) out.add("Google Cloud");
  }
  return [...out];
}

export const GOOGLE_READS = [
  ["Admin SDK Directory: users (read-only)", "accounts, 2-step verification enrolled / enforced, admin flags, suspended, archived, last sign-in"],
  ["Admin SDK Reports: audit log (read-only)", "which third-party apps people granted access to (token authorise / revoke events)"],
] as const;
