import { MicrosoftError, type MicrosoftCredentials } from "@/lib/microsoft";
import { ok, type Section } from "@/lib/checks-core";
import type { Device } from "@/lib/integrations/devices";

/**
 * Read a Microsoft 365 tenant with the customer's own app registration
 * (application permissions, admin-consented, all read-only). Each area is its
 * own section: a missing permission or licence makes those checks "can't tell"
 * with the exact permission to add, and never stops the rest.
 */

const GRAPH = "https://graph.microsoft.com";
const LOGIN = "https://login.microsoftonline.com";
const MAX_PAGES = 10;

export interface MsUser {
  id: string;
  upn: string;
  mail: string | null;
  name: string | null;
  enabled: boolean;
  guest: boolean;
  created: string | null;
}

export interface MsRegistration {
  upn: string;
  mfaRegistered: boolean;
  methods: string[];
}

export interface MsRoleMember {
  role: string;
  global: boolean;
  /** userPrincipalName, or the service principal's name. */
  member: string;
  kind: "user" | "servicePrincipal" | "group";
}

export interface MsCaPolicy {
  name: string;
  state: "enabled" | "disabled" | "enabledForReportingButNotEnforced";
  /** Requires MFA (or an authentication strength) for all users on all cloud apps. */
  mfaForAll: boolean;
  excludedUsers: number;
}

export interface MsConsent {
  app: string;
  clientId: string;
  tenantWide: boolean;
  scopes: string[];
  microsoft: boolean;
}

export interface MicrosoftPosture {
  tenant: string;
  scannedAt: string;
  durationMs: number;
  users: Section<MsUser[]>;
  usersTruncated: boolean;
  registration: Section<MsRegistration[]>;
  securityDefaults: Section<boolean>;
  conditionalAccess: Section<MsCaPolicy[]>;
  roles: Section<MsRoleMember[]>;
  consents: Section<MsConsent[]>;
  /** null = Intune isn't licensed / set up in this tenant. */
  devices: Section<Device[]> | null;
  devicesTruncated: boolean;
}

const GLOBAL_ADMIN = "62e90394-69f5-4237-9190-012177145e10";
const MICROSOFT_TENANT = "f8cdef31-a31e-4b4a-93e4-5f571e91255a";

class GraphError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function appToken(creds: MicrosoftCredentials): Promise<string> {
  const res = await fetch(`${LOGIN}/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, scope: `${GRAPH}/.default`, grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new MicrosoftError("unavailable", "Couldn't reach Microsoft. Please try again.");
  });
  if (!res.ok) throw new MicrosoftError("auth", "Microsoft rejected these credentials. Check the client secret hasn't expired, then reconnect.");
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new MicrosoftError("auth", "Microsoft didn't return an access token. Please reconnect.");
  return j.access_token;
}

async function graph<T>(token: string, path: string): Promise<T> {
  const res = await fetch(path.startsWith("https://") ? path : `${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new GraphError(0, "network", "Couldn't reach Microsoft Graph");
  });
  if (res.status === 401) throw new MicrosoftError("auth", "Microsoft rejected the token. Please reconnect the integration.");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new GraphError(res.status, body.error?.code ?? "", body.error?.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** All pages, following @odata.nextLink only back to Graph itself. */
async function pages<T>(token: string, path: string): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let url: string | null = path;
  let n = 0;
  while (url && n < MAX_PAGES) {
    const j: { value?: T[]; "@odata.nextLink"?: string } = await graph(token, url);
    items.push(...(j.value ?? []));
    const next = j["@odata.nextLink"];
    url = typeof next === "string" && next.startsWith(`${GRAPH}/`) ? next : null;
    n++;
  }
  return { items, truncated: url !== null };
}

/** A failed read → the section saying what to grant. */
function failed(err: unknown, permission: string, what: string): Section<never> {
  if (err instanceof MicrosoftError) throw err;
  const e = err instanceof GraphError ? err : new GraphError(0, "", String(err));
  if (/NonPremiumTenant|premium|license/i.test(`${e.code} ${e.message}`)) {
    return { ok: false, reason: "unavailable", action: permission, message: `${what} needs Microsoft Entra ID P1 (included in Microsoft 365 Business Premium)` };
  }
  if (e.status === 403) return { ok: false, reason: "denied", action: permission, message: `the app registration needs the ${permission} application permission (with admin consent) to read ${what}` };
  return { ok: false, reason: "error", action: permission, message: `${what} couldn't be read (${e.message.slice(0, 80)})` };
}

export async function collectMicrosoft(creds: MicrosoftCredentials): Promise<MicrosoftPosture> {
  const started = Date.now();
  const token = await appToken(creds);

  const usersP = pages<{ id: string; userPrincipalName?: string; mail?: string | null; displayName?: string; accountEnabled?: boolean; userType?: string; createdDateTime?: string }>(
    token,
    "/v1.0/users?$select=id,userPrincipalName,mail,displayName,accountEnabled,userType,createdDateTime&$top=999",
  )
    .then(({ items, truncated }) => ({
      section: ok(
        items
          .filter((u) => u.userPrincipalName)
          .map((u) => ({
            id: u.id,
            upn: u.userPrincipalName!.toLowerCase(),
            mail: u.mail?.toLowerCase() ?? null,
            name: u.displayName ?? null,
            enabled: u.accountEnabled !== false,
            guest: (u.userType ?? "").toLowerCase() === "guest" || u.userPrincipalName!.includes("#EXT#"),
            created: u.createdDateTime ?? null,
          })),
      ) as Section<MsUser[]>,
      truncated,
    }))
    .catch((e) => ({ section: failed(e, "User.Read.All", "users") as Section<MsUser[]>, truncated: false }));

  const registrationP = pages<{ userPrincipalName?: string; isMfaRegistered?: boolean; methodsRegistered?: string[] }>(
    token,
    "/v1.0/reports/authenticationMethods/userRegistrationDetails?$select=userPrincipalName,isMfaRegistered,methodsRegistered&$top=999",
  )
    .then(({ items, truncated }): Section<MsRegistration[]> =>
      truncated
        ? { ok: false, reason: "timeout", action: "AuditLog.Read.All", message: "more MFA registrations than one scan reads" }
        : ok(items.filter((r) => r.userPrincipalName).map((r) => ({ upn: r.userPrincipalName!.toLowerCase(), mfaRegistered: Boolean(r.isMfaRegistered), methods: r.methodsRegistered ?? [] }))),
    )
    .catch((e) => failed(e, "AuditLog.Read.All", "MFA registration"));

  const defaultsP = graph<{ isEnabled?: boolean }>(token, "/v1.0/policies/identitySecurityDefaultsEnforcementPolicy")
    .then((j): Section<boolean> => ok(Boolean(j.isEnabled)))
    .catch((e) => failed(e, "Policy.Read.All", "security defaults"));

  const caP = pages<{
    displayName?: string;
    state?: MsCaPolicy["state"];
    conditions?: { users?: { includeUsers?: string[]; excludeUsers?: string[]; excludeGroups?: string[] }; applications?: { includeApplications?: string[] } };
    grantControls?: { builtInControls?: string[]; authenticationStrength?: unknown } | null;
  }>(token, "/v1.0/identity/conditionalAccess/policies")
    .then(({ items }): Section<MsCaPolicy[]> =>
      ok(
        items.map((p) => ({
          name: p.displayName ?? "policy",
          state: p.state ?? "disabled",
          mfaForAll:
            Boolean(p.conditions?.users?.includeUsers?.includes("All")) &&
            Boolean(p.conditions?.applications?.includeApplications?.includes("All")) &&
            (Boolean(p.grantControls?.builtInControls?.includes("mfa")) || Boolean(p.grantControls?.authenticationStrength)),
          excludedUsers: (p.conditions?.users?.excludeUsers?.length ?? 0) + (p.conditions?.users?.excludeGroups?.length ?? 0),
        })),
      ),
    )
    .catch((e) => failed(e, "Policy.Read.All", "Conditional Access policies"));

  const rolesP = graph<{ value?: { displayName?: string; roleTemplateId?: string; members?: { "@odata.type"?: string; userPrincipalName?: string; displayName?: string }[] }[] }>(
    token,
    "/v1.0/directoryRoles?$expand=members($select=id,userPrincipalName,displayName)",
  )
    .then((j): Section<MsRoleMember[]> => {
      const out: MsRoleMember[] = [];
      for (const r of j.value ?? []) {
        const global = r.roleTemplateId === GLOBAL_ADMIN || /^(global|company) administrator$/i.test(r.displayName ?? "");
        // Only roles that can change security settings or other people's access.
        if (!global && !/administrator$/i.test(r.displayName ?? "")) continue;
        for (const m of r.members ?? []) {
          const type = (m["@odata.type"] ?? "").toLowerCase();
          out.push({
            role: r.displayName ?? "admin role",
            global,
            member: (m.userPrincipalName ?? m.displayName ?? "unknown").toLowerCase(),
            kind: type.includes("serviceprincipal") ? "servicePrincipal" : type.includes("group") ? "group" : "user",
          });
        }
      }
      return ok(out);
    })
    .catch((e) => failed(e, "RoleManagement.Read.Directory", "admin roles"));

  const consentsP = pages<{ clientId: string; consentType?: string; scope?: string }>(token, "/v1.0/oauth2PermissionGrants?$top=999")
    .then(async ({ items }): Promise<Section<MsConsent[]>> => {
      const broad = items.filter((g) => /\b(Mail\.(Read|ReadWrite)|Files\.(Read|ReadWrite)\.All|Sites\.(Read|ReadWrite)\.All|Directory\.ReadWrite\.All|User\.ReadWrite\.All)\b/.test(g.scope ?? ""));
      const byApp = new Map<string, MsConsent>();
      for (const g of broad.slice(0, 200)) {
        const prev = byApp.get(g.clientId);
        const scopes = (g.scope ?? "").split(" ").filter(Boolean);
        byApp.set(g.clientId, {
          app: prev?.app ?? g.clientId,
          clientId: g.clientId,
          tenantWide: Boolean(prev?.tenantWide) || g.consentType === "AllPrincipals",
          scopes: [...new Set([...(prev?.scopes ?? []), ...scopes])],
          microsoft: false,
        });
      }
      for (const c of [...byApp.values()].slice(0, 50)) {
        const sp = await graph<{ displayName?: string; appOwnerOrganizationId?: string }>(token, `/v1.0/servicePrincipals/${encodeURIComponent(c.clientId)}?$select=displayName,appOwnerOrganizationId`).catch(() => null);
        if (sp?.displayName) c.app = sp.displayName;
        c.microsoft = sp?.appOwnerOrganizationId === MICROSOFT_TENANT;
      }
      return ok([...byApp.values()].filter((c) => !c.microsoft));
    })
    .catch((e) => failed(e, "Directory.Read.All", "app consents"));

  const devicesP = pages<{
    id: string;
    deviceName?: string;
    operatingSystem?: string;
    osVersion?: string;
    isEncrypted?: boolean;
    lastSyncDateTime?: string;
    userPrincipalName?: string;
    userDisplayName?: string;
    managedDeviceOwnerType?: string;
  }>(token, "/v1.0/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem,osVersion,isEncrypted,lastSyncDateTime,userPrincipalName,userDisplayName,managedDeviceOwnerType&$top=999")
    .then(({ items, truncated }) => ({
      section: ok(
        items.map(
          (d): Device => ({
            id: d.id,
            name: d.deviceName ?? d.id,
            os: d.operatingSystem ?? "unknown",
            osVersion: d.osVersion ?? null,
            // Phones report isEncrypted too; only a definite false counts against a device.
            encrypted: typeof d.isEncrypted === "boolean" ? d.isEncrypted : null,
            lastSeen: d.lastSyncDateTime && !d.lastSyncDateTime.startsWith("0001") ? d.lastSyncDateTime : null,
            owner: d.userPrincipalName?.toLowerCase() || null,
            ownerName: d.userDisplayName ?? null,
            corporate: d.managedDeviceOwnerType ? d.managedDeviceOwnerType === "company" : null,
          }),
        ),
      ) as Section<Device[]> | null,
      truncated,
    }))
    .catch((e) => {
      // No Intune licence / not set up: the endpoint answers 400/403 with a licensing message, or 404.
      if (e instanceof GraphError && (e.status === 404 || /intune|license|not.*(enabled|provisioned)/i.test(`${e.code} ${e.message}`))) {
        return { section: null, truncated: false };
      }
      return { section: failed(e, "DeviceManagementManagedDevices.Read.All", "Intune devices") as Section<Device[]>, truncated: false };
    });

  const [users, registration, securityDefaults, conditionalAccess, roles, consents, devices] = await Promise.all([
    usersP,
    registrationP,
    defaultsP,
    caP,
    rolesP,
    consentsP,
    devicesP,
  ]);

  return {
    tenant: creds.tenantId,
    scannedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    users: users.section,
    usersTruncated: users.truncated,
    registration,
    securityDefaults,
    conditionalAccess,
    roles,
    consents,
    devices: devices.section,
    devicesTruncated: devices.truncated,
  };
}
