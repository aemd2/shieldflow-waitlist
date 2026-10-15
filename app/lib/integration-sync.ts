import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { scanWorkspace } from "@/lib/aws/scan";
import { scanGitHub } from "@/lib/integrations/github/scan";
import { scanGoogle } from "@/lib/integrations/google/scan";
import { scanMicrosoft } from "@/lib/integrations/microsoft/scan";
import { scanHris } from "@/lib/integrations/hris/scan";
import { scanMdm } from "@/lib/integrations/mdm/scan";
import { fetchUserSecurity as fetchOktaSecurity } from "@/lib/okta";
import { fetchProjectSecurity as fetchGcpSecurity } from "@/lib/gcp";
import { fetchZoneSecurity as fetchCloudflareSecurity } from "@/lib/cloudflare";
import { fetchRepoSecurity as fetchGitlabRepoSecurity } from "@/lib/gitlab";

/**
 * Providers whose posture maps to automated checks AND can be re-synced without a
 * user session. Jira/Linear/Slack have no security evaluator, so they're absent.
 *
 * Google Workspace used to be excluded on the grounds that its OAuth token "needs
 * interactive refresh". That was over-cautious: we ask for access_type=offline at
 * consent and store the refresh_token, so the token can be renewed in the
 * background like any other credential. Leaving it out meant the identity checks
 * only ran when someone remembered to click Sync — which is exactly the manual
 * cadence this whole feature exists to replace.
 */
export const SYNCABLE_PROVIDERS = [
  "aws",
  "github",
  "okta",
  "gcp",
  "cloudflare",
  "gitlab",
  "google_workspace",
  "microsoft",
  "personio",
  "hibob",
  "bamboohr",
  "kandji",
  "jamf",
] as const;
export type SyncableProvider = (typeof SYNCABLE_PROVIDERS)[number];

export interface ConnectedIntegration {
  id: string;
  company_id: string;
  provider: string;
  access_token: string | null;
  /** Google only — the rest replay a stored key and never need these. */
  refresh_token?: string | null;
  token_expires_at?: string | null;
  /** Workspace settings for the deep integrations (SLA days, windows…). */
  metadata?: Record<string, unknown> | null;
}

/**
 * Decrypt a connected integration's stored credentials and fetch its current
 * security posture from the provider — the very same posture object the manual
 * sync feeds to recordChecksForSync. Throws the provider's own error (which carries
 * a `kind`) on failure; the caller isolates and records it.
 *
 * `db` is only used by Google, which may refresh its access token and has to
 * persist the new one; every other provider ignores it.
 */
export async function fetchPostureFor(
  integ: ConnectedIntegration,
  db: SupabaseClient,
): Promise<unknown> {
  // AWS keeps its connections on aws_accounts (roles hold no token at all), so it
  // never goes through the stored-token path below.
  if (integ.provider === "aws") return scanWorkspace(db, integ.company_id);

  if (!integ.access_token) throw new Error("not connected");

  // Google refreshes rather than replaying, so it must not go through decryptSecret
  // here — ensureGoogleAccessToken owns that, including the write-back.
  if (integ.provider === "google_workspace") {
    return scanGoogle(db, {
      id: integ.id,
      company_id: integ.company_id,
      access_token: integ.access_token,
      refresh_token: integ.refresh_token ?? null,
      token_expires_at: integ.token_expires_at ?? null,
      metadata: integ.metadata ?? null,
    });
  }

  const secret = decryptSecret(integ.access_token);

  switch (integ.provider) {
    case "github":
      // The deep scan decrypts for itself: App installs store an installation id, not a token.
      return scanGitHub(db, { id: integ.id, company_id: integ.company_id, access_token: integ.access_token, metadata: integ.metadata ?? null });
    case "okta": {
      const { host, token } = JSON.parse(secret) as { host: string; token: string };
      return fetchOktaSecurity(host, token);
    }
    case "gcp":
      return fetchGcpSecurity(secret);
    case "cloudflare":
      return fetchCloudflareSecurity(secret);
    case "gitlab":
      return fetchGitlabRepoSecurity(secret);
    case "microsoft":
      return scanMicrosoft(db, { id: integ.id, company_id: integ.company_id, access_token: integ.access_token, metadata: integ.metadata ?? null });
    case "personio":
    case "hibob":
    case "bamboohr":
      // Also brings Personnel up to date, before the other providers' leaver checks read it.
      return scanHris(db, integ.provider, { id: integ.id, company_id: integ.company_id, access_token: integ.access_token, metadata: integ.metadata ?? null });
    case "kandji":
    case "jamf":
      return scanMdm(db, integ.provider, { id: integ.id, company_id: integ.company_id, access_token: integ.access_token, metadata: integ.metadata ?? null });
    default:
      throw new Error(`provider ${integ.provider} is not syncable`);
  }
}

/** True if a provider fetch failed because the stored credential is bad/revoked. */
export function isAuthError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { kind?: string }).kind === "auth");
}
