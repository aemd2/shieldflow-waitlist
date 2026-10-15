import type { Section } from "@/lib/checks-core";

/** How ShieldFlow reaches GitHub: the read-only GitHub App (recommended) or a token. */
export type GitHubAuth = { kind: "app"; installationId: number } | { kind: "token"; token: string };

export interface GhOwner {
  login: string;
  type: "Organization" | "User";
}

export interface GhProtection {
  /** A pull request is required before merging (branch protection or a ruleset). */
  prRequired: boolean;
  approvals: number;
  dismissStale: boolean;
  /** Force pushes to the default branch are blocked. */
  forcePushBlocked: boolean;
  /** Classic protection applies to admins too (false = admins can bypass); null = not knowable. */
  enforceAdmins: boolean | null;
  /** Where the rule came from. */
  source: "branch-protection" | "ruleset" | "both" | "none";
  /** Branch protection isn't available for this repository on the owner's GitHub plan (private repo, free plan). */
  planBlocked?: boolean;
}

export interface GhRepo {
  fullName: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  topics: string[];
  /** null = couldn't read (permission, limit). */
  protection: GhProtection | null;
  /** Dependabot alerts switched on; null = couldn't read. */
  dependabot: boolean | null;
  /** Deploy keys that can push; null = couldn't read. */
  writeDeployKeys: string[] | null;
}

export interface GhPullRequest {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  mergedBy: string | null;
  mergedAt: string;
  /** Approvals from someone other than the author, submitted before the merge. */
  approvers: string[];
  independentApproval: boolean;
  ticket: string | null;
}

export interface GhMember {
  login: string;
  name: string | null;
  email: string | null;
  role: "owner" | "member" | "outside";
  /** false = GitHub says 2FA is off; null = couldn't read. */
  twoFactor: boolean | null;
}

export interface GhAlert {
  id: string;
  repo: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  createdAt: string;
  url: string;
}

export interface GhOrgPosture {
  login: string;
  twoFactorRequired: Section<boolean | null>;
  members: Section<GhMember[]>;
  /** Members GitHub lists with 2FA disabled (owner-only filter). */
  without2fa: Section<string[]>;
}

export interface GitHubPosture {
  owners: GhOwner[];
  scannedAt: string;
  durationMs: number;
  repos: Section<GhRepo[]>;
  /** More repositories than one scan reads in detail. */
  reposTruncated: boolean;
  /** Repositories whose detail (protection, Dependabot…) wasn't read this scan. */
  reposUnread: string[];
  orgs: GhOrgPosture[];
  pulls: Section<GhPullRequest[]>;
  /** Repos whose merged pull requests couldn't be read. */
  pullsUnread: string[];
  dependabot: Section<GhAlert[]>;
  /** null = not available on this plan / not enabled — never required. */
  secretScanning: Section<GhAlert[]> | null;
  codeScanning: Section<GhAlert[]> | null;
}
