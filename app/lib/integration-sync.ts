import { decryptSecret } from "@/lib/crypto";
import { fetchAccountSecurity } from "@/lib/aws";
import { fetchRepoSecurity as fetchGithubRepoSecurity } from "@/lib/github";
import { fetchUserSecurity as fetchOktaSecurity } from "@/lib/okta";
import { fetchProjectSecurity as fetchGcpSecurity } from "@/lib/gcp";
import { fetchZoneSecurity as fetchCloudflareSecurity } from "@/lib/cloudflare";
import { fetchRepoSecurity as fetchGitlabRepoSecurity } from "@/lib/gitlab";

/**
 * Providers whose posture maps to automated checks AND can be re-synced without a
 * user session (we store a token/key we can decrypt and replay). Google Workspace
 * is intentionally excluded here: its OAuth access token needs interactive refresh,
 * so it stays manual-only for now. Jira/Linear/Slack have no security evaluator.
 */
export const SYNCABLE_PROVIDERS = ["aws", "github", "okta", "gcp", "cloudflare", "gitlab"] as const;
export type SyncableProvider = (typeof SYNCABLE_PROVIDERS)[number];

export interface ConnectedIntegration {
  id: string;
  company_id: string;
  provider: string;
  access_token: string | null;
}

/**
 * Decrypt a connected integration's stored credentials and fetch its current
 * security posture from the provider — the very same posture object the manual
 * sync feeds to recordChecksForSync. Throws the provider's own error (which carries
 * a `kind`) on failure; the caller isolates and records it.
 */
export async function fetchPostureFor(integ: ConnectedIntegration): Promise<unknown> {
  if (!integ.access_token) throw new Error("not connected");
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
