import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  Building2,
  GitBranch,
  MessageSquare,
  Cloud,
  KeyRound,
  Ticket,
  Fingerprint,
  Mail,
} from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getCallerAccess,
  listIntegrations,
  type Integration,
} from "@/lib/db/queries";
import { INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { isGoogleConfigured } from "@/lib/google";
import { isGitHubOAuthConfigured } from "@/lib/github";
import { isSlackOAuthConfigured } from "@/lib/slack";
import { IntegrationCard } from "@/components/integrations/IntegrationCard";
import { PageShell, PageSection } from "@/components/ui/page";
import { GoogleWorkspaceCard } from "@/components/integrations/GoogleWorkspaceCard";
import { GitHubCard } from "@/components/integrations/GitHubCard";
import { SlackCard } from "@/components/integrations/SlackCard";
import { AwsCard } from "@/components/integrations/AwsCard";
import { IntegrationConnectCard } from "@/components/integrations/IntegrationConnectCard";
import { IntegrationsUrlToast } from "@/components/integrations/IntegrationsUrlToast";
import { connectOkta, syncOkta, disconnectOkta } from "@/app/actions/okta";
import { connectGitLab, syncGitLab, disconnectGitLab } from "@/app/actions/gitlab";
import { connectJira, syncJira, disconnectJira } from "@/app/actions/jira";
import { connectLinear, syncLinear, disconnectLinear } from "@/app/actions/linear";
import { connectCloudflare, syncCloudflare, disconnectCloudflare } from "@/app/actions/cloudflare";
import { connectGcp, syncGcp, disconnectGcp } from "@/app/actions/gcp";

export default async function IntegrationsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  // One query for all providers; tokens are never selected.
  const integrations = await listIntegrations(supabase, company.id).catch(
    () => [] as Integration[],
  );

  // Auditors are read-only: show connection status, but none of the connect/sync UI.
  const access = await getCallerAccess(supabase, company.id, user.id);
  if (access?.role === "auditor") {
    return <ReadOnlyIntegrations integrations={integrations} />;
  }

  const byProvider = (p: string) => integrations.find((i) => i.provider === p) ?? null;
  const meta = (row: Integration | null) => (row?.metadata ?? {}) as Record<string, string>;

  const gws = byProvider("google_workspace");
  const github = byProvider("github");
  const slack = byProvider("slack");
  const aws = byProvider("aws");
  const okta = byProvider("okta");
  const gitlab = byProvider("gitlab");
  const jira = byProvider("jira");
  const linear = byProvider("linear");
  const cloudflare = byProvider("cloudflare");
  const gcp = byProvider("gcp");

  const cardStatus = (row: Integration | null) =>
    row?.status === "connected" ? "connected" : row?.status === "error" ? "error" : "available";

  return (
    <PageShell
      layout="sections"
      title="Integrations"
      subtitle="Connect your stack to collect compliance evidence automatically and keep your team in the loop."
    >
      <Suspense fallback={null}>
        <IntegrationsUrlToast />
      </Suspense>

      <PageSection title="Identity & workspace" columns={2}>
        <IntegrationCard
          name="Google Workspace"
          description="Pulls a user-security report (2FA enrollment, admins, suspended accounts) into your evidence vault."
          icon={<Building2 className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(gws)}
        >
          <Suspense fallback={<div className="h-9 animate-pulse rounded-md bg-secondary" />}>
            <GoogleWorkspaceCard
              configured={isGoogleConfigured()}
              status={gws?.status ?? null}
              lastSyncedAt={gws?.last_synced_at ?? null}
            />
          </Suspense>
        </IntegrationCard>

        <IntegrationCard
          name="Okta"
          description="Identity posture — user status breakdown, MFA enrollment, and password policy — filed as evidence."
          icon={<KeyRound className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(okta)}
        >
          <IntegrationConnectCard
            provider="okta"
            status={okta?.status ?? null}
            lastSyncedAt={okta?.last_synced_at ?? null}
            identityLabel={okta ? `Connected to ${meta(okta).org ?? "your org"}` : null}
            fields={[
              { name: "domain", placeholder: "your-org.okta.com" },
              { name: "token", placeholder: "Read-only API token", type: "password" },
            ]}
            connectAction={connectOkta}
            syncAction={syncOkta}
            disconnectAction={disconnectOkta}
            disconnectConfirm="Disconnect Okta? Collected evidence stays in the vault."
            setupHint={
              <>Okta Admin → Security → API → Tokens → create a read-only token; paste your org URL above.</>
            }
          />
        </IntegrationCard>
      </PageSection>

      <PageSection title="Notifications" columns={2}>
        <IntegrationCard
          name="Slack"
          description="Sends a compliance digest — score, framework progress, and top alerts — to a channel of your choice."
          icon={<MessageSquare className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(slack)}
        >
          <SlackCard
            oauthEnabled={isSlackOAuthConfigured()}
            status={slack?.status ?? null}
            lastSyncedAt={slack?.last_synced_at ?? null}
          />
        </IntegrationCard>
      </PageSection>

      <PageSection title="Source control" columns={2}>
        <IntegrationCard
          name="GitHub"
          description="Audits your repositories — branch protection, public exposure, archived repos — and files the report as evidence."
          icon={<GitBranch className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(github)}
        >
          <GitHubCard
            status={github?.status ?? null}
            lastSyncedAt={github?.last_synced_at ?? null}
            oauthEnabled={isGitHubOAuthConfigured()}
            connectedLogin={(github?.metadata as { login?: string } | null)?.login ?? null}
          />
        </IntegrationCard>

        <IntegrationCard
          name="GitLab"
          description="Audits your projects — visibility and branch protection — and files the report as evidence."
          icon={<GitBranch className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(gitlab)}
        >
          <IntegrationConnectCard
            provider="gitlab"
            status={gitlab?.status ?? null}
            lastSyncedAt={gitlab?.last_synced_at ?? null}
            identityLabel={gitlab ? `Connected as @${meta(gitlab).username ?? "user"}` : null}
            fields={[{ name: "token", placeholder: "glpat-...", type: "password" }]}
            connectAction={connectGitLab}
            syncAction={syncGitLab}
            disconnectAction={disconnectGitLab}
            disconnectConfirm="Disconnect GitLab? Collected evidence stays in the vault."
            setupHint={<>GitLab → Preferences → Access Tokens → create a token with the read_api scope.</>}
          />
        </IntegrationCard>
      </PageSection>

      <PageSection title="Project & ticketing" columns={2}>
        <IntegrationCard
          name="Jira"
          description="Inventories your projects as change-management evidence."
          icon={<Ticket className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(jira)}
        >
          <IntegrationConnectCard
            provider="jira"
            status={jira?.status ?? null}
            lastSyncedAt={jira?.last_synced_at ?? null}
            identityLabel={jira ? `Connected to ${meta(jira).site ?? "your site"}` : null}
            fields={[
              { name: "site", placeholder: "your-company.atlassian.net" },
              { name: "email", placeholder: "you@company.com" },
              { name: "token", placeholder: "API token", type: "password" },
            ]}
            connectAction={connectJira}
            syncAction={syncJira}
            disconnectAction={disconnectJira}
            disconnectConfirm="Disconnect Jira? Collected evidence stays in the vault."
            setupHint={<>id.atlassian.com → Security → Create and manage API tokens.</>}
          />
        </IntegrationCard>

        <IntegrationCard
          name="Linear"
          description="Summarizes teams and recent issue activity for change-tracking evidence."
          icon={<Ticket className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(linear)}
        >
          <IntegrationConnectCard
            provider="linear"
            status={linear?.status ?? null}
            lastSyncedAt={linear?.last_synced_at ?? null}
            identityLabel={linear ? `Connected as ${meta(linear).account ?? "user"}` : null}
            fields={[{ name: "token", placeholder: "lin_api_...", type: "password" }]}
            connectAction={connectLinear}
            syncAction={syncLinear}
            disconnectAction={disconnectLinear}
            disconnectConfirm="Disconnect Linear? Collected evidence stays in the vault."
            setupHint={<>Linear → Settings → API → Personal API keys → create a key.</>}
          />
        </IntegrationCard>
      </PageSection>

      <PageSection title="Cloud infrastructure" columns={2}>
        <IntegrationCard
          name="AWS"
          description="Reads your account security posture — root MFA, IAM password policy, user/MFA counts — and files it as evidence."
          icon={<Cloud className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(aws)}
        >
          <AwsCard
            status={aws?.status ?? null}
            lastSyncedAt={aws?.last_synced_at ?? null}
            accountId={(aws?.metadata as { account_id?: string } | null)?.account_id ?? null}
          />
        </IntegrationCard>

        <IntegrationCard
          name="Google Cloud"
          description="Reads project IAM exposure — how many accounts hold owner/editor — as evidence."
          icon={<Cloud className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(gcp)}
        >
          <IntegrationConnectCard
            provider="gcp"
            status={gcp?.status ?? null}
            lastSyncedAt={gcp?.last_synced_at ?? null}
            identityLabel={gcp ? `Project ${meta(gcp).project ?? ""}` : null}
            fields={[
              { name: "serviceAccountJson", placeholder: "Paste the service-account JSON key", type: "textarea" },
            ]}
            connectAction={connectGcp}
            syncAction={syncGcp}
            disconnectAction={disconnectGcp}
            disconnectConfirm="Disconnect Google Cloud? Collected evidence stays in the vault."
            setupHint={
              <>GCP → IAM → Service Accounts → create a key (JSON); grant it the Viewer role. Paste the whole file.</>
            }
          />
        </IntegrationCard>

        <IntegrationCard
          name="Cloudflare"
          description="Captures per-zone edge security — SSL/TLS mode, min TLS version, always-use-HTTPS — as evidence."
          icon={<Cloud className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(cloudflare)}
        >
          <IntegrationConnectCard
            provider="cloudflare"
            status={cloudflare?.status ?? null}
            lastSyncedAt={cloudflare?.last_synced_at ?? null}
            identityLabel={cloudflare ? "Connected" : null}
            fields={[{ name: "token", placeholder: "Read-only API token", type: "password" }]}
            connectAction={connectCloudflare}
            syncAction={syncCloudflare}
            disconnectAction={disconnectCloudflare}
            disconnectConfirm="Disconnect Cloudflare? Collected evidence stays in the vault."
            setupHint={
              <>Cloudflare → My Profile → API Tokens → create a token with read access to your zones.</>
            }
          />
        </IntegrationCard>
      </PageSection>

      <PageSection title="Coming soon" columns={2}>
        <IntegrationCard
          name="Microsoft Entra ID"
          description="User, MFA, and conditional-access evidence from Azure AD."
          icon={<Fingerprint className="h-5 w-5 text-muted-foreground" />}
          status="coming_soon"
        />
        <IntegrationCard
          name="Microsoft 365"
          description="Mailbox, sharing, and security-defaults evidence from Microsoft 365."
          icon={<Mail className="h-5 w-5 text-muted-foreground" />}
          status="coming_soon"
        />
      </PageSection>
    </PageShell>
  );
}

function ReadOnlyIntegrations({ integrations }: { integrations: Integration[] }) {
  const byProvider = (p: string) => integrations.find((i) => i.provider === p) ?? null;
  const providers = Object.keys(INTEGRATION_LABELS);
  return (
    <PageShell
      layout="stack"
      title="Integrations"
      subtitle="Connection status (read-only). Connecting and syncing is reserved for the workspace team."
    >
      <div className="card divide-y divide-border p-0">
        {providers.map((p) => {
          const row = byProvider(p);
          const status = row?.status === "connected" ? "Connected" : row?.status === "error" ? "Needs reconnect" : "Not connected";
          const tone =
            row?.status === "connected"
              ? "text-[var(--brand-emerald)]"
              : row?.status === "error"
                ? "text-destructive"
                : "text-muted-foreground";
          return (
            <div key={p} className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-foreground">{INTEGRATION_LABELS[p]}</span>
              <span className={`text-sm font-medium ${tone}`}>
                {status}
                {row?.last_synced_at && row.status === "connected" && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    last synced {new Date(row.last_synced_at).toLocaleDateString()}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
