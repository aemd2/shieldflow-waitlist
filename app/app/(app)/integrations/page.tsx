import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import {
  Building2,
  GitBranch,
  MessageSquare,
  Cloud,
  KeyRound,
  Ticket,
  Users,
  Laptop,
} from "lucide-react";
import { createServerSupabase, getRequestUser } from "@/lib/supabase/server";
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
import { appConfig } from "@/lib/integrations/github/client";
import { SlackCard } from "@/components/integrations/SlackCard";
import { AwsCard } from "@/components/integrations/AwsCard";
import { loadAwsView } from "@/lib/aws/view";
import { IntegrationConnectCard } from "@/components/integrations/IntegrationConnectCard";
import { IntegrationsUrlToast } from "@/components/integrations/IntegrationsUrlToast";
import { connectOkta, syncOkta, disconnectOkta } from "@/app/actions/okta";
import { connectMicrosoft, syncMicrosoft, disconnectMicrosoft } from "@/app/actions/microsoft";
import { connectKandji, syncKandji, disconnectKandji, connectJamf, syncJamf, disconnectJamf } from "@/app/actions/mdm";
import {
  connectPersonio,
  syncPersonio,
  disconnectPersonio,
  connectHiBob,
  syncHiBob,
  disconnectHiBob,
  connectBambooHR,
  syncBambooHR,
  disconnectBambooHR,
} from "@/app/actions/hris";
import { connectGitLab, syncGitLab, disconnectGitLab } from "@/app/actions/gitlab";
import { connectJira, syncJira, disconnectJira } from "@/app/actions/jira";
import { connectLinear, syncLinear, disconnectLinear } from "@/app/actions/linear";
import { connectCloudflare, syncCloudflare, disconnectCloudflare } from "@/app/actions/cloudflare";
import { connectGcp, syncGcp, disconnectGcp } from "@/app/actions/gcp";

// AWS scans run inside a server action invoked from this page: give it room.
export const maxDuration = 60;

export default async function IntegrationsPage() {
  const supabase = await createServerSupabase();
  const user = await getRequestUser();
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
  const awsView = await loadAwsView(supabase, company.id).catch(() => null);
  const okta = byProvider("okta");
  const microsoft = byProvider("microsoft");
  const personio = byProvider("personio");
  const hibob = byProvider("hibob");
  const bamboohr = byProvider("bamboohr");
  const kandji = byProvider("kandji");
  const jamf = byProvider("jamf");
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
              needsReconnect={
                gws?.status === "connected" &&
                !((gws?.metadata as { scopes?: string[] } | null)?.scopes ?? []).some((sc) => sc.endsWith("admin.reports.audit.readonly"))
              }
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
            page={{ href: "/integrations/okta", label: "Open Okta" }}
            disconnectConfirm="Disconnect Okta? Collected evidence stays in the vault."
            setupHint={
              <>Okta Admin → Security → API → Tokens → create a read-only token; paste your org URL above.</>
            }
          />
        </IntegrationCard>

        <IntegrationCard
          name="Microsoft 365"
          description="MFA actually required and registered, admins, guests, apps that can read everyone's mail — and with Intune, every laptop encrypted. Plus leavers and unknown accounts."
          icon={<KeyRound className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(microsoft)}
        >
          <IntegrationConnectCard
            provider="microsoft"
            status={microsoft?.status ?? null}
            lastSyncedAt={microsoft?.last_synced_at ?? null}
            identityLabel={microsoft ? `Connected to ${meta(microsoft).org ?? "your tenant"}` : null}
            fields={[
              { name: "tenantId", placeholder: "Tenant ID or contoso.onmicrosoft.com" },
              { name: "clientId", placeholder: "Application (client) ID" },
              { name: "clientSecret", placeholder: "Client secret value", type: "password" },
            ]}
            connectAction={connectMicrosoft}
            syncAction={syncMicrosoft}
            disconnectAction={disconnectMicrosoft}
            page={{ href: "/integrations/microsoft", label: "Open Microsoft 365" }}
            disconnectConfirm="Disconnect Microsoft 365? Collected evidence stays in the vault."
            setupHint={
              <>
                Entra admin centre → App registrations → New registration. Then API permissions →
                Microsoft Graph → <b>Application permissions</b> → <b>User.Read.All</b> (required), plus for the
                deeper checks <b>AuditLog.Read.All</b>, <b>Policy.Read.All</b>, <b>RoleManagement.Read.Directory</b>,{" "}
                <b>Directory.Read.All</b> and, with Intune, <b>DeviceManagementManagedDevices.Read.All</b> — all read-only →
                Grant admin consent. Finally Certificates &amp; secrets → New client secret, and paste the secret{" "}
                <b>Value</b> (not the Secret ID) above. <Link href="/checks/microsoft" className="underline">What each one is for</Link>.
              </>
            }
          />
        </IntegrationCard>
      </PageSection>

      <PageSection title="HR systems" columns={2}>
        <IntegrationCard
          name="Personio"
          description="Joiners, notice periods and leavers with their leaving date, synced into Personnel every morning — so every leaver check runs off HR."
          icon={<Users className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(personio)}
        >
          <IntegrationConnectCard
            provider="personio"
            status={personio?.status ?? null}
            lastSyncedAt={personio?.last_synced_at ?? null}
            identityLabel={personio ? meta(personio).org ?? "Connected" : null}
            fields={[
              { name: "clientId", placeholder: "Client ID" },
              { name: "clientSecret", placeholder: "Client secret", type: "password" },
            ]}
            connectAction={connectPersonio}
            syncAction={syncPersonio}
            disconnectAction={disconnectPersonio}
            page={{ href: "/integrations/personio", label: "Open Personio" }}
            disconnectConfirm="Disconnect Personio? Personnel and collected evidence stay."
            setupHint={
              <>
                Personio → Settings → Integrations → API credentials → generate, read access to employees, with email, status, hire date,
                termination date and last working day readable. <Link href="/checks/personio" className="underline">Exactly what we read</Link>.
              </>
            }
          />
        </IntegrationCard>
        <IntegrationCard
          name="HiBob"
          description="Joiners, notice periods and leavers with their leaving date, synced into Personnel every morning — so every leaver check runs off HR."
          icon={<Users className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(hibob)}
        >
          <IntegrationConnectCard
            provider="hibob"
            status={hibob?.status ?? null}
            lastSyncedAt={hibob?.last_synced_at ?? null}
            identityLabel={hibob ? meta(hibob).org ?? "Connected" : null}
            fields={[
              { name: "serviceUserId", placeholder: "Service user ID" },
              { name: "token", placeholder: "Service user token", type: "password" },
            ]}
            connectAction={connectHiBob}
            syncAction={syncHiBob}
            disconnectAction={disconnectHiBob}
            page={{ href: "/integrations/hibob", label: "Open HiBob" }}
            disconnectConfirm="Disconnect HiBob? Personnel and collected evidence stay."
            setupHint={
              <>
                HiBob → Settings → Integrations → Service users → create one; give its permission group read access to People (name, email,
                work, lifecycle) including former employees. <Link href="/checks/hibob" className="underline">Exactly what we read</Link>.
              </>
            }
          />
        </IntegrationCard>
        <IntegrationCard
          name="BambooHR"
          description="Joiners and leavers with their termination date, synced into Personnel every morning — so every leaver check runs off HR."
          icon={<Users className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(bamboohr)}
        >
          <IntegrationConnectCard
            provider="bamboohr"
            status={bamboohr?.status ?? null}
            lastSyncedAt={bamboohr?.last_synced_at ?? null}
            identityLabel={bamboohr ? meta(bamboohr).org ?? "Connected" : null}
            fields={[
              { name: "subdomain", placeholder: "Subdomain (yourco in yourco.bamboohr.com)" },
              { name: "apiKey", placeholder: "API key", type: "password" },
            ]}
            connectAction={connectBambooHR}
            syncAction={syncBambooHR}
            disconnectAction={disconnectBambooHR}
            page={{ href: "/integrations/bamboohr", label: "Open BambooHR" }}
            disconnectConfirm="Disconnect BambooHR? Personnel and collected evidence stay."
            setupHint={
              <>
                BambooHR → your name → API Keys → Add new key, for a user whose access level can see work email, job, hire and termination
                dates. <Link href="/checks/bamboohr" className="underline">Exactly what we read</Link>.
              </>
            }
          />
        </IntegrationCard>
      </PageSection>

      <PageSection title="Laptops (device management)" columns={2}>
        <IntegrationCard
          name="Kandji"
          description="Every Mac encrypted with FileVault, checking in, and belonging to someone in Personnel — no agent to install."
          icon={<Laptop className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(kandji)}
        >
          <IntegrationConnectCard
            provider="kandji"
            status={kandji?.status ?? null}
            lastSyncedAt={kandji?.last_synced_at ?? null}
            identityLabel={kandji ? meta(kandji).org ?? "Connected" : null}
            fields={[
              { name: "apiUrl", placeholder: "API URL, e.g. https://yourco.api.kandji.io" },
              { name: "token", placeholder: "API token", type: "password" },
            ]}
            connectAction={connectKandji}
            syncAction={syncKandji}
            disconnectAction={disconnectKandji}
            page={{ href: "/integrations/kandji", label: "Open Kandji" }}
            disconnectConfirm="Disconnect Kandji? Collected evidence stays in the vault."
            setupHint={
              <>
                Kandji → Settings → Access → API token → Add token, with only device list and device details (read). Copy the API URL from the same
                page. <Link href="/checks/kandji" className="underline">Exactly what we read</Link>.
              </>
            }
          />
        </IntegrationCard>
        <IntegrationCard
          name="Jamf Pro"
          description="Every Mac encrypted with FileVault, checking in, and belonging to someone in Personnel — no agent to install."
          icon={<Laptop className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(jamf)}
        >
          <IntegrationConnectCard
            provider="jamf"
            status={jamf?.status ?? null}
            lastSyncedAt={jamf?.last_synced_at ?? null}
            identityLabel={jamf ? meta(jamf).org ?? "Connected" : null}
            fields={[
              { name: "url", placeholder: "https://yourco.jamfcloud.com" },
              { name: "clientId", placeholder: "API client ID" },
              { name: "clientSecret", placeholder: "API client secret", type: "password" },
            ]}
            connectAction={connectJamf}
            syncAction={syncJamf}
            disconnectAction={disconnectJamf}
            page={{ href: "/integrations/jamf", label: "Open Jamf" }}
            disconnectConfirm="Disconnect Jamf Pro? Collected evidence stays in the vault."
            setupHint={
              <>
                Jamf Pro → Settings → API roles and clients → a role with Read Computers + Read Computer Inventory Collection, then an API client
                with that role. <Link href="/checks/jamf" className="underline">Exactly what we read</Link>.
              </>
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
            channel={(slack?.metadata as { channel?: string } | null)?.channel ?? null}
            alerts={(slack?.metadata as { slack?: { alerts?: boolean } } | null)?.slack?.alerts !== false}
            weekly={(slack?.metadata as { slack?: { weekly?: boolean } } | null)?.slack?.weekly !== false}
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
            appEnabled={appConfig().configured}
            connectedLogin={(github?.metadata as { login?: string } | null)?.login ?? null}
            connection={(github?.metadata as { connection?: string } | null)?.connection ?? null}
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
            fields={[
              { name: "token", placeholder: "glpat-... (read_api)", type: "password" },
              { name: "host", placeholder: "Server address — leave empty for gitlab.com", optional: true },
            ]}
            connectAction={connectGitLab}
            syncAction={syncGitLab}
            disconnectAction={disconnectGitLab}
            page={{ href: "/integrations/gitlab", label: "Open GitLab" }}
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
            page={{ href: "/integrations/jira", label: "Open Jira" }}
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
            page={{ href: "/integrations/linear", label: "Open Linear" }}
            disconnectConfirm="Disconnect Linear? Collected evidence stays in the vault."
            setupHint={<>Linear → Settings → API → Personal API keys → create a key.</>}
          />
        </IntegrationCard>
      </PageSection>

      <PageSection title="Cloud infrastructure" columns={2}>
        <IntegrationCard
          name="AWS"
          description="Around 30 read-only checks across every account and region you use — identity, logging, exposure, encryption, patching, backups — each naming the resource and the fix."
          icon={<Cloud className="h-5 w-5 text-muted-foreground" />}
          status={cardStatus(aws)}
        >
          <AwsCard
            // The card only needs each account's settings — not its (large) last scan or region list.
            accounts={(awsView?.accounts ?? []).map(({ scan: _scan, regions: _regions, ...a }) => a)}
            canWrite={access?.canWrite ?? false}
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
            page={{ href: "/integrations/gcp", label: "Open Google Cloud" }}
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
            page={{ href: "/integrations/cloudflare", label: "Open Cloudflare" }}
            disconnectConfirm="Disconnect Cloudflare? Collected evidence stays in the vault."
            setupHint={
              <>Cloudflare → My Profile → API Tokens → create a token with read access to your zones.</>
            }
          />
        </IntegrationCard>
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
