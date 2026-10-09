import type { Residency } from "@/lib/aws/stores";

/** Workspace-level AWS settings, kept on the umbrella integrations row's metadata. */

export const DEFAULT_LOG_RETENTION_DAYS = 365;
export const DEFAULT_RESTORE_TEST_DAYS = 365;

export interface AwsSettings {
  logRetentionDays: number;
  restoreTestDays: number;
  residency: Residency | null;
  /** Publish the verified facts on the Trust Center. */
  showOnTrustCenter: boolean;
}

export function settingsFrom(metadata: unknown): AwsSettings {
  const s = ((metadata as { settings?: Partial<AwsSettings> } | null)?.settings ?? {}) as Partial<AwsSettings>;
  return {
    logRetentionDays: s.logRetentionDays ?? DEFAULT_LOG_RETENTION_DAYS,
    restoreTestDays: s.restoreTestDays ?? DEFAULT_RESTORE_TEST_DAYS,
    residency: s.residency === "eu" || s.residency === "europe" ? s.residency : null,
    showOnTrustCenter: Boolean(s.showOnTrustCenter),
  };
}
