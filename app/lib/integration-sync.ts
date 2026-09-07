import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { ensureGoogleAccessToken, fetchWorkspaceSecurity } from "@/lib/google";
import { fetchAccountSecurity } from "@/lib/aws";
import { fetchRepoSecurity as fetchGithubRepoSecurity } from "@/lib/github";
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
  if (!integ.access_token) throw new Error("not connected");

  // Google refreshes rather than replaying, so it must not go through decryptSecret
  // here — ensureGoogleAccessToken owns that, including the write-back.
  if (integ.provider === "google_workspace") {
    const token = await ensureGoogleAccessToken(db, {
      id: integ.id,
      access_token: integ.access_token,
      refresh_token: integ.refresh_token ?? null,
      token_expires_at: integ.token_expires_at ?? null,
    });
    return fetchWorkspaceSecurity(token);
  }

  const secret = decryptSecret(integ.access_token);

  switch (integ.provider) {
    case "aws": {
      const { keyId, secret: s } = JSON.parse(secret) as { keyId: string; secret: string };
      return fetchAccountSecurity(keyId, s);
    }
    case "github":
      return fetchGithubRepoSecurity(secret);
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
    default:
      throw new Error(`provider ${integ.provider} is not syncable`);
  }
}

/** True if a provider fetch failed because the stored credential is bad/revoked. */
export function isAuthError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { kind?: string }).kind === "auth");
}
