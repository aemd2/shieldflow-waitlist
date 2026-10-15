import type { Section } from "@/lib/checks-core";

/** One Workspace account, as the Directory API returns it (only the fields we use). */
export interface GUser {
  email: string;
  aliases: string[];
  name: string | null;
  enrolled2sv: boolean;
  /** 2-step verification is enforced for this user (by their organisational unit or group). */
  enforced2sv: boolean;
  superAdmin: boolean;
  delegatedAdmin: boolean;
  suspended: boolean;
  /** Archived users keep their data but can't sign in. */
  archived: boolean;
  /** null = never signed in. */
  lastLogin: string | null;
  created: string | null;
  orgUnit: string;
}

/** A third-party app people granted access to their Google account. */
export interface GApp {
  clientId: string;
  name: string;
  scopes: string[];
  /** People who still hold a grant (authorised and not revoked since). */
  users: string[];
  lastAuthorized: string;
}

export interface GooglePosture {
  /** The primary domain, from the first account's address. */
  domain: string | null;
  scannedAt: string;
  durationMs: number;
  users: Section<GUser[]>;
  /** More accounts than one scan reads. */
  truncated: boolean;
  /** null = the audit-log permission wasn't granted (connected before it was asked for). */
  apps: Section<GApp[]> | null;
  /** How far back app grants were read. */
  appsWindowDays: number;
}
