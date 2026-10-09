import type { IdentityAccount } from "@/lib/identity-checks";
import type { AccountScan, AwsAccessGrant, AwsIdentity } from "@/lib/aws/types";

/**
 * Pure people logic shared by the scanner, the checks engine, the AWS page and
 * the facts: merge each account's view of who can sign in, and match AWS
 * identities to Personnel. No AWS SDK here, so the checks engine and the AI
 * routes can import it without loading any AWS client.
 */

// ------------------------------------------------------------------ merging

export type IdentityCenterState = "seen" | "elsewhere" | "none";

export interface WorkspacePeople {
  /** Identity Center users (every connected account's view, merged) + IAM users of in-scope accounts. */
  identities: AwsIdentity[];
  identityCenter: IdentityCenterState;
  truncated: boolean;
  gaps: string[];
  /** In-scope account ids, so grants can be marked as reaching production. */
  inScope: string[];
}

/**
 * One people list across the workspace. Identity Center users count whatever
 * account the instance lives in (management accounts are often out of audit
 * scope, but the people in them reach production). IAM users count only in
 * in-scope accounts. Null when no account's people could be read at all.
 */
export function mergePeople(
  accounts: { scan: AccountScan | null; inScope: boolean; error?: string | null; label?: string }[],
): WorkspacePeople | null {
  const withPeople = accounts.filter((a) => a.scan?.people);
  if (!withPeople.length) return null;
  const inScope = accounts.filter((a) => a.inScope && a.scan).map((a) => a.scan!.accountId);
  const connected = new Set(accounts.filter((a) => a.scan).map((a) => a.scan!.accountId));

  const sso = new Map<string, AwsIdentity>();
  const iam: AwsIdentity[] = [];
  let seen = false;
  let truncated = false;
  // An account that couldn't be scanned may hold the people we'd otherwise miss.
  const gaps: string[] = accounts.filter((a) => !a.scan).map((a) => `${a.label ?? "an account"} couldn't be scanned${a.error ? ` (${a.error})` : ""}`);
  let organization: { managementAccountId: string } | null = null;

  for (const { scan, inScope: scoped } of withPeople) {
    const p = scan!.people!;
    truncated ||= p.truncated;
    gaps.push(...p.gaps.map((g) => `${scan!.alias ?? scan!.accountId}: ${g}`));
    organization ??= p.organization;
    if (p.identityCenter) seen = true;
    for (const id of p.identities) {
      if (id.kind === "sso") {
        const prev = sso.get(id.id);
        if (!prev) sso.set(id.id, { ...id, access: [...id.access] });
        else for (const g of id.access) if (!prev.access.some((x) => x.accountId === g.accountId && x.role === g.role && x.via === g.via)) prev.access.push(g);
      } else if (scoped) {
        iam.push(id);
      }
    }
  }

  // Identity Center may exist where we can't see it: the account is in an
  // organisation whose management account isn't connected.
  const state: IdentityCenterState = seen
    ? "seen"
    : organization && !connected.has(organization.managementAccountId)
      ? "elsewhere"
      : "none";

  const identities = [...sso.values(), ...iam].sort((a, b) => (a.email ?? a.name).localeCompare(b.email ?? b.name));
  return { identities, identityCenter: state, truncated, gaps, inScope };
}

/** Grants that reach an in-scope (production) account. */
export function productionGrants(identity: AwsIdentity, inScope: string[]): AwsAccessGrant[] {
  return identity.access.filter((g) => inScope.includes(g.accountId));
}

// ------------------------------------------------------------------ matching

export interface PersonLite {
  name: string;
  email: string | null;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const squash = (s: string) => norm(s).replace(/[\s._-]+/g, "");

/**
 * The Personnel addresses an AWS identity belongs to. Emails match directly;
 * an IAM user called "jane" or "jane.doe" matches the one person whose email
 * starts "jane@" / whose name is "Jane Doe" — and only if exactly one does, so a
 * guess never pins one person's access on someone else.
 */
export function addressesFor(identity: AwsIdentity, people: PersonLite[]): string[] {
  const direct = [identity.email, identity.name.includes("@") ? identity.name : null].map(norm).filter(Boolean);
  if (direct.length) return [...new Set(direct)];
  const handle = squash(identity.name);
  if (!handle) return [];
  const hits = people.filter((p) => {
    const local = norm(p.email).split("@")[0];
    return (local && squash(local) === handle) || squash(p.name) === handle;
  });
  return hits.length === 1 && hits[0].email ? [norm(hits[0].email)] : [];
}

/**
 * The two rosters the identity-check engine reconciles against Personnel:
 * everyone who can still get in (where leavers are looked for), and the humans
 * among them (where unknown logins are looked for — an IAM user with only an
 * access key is a machine, and belongs to the service-account checks).
 */
export function awsRosters(p: WorkspacePeople, people: PersonLite[]): { all: IdentityAccount[]; humans: IdentityAccount[] } {
  const toAccount = (i: AwsIdentity): IdentityAccount => {
    const addresses = addressesFor(i, people);
    return { email: i.email ?? addresses[0] ?? i.name, active: i.active, aliases: addresses };
  };
  return {
    all: p.identities.map(toAccount),
    humans: p.identities.filter((i) => i.kind === "sso" || i.console).map(toAccount),
  };
}

/** Why the people list may be incomplete, in words — or null when it isn't. */
export function peopleBlindSpot(p: WorkspacePeople): string | null {
  if (p.identityCenter === "elsewhere") {
    return "this account belongs to an AWS Organization whose management account isn't connected, so IAM Identity Center users can't be seen — connect the account Identity Center is managed from";
  }
  if (p.gaps.length) return `not everything could be read (${p.gaps[0]})`;
  if (p.truncated) return "there are more users and assignments than one scan reads";
  return null;
}
