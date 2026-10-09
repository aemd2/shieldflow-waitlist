import {
  SSOAdminClient,
  ListInstancesCommand,
  ListPermissionSetsProvisionedToAccountCommand,
  ListAccountAssignmentsCommand,
  DescribePermissionSetCommand,
  ListManagedPoliciesInPermissionSetCommand,
  GetInlinePolicyForPermissionSetCommand,
  type InstanceMetadata,
} from "@aws-sdk/client-sso-admin";
import { IdentitystoreClient, ListUsersCommand, ListGroupsCommand, ListGroupMembershipsCommand } from "@aws-sdk/client-identitystore";
import { OrganizationsClient, DescribeOrganizationCommand } from "@aws-sdk/client-organizations";
import { client, collectPages, errorName, pool, section, timeLeft, type ScanCtx } from "@/lib/aws/sdk";
import type { AwsAccessGrant, AwsIdentity, CredentialRow, IdentityCenterInfo, Section } from "@/lib/aws/types";

/**
 * Who can reach AWS: IAM Identity Center users (with the permission sets that
 * reach each connected account, directly or through a group) and IAM users.
 *
 * Identity Center lives in one account and one region of an organisation —
 * usually the management account. We look for it from every connected account
 * and, where it's found, read the assignments into every connected account, so
 * "who can reach production, with which permission set" is one list.
 */

const ADMIN_POLICY = /:policy\/(AdministratorAccess|IAMFullAccess)$/;
const MAX_USERS = 2000;
const MAX_PERMISSION_SETS = 40;

/** Does an inline policy allow every action on every resource? */
export function inlineIsAdmin(json: string | undefined): boolean {
  if (!json) return false;
  try {
    const doc = JSON.parse(json) as { Statement?: unknown };
    const stmts = Array.isArray(doc.Statement) ? doc.Statement : doc.Statement ? [doc.Statement] : [];
    return stmts.some((s) => {
      const st = s as { Effect?: string; Action?: string | string[]; Resource?: string | string[] };
      const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
      return st.Effect === "Allow" && list(st.Action).includes("*") && list(st.Resource).includes("*");
    });
  } catch {
    return false;
  }
}

export async function organizationOf(ctx: ScanCtx): Promise<Section<{ managementAccountId: string } | null>> {
  return section("organizations:DescribeOrganization", ctx, async () => {
    try {
      const r = await client(OrganizationsClient, "us-east-1", ctx).send(new DescribeOrganizationCommand({}));
      const id = r.Organization?.MasterAccountId;
      return id ? { managementAccountId: id } : null;
    } catch (err) {
      if (errorName(err) === "AWSOrganizationsNotInUseException") return null;
      throw err;
    }
  });
}

async function findInstance(ctx: ScanCtx, regions: string[]): Promise<{ meta: InstanceMetadata; region: string } | null> {
  // Look in the likely regions first, then the rest; stop at the first instance.
  const likely = ["us-east-1", "eu-west-1", "eu-central-1", "us-west-2", "eu-west-2"];
  const ordered = [...likely.filter((r) => regions.includes(r)), ...regions.filter((r) => !likely.includes(r))];
  let found: { meta: InstanceMetadata; region: string } | null = null;
  let denied = 0;
  await pool(ordered, 6, ctx, async (region) => {
    if (found) return;
    try {
      const r = await client(SSOAdminClient, region, ctx).send(new ListInstancesCommand({ MaxResults: 10 }));
      const meta = r.Instances?.find((i) => !i.Status || i.Status === "ACTIVE");
      if (meta && !found) found = { meta, region };
    } catch (err) {
      if (/AccessDenied/i.test(errorName(err))) denied++;
    }
  });
  if (!found && denied && denied === ordered.length) {
    throw Object.assign(new Error("AccessDenied"), { name: "AccessDeniedException" });
  }
  return found;
}

/**
 * Identity Center as seen from this account. `targetAccounts` are the connected
 * account ids whose assignments we read (an instance can grant access to any
 * account in the organisation; we only list the ones connected to ShieldFlow).
 */
export async function identityCenter(
  ctx: ScanCtx,
  regions: string[],
  targetAccounts: string[],
): Promise<Section<IdentityCenterInfo | null>> {
  return section("sso:ListInstances", ctx, async () => {
    const hit = await findInstance(ctx, regions.length ? regions : ["us-east-1"]);
    if (!hit?.meta.InstanceArn || !hit.meta.IdentityStoreId) return null;
    const instanceArn = hit.meta.InstanceArn;
    const storeId = hit.meta.IdentityStoreId;
    const sso = client(SSOAdminClient, hit.region, ctx);
    const ids = client(IdentitystoreClient, hit.region, ctx);
    let truncated = false;

    const rawUsers = await collectPages(
      () => ids.send(new ListUsersCommand({ IdentityStoreId: storeId, MaxResults: 100 })),
      (t) => ids.send(new ListUsersCommand({ IdentityStoreId: storeId, MaxResults: 100, NextToken: t })),
      (p) => p.Users,
      (p) => p.NextToken,
      MAX_USERS,
      ctx,
    );
    if (rawUsers.length >= MAX_USERS) truncated = true;

    const groups = await collectPages(
      () => ids.send(new ListGroupsCommand({ IdentityStoreId: storeId, MaxResults: 100 })),
      (t) => ids.send(new ListGroupsCommand({ IdentityStoreId: storeId, MaxResults: 100, NextToken: t })),
      (p) => p.Groups,
      (p) => p.NextToken,
      500,
      ctx,
    );
    const groupName = new Map(groups.map((g) => [g.GroupId!, g.DisplayName ?? g.GroupId!]));

    // Permission sets that reach each connected account.
    const perAccount = new Map<string, string[]>();
    await pool(targetAccounts, 4, ctx, async (accountId) => {
      const sets = await collectPages(
        () => sso.send(new ListPermissionSetsProvisionedToAccountCommand({ InstanceArn: instanceArn, AccountId: accountId, MaxResults: 100 })),
        (t) => sso.send(new ListPermissionSetsProvisionedToAccountCommand({ InstanceArn: instanceArn, AccountId: accountId, MaxResults: 100, NextToken: t })),
        (p) => p.PermissionSets,
        (p) => p.NextToken,
        MAX_PERMISSION_SETS,
        ctx,
      );
      perAccount.set(accountId, sets);
    });

    // What each permission set is called, and whether it's admin.
    const setInfo = new Map<string, { name: string; admin: boolean }>();
    const allSets = [...new Set([...perAccount.values()].flat())];
    await pool(allSets, 4, ctx, async (arn) => {
      const [d, managed, inline] = await Promise.all([
        sso.send(new DescribePermissionSetCommand({ InstanceArn: instanceArn, PermissionSetArn: arn })),
        sso.send(new ListManagedPoliciesInPermissionSetCommand({ InstanceArn: instanceArn, PermissionSetArn: arn, MaxResults: 100 })),
        sso.send(new GetInlinePolicyForPermissionSetCommand({ InstanceArn: instanceArn, PermissionSetArn: arn })).catch(() => ({ InlinePolicy: undefined })),
      ]);
      const admin =
        Boolean(managed.AttachedManagedPolicies?.some((p) => ADMIN_POLICY.test(p.Arn ?? ""))) || inlineIsAdmin(inline.InlinePolicy);
      setInfo.set(arn, { name: d.PermissionSet?.Name ?? arn.split("/").pop()!, admin });
    });

    // Assignments: account × permission set → users and groups.
    const grants = new Map<string, AwsAccessGrant[]>(); // userId → grants
    const groupGrants: { groupId: string; grant: AwsAccessGrant }[] = [];
    const pairs = [...perAccount.entries()].flatMap(([accountId, sets]) => sets.map((arn) => ({ accountId, arn })));
    await pool(pairs, 4, ctx, async ({ accountId, arn }) => {
      const list = await collectPages(
        () => sso.send(new ListAccountAssignmentsCommand({ InstanceArn: instanceArn, AccountId: accountId, PermissionSetArn: arn, MaxResults: 100 })),
        (t) => sso.send(new ListAccountAssignmentsCommand({ InstanceArn: instanceArn, AccountId: accountId, PermissionSetArn: arn, MaxResults: 100, NextToken: t })),
        (p) => p.AccountAssignments,
        (p) => p.NextToken,
        1000,
        ctx,
      );
      const info = setInfo.get(arn) ?? { name: arn.split("/").pop()!, admin: false };
      for (const a of list) {
        if (!a.PrincipalId) continue;
        if (a.PrincipalType === "GROUP") {
          groupGrants.push({ groupId: a.PrincipalId, grant: { accountId, role: info.name, admin: info.admin, via: `group ${groupName.get(a.PrincipalId) ?? a.PrincipalId}` } });
        } else {
          const g = grants.get(a.PrincipalId) ?? [];
          g.push({ accountId, role: info.name, admin: info.admin, via: null });
          grants.set(a.PrincipalId, g);
        }
      }
    });

    // Expand groups into their members.
    const groupIds = [...new Set(groupGrants.map((g) => g.groupId))];
    const members = new Map<string, string[]>();
    await pool(groupIds, 4, ctx, async (groupId) => {
      const m = await collectPages(
        () => ids.send(new ListGroupMembershipsCommand({ IdentityStoreId: storeId, GroupId: groupId, MaxResults: 100 })),
        (t) => ids.send(new ListGroupMembershipsCommand({ IdentityStoreId: storeId, GroupId: groupId, MaxResults: 100, NextToken: t })),
        (p) => p.GroupMemberships,
        (p) => p.NextToken,
        MAX_USERS,
        ctx,
      );
      members.set(groupId, m.map((x) => (x.MemberId as { UserId?: string } | undefined)?.UserId).filter((x): x is string => Boolean(x)));
    });
    for (const { groupId, grant } of groupGrants) {
      for (const userId of members.get(groupId) ?? []) {
        const g = grants.get(userId) ?? [];
        g.push(grant);
        grants.set(userId, g);
      }
    }
    // Anything the deadline cut short means the list may be missing people.
    if (timeLeft(ctx) <= 0 || setInfo.size < allSets.length) truncated = true;

    const users: AwsIdentity[] = rawUsers.map((u) => {
      const email = u.Emails?.find((e) => e.Primary)?.Value ?? u.Emails?.[0]?.Value ?? (u.UserName?.includes("@") ? u.UserName : null) ?? null;
      const name = u.DisplayName || [u.Name?.GivenName, u.Name?.FamilyName].filter(Boolean).join(" ") || u.UserName || u.UserId!;
      return {
        id: `sso:${u.UserId}`,
        kind: "sso" as const,
        name,
        email,
        active: (u as { UserStatus?: string }).UserStatus !== "DISABLED",
        console: true,
        keys: 0,
        mfa: null,
        lastUsed: null,
        access: grants.get(u.UserId!) ?? [],
      };
    });

    return { instanceArn, region: hit.region, ownerAccountId: hit.meta.OwnerAccountId ?? null, users, truncated };
  });
}

/** IAM users of one account, from the credential report and the admin lookup. */
export function iamIdentities(
  accountId: string,
  report: CredentialRow[],
  admins: { user: string; via: string }[] | null,
): AwsIdentity[] {
  return report
    .filter((r) => r.user !== "<root_account>")
    .map((r) => {
      const keys = r.keys.filter((k) => k.active).length;
      const used = [r.passwordLastUsed, ...r.keys.map((k) => k.lastUsed)].filter(Boolean).sort() as string[];
      const admin = admins?.find((a) => a.user === r.user);
      return {
        id: `iam:${accountId}:${r.user}`,
        kind: "iam" as const,
        name: r.user,
        email: r.user.includes("@") ? r.user : null,
        active: r.passwordEnabled || keys > 0,
        console: r.passwordEnabled,
        keys,
        mfa: r.mfaActive,
        lastUsed: used.at(-1) ?? null,
        access: [{ accountId, role: "IAM user", admin: Boolean(admin), via: admin ? admin.via : null }],
      };
    });
}
