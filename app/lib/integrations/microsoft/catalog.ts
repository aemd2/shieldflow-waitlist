import type { CheckDef } from "@/lib/checks-core";
import { deviceChecks } from "@/lib/integrations/devices";

export type MicrosoftArea = "signin" | "admins" | "people" | "apps" | "devices";

export const MICROSOFT_AREAS: { area: MicrosoftArea; title: string }[] = [
  { area: "signin", title: "Sign-in security" },
  { area: "admins", title: "Administrators" },
  { area: "people", title: "People & access" },
  { area: "apps", title: "App consents" },
  { area: "devices", title: "Devices (Intune)" },
];

const MFA = ["CC6.1", "A.8.5", "164.312(d)", "164.312(a)(1)", "Req 8", "Art. 32"];
const ACCESS = ["CC6.2", "CC6.3", "A.5.16", "A.5.18"];
const PRIV = ["CC6.3", "A.8.2", "A.5.15"];
const VENDORS = ["CC9.2", "A.5.19", "A.5.21"];

export const MICROSOFT_CHECKS: CheckDef<MicrosoftArea>[] = [
  {
    key: "microsoft.mfa_enforced",
    title: "MFA is required for everyone",
    area: "signin",
    severity: "high",
    why: "People registering for MFA isn't enough — it has to be required at sign-in, by Security Defaults or a Conditional Access policy covering all users and all apps.",
    controlCodes: MFA,
    apiCalls: ["GET /policies/identitySecurityDefaultsEnforcementPolicy", "GET /identity/conditionalAccess/policies"],
    fix: {
      console:
        "Without Entra ID P1: Entra admin center → Identity → Overview → Properties → Manage security defaults → Enabled. With P1: Protection → Conditional Access → New policy from template → 'Require multifactor authentication for all users' → On (exclude one break-glass account).",
    },
  },
  {
    key: "microsoft.mfa_registered",
    title: "Everyone has registered for MFA",
    area: "signin",
    severity: "high",
    why: "Each account without a second factor registered is one phished password away from mail, files and every app that signs in with Microsoft.",
    controlCodes: MFA,
    apiCalls: ["GET /reports/authenticationMethods/userRegistrationDetails"],
    fix: { console: "Ask each listed person to register at aka.ms/mfasetup. Requiring MFA (the check above) makes Microsoft prompt them at the next sign-in." },
  },
  {
    key: "microsoft.admins_mfa",
    title: "Every administrator has MFA",
    area: "admins",
    severity: "high",
    why: "An admin without a second factor can reset everyone else's — it's the account an attacker wants most.",
    controlCodes: MFA,
    apiCalls: ["GET /directoryRoles?$expand=members", "GET /reports/authenticationMethods/userRegistrationDetails"],
    fix: { console: "Have the admin register at aka.ms/mfasetup now (a passkey or security key is best), or remove the role: Entra admin center → Roles & admins → the role → Assignments." },
  },
  {
    key: "microsoft.global_admins",
    title: "Four or fewer Global Administrators",
    area: "admins",
    severity: "medium",
    why: "Global Administrators can do anything in the tenant, including turning off every control here. Microsoft recommends fewer than five, with narrower roles for day-to-day admin.",
    controlCodes: PRIV,
    apiCalls: ["GET /directoryRoles?$expand=members"],
    fix: { console: "Entra admin center → Roles & admins → Global Administrator → Assignments → remove anyone who can use a narrower role (User Administrator, Exchange Administrator…)." },
  },
  {
    key: "microsoft.offboarding_drift",
    title: "Leavers' accounts are disabled",
    area: "people",
    severity: "high",
    why: "A leaver's Microsoft account still opens their mail, OneDrive, Teams and every app that signs in with Microsoft.",
    controlCodes: ACCESS,
    apiCalls: ["GET /users (accountEnabled)"],
    fix: { console: "Microsoft 365 admin center → Users → Active users → the person → Block sign-in (then convert the mailbox to shared if it's needed)." },
  },
  {
    key: "microsoft.untracked_accounts",
    title: "Every account belongs to someone you know",
    area: "people",
    severity: "medium",
    why: "An account nobody can name is a leaver nobody recorded, a shared login, or a contractor nobody tracked. Guests are listed separately.",
    controlCodes: ACCESS,
    apiCalls: ["GET /users (userType = Member)"],
    fix: { console: "Add the person in Personnel, or mark the account as not a person (a shared mailbox, a room, a service account)." },
  },
  {
    key: "microsoft.guests",
    title: "Guest accounts",
    area: "people",
    severity: "low",
    informational: true,
    why: "Guests from other companies can open what's shared with them in Teams and SharePoint. Someone should own the list and remove the ones that are done.",
    controlCodes: [],
    apiCalls: ["GET /users (userType = Guest)"],
    fix: { console: "Entra admin center → Users → filter User type = Guest → delete the ones that no longer need access (or set up an access review for guests with Entra ID P2)." },
  },
  {
    key: "microsoft.app_consents",
    title: "Apps that can read everyone's mail or files",
    area: "apps",
    severity: "medium",
    informational: true,
    why: "An app granted Mail.Read or Files.Read.All is a vendor holding your data — often one nobody approved. Add the ones you keep to Vendors; remove the rest.",
    controlCodes: VENDORS,
    apiCalls: ["GET /oauth2PermissionGrants", "GET /servicePrincipals/{id}"],
    fix: {
      console:
        "Keep it: add it to Vendors and mark it here as approved. Remove it: Entra admin center → Enterprise applications → the app → Permissions → Review permissions / delete. Stop new ones: Enterprise applications → Consent and permissions → Do not allow user consent.",
    },
  },
  ...(deviceChecks(
    "microsoft",
    "Intune",
    {
      encryption: "Intune admin center → Endpoint security → Disk encryption → Create policy (BitLocker for Windows, FileVault for macOS) → assign to all devices.",
      retire: "Intune admin center → Devices → the device → Retire (if it's gone), or ask its owner to open Company Portal → Sync.",
    },
    ["GET /deviceManagement/managedDevices (isEncrypted, lastSyncDateTime, userPrincipalName)"],
  ) as unknown as CheckDef<MicrosoftArea>[]),
];

export const MICROSOFT_CHECK_BY_KEY = new Map(MICROSOFT_CHECKS.map((c) => [c.key, c]));

export const MICROSOFT_READS = [
  ["User.Read.All", "accounts, enabled or blocked, member or guest"],
  ["AuditLog.Read.All", "who has registered for MFA (needs Entra ID P1 for the report)"],
  ["Policy.Read.All", "Security Defaults and Conditional Access policies"],
  ["RoleManagement.Read.Directory", "who holds admin roles"],
  ["Directory.Read.All", "apps people or admins consented to (optional)"],
  ["DeviceManagementManagedDevices.Read.All", "Intune devices: encryption, last check-in, owner (optional)"],
] as const;
