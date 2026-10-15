import type { CheckDef } from "@/lib/checks-core";
import { GITHUB_AREAS, GITHUB_CHECKS, GITHUB_APP_PERMISSIONS } from "@/lib/integrations/github/catalog";
import { GOOGLE_AREAS, GOOGLE_CHECKS, GOOGLE_READS } from "@/lib/integrations/google/catalog";
import { MICROSOFT_AREAS, MICROSOFT_CHECKS, MICROSOFT_READS } from "@/lib/integrations/microsoft/catalog";
import { HRIS_AREAS, HRIS_META } from "@/lib/integrations/hris/catalog";
import type { HrisProvider } from "@/lib/integrations/hris/clients";
import { MDM_AREAS, MDM_META } from "@/lib/integrations/mdm/catalog";
import type { MdmProvider } from "@/lib/integrations/mdm/clients";
import { CLOUDFLARE_AREAS, CLOUDFLARE_CHECKS, CLOUDFLARE_READS } from "@/lib/integrations/cloudflare/catalog";
import { GCP_AREAS, GCP_CHECKS, GCP_READS } from "@/lib/integrations/gcp/catalog";
import { OKTA_AREAS, OKTA_CHECKS, OKTA_READS } from "@/lib/integrations/okta/catalog";
import { GITLAB_AREAS, GITLAB_CHECKS, GITLAB_READS } from "@/lib/integrations/gitlab/catalog";
import { TRACKER_AREAS, trackerChecks } from "@/lib/integrations/tickets/scan";

/**
 * Every integration that has its own page (/integrations/<key>) and its own
 * public check list (/checks/<key>). Both are generated from the same check
 * definitions the scanner runs, so the page, the public list and the verdicts
 * can't drift apart. AWS has its own richer page and keeps /aws-checks.
 */

export interface SettingField {
  key: string;
  label: string;
  help: string;
  min: number;
  max: number;
  unit: string;
}

export interface ProviderEntry {
  /** URL segment and integrations.provider value. */
  key: string;
  /** Prefix of its check keys ("google" for google_workspace). */
  checkPrefix: string;
  title: string;
  subtitle: string;
  checks: CheckDef[];
  areas: { area: string; title: string }[];
  /** For the public page: how we connect, in plain words. */
  connectStory: string;
  /** What we read, as [permission, why]. */
  reads: readonly (readonly [string, string])[];
  /** What we never read or do. */
  never: string[];
  settings?: SettingField[];
}

export const PROVIDERS: ProviderEntry[] = [
  {
    key: "github",
    checkPrefix: "github",
    title: "GitHub",
    subtitle:
      "Who can push, whether every change to production was reviewed, and how long known vulnerabilities stay open — read-only, across every repository you chose. Anything we couldn't read says so instead of passing.",
    checks: GITHUB_CHECKS,
    areas: GITHUB_AREAS,
    connectStory:
      "ShieldFlow connects as a GitHub App you install on your organisation. GitHub shows you the exact permissions before you install, you pick the repositories, and every permission is read-only. You can see, change or remove the installation at any time under your organisation's Settings → GitHub Apps.",
    reads: GITHUB_APP_PERMISSIONS,
    never: [
      "Source code — the App has no Contents permission, so it can't read a file.",
      "Write anything: no pushes, no comments, no issues, no settings changes.",
      "Secrets: secret-scanning alerts tell us where a secret leaked, never the secret itself (we drop it on arrival).",
      "Actions logs, packages, wikis or discussions.",
    ],
    settings: [
      { key: "criticalDays", label: "Critical vulnerabilities fixed within", help: "Dependabot critical alerts open longer fail the SLA check.", min: 1, max: 90, unit: "days" },
      { key: "highDays", label: "High vulnerabilities fixed within", help: "Dependabot high alerts open longer fail the SLA check.", min: 1, max: 180, unit: "days" },
      { key: "windowDays", label: "Merged changes reviewed over the last", help: "The window of merged pull requests checked for an independent approval.", min: 7, max: 90, unit: "days" },
    ],
  },
  {
    key: "google_workspace",
    checkPrefix: "google",
    title: "Google Workspace",
    subtitle:
      "Whether 2-step verification is enforced (not just switched on), who holds admin, accounts nobody uses, leavers still signed in, and the third-party apps that can read your mail and Drive. Read-only.",
    checks: GOOGLE_CHECKS,
    areas: GOOGLE_AREAS,
    connectStory:
      "A Workspace admin signs in with Google and approves two read-only permissions: the user directory, and the audit log. No service account, no domain-wide delegation, nothing that could change a setting. Remove access any time at myaccount.google.com/permissions.",
    reads: GOOGLE_READS,
    never: [
      "Email, documents, calendars or chats — no Gmail, Drive or Calendar permission is asked for.",
      "Change anything: both permissions are read-only. (Google's token API can list app grants too, but its permission can also revoke them — so we read the audit log instead.)",
      "Passwords or 2-step verification secrets — only whether they're set.",
    ],
    settings: [
      { key: "dormantDays", label: "Accounts count as unused after", help: "Active accounts with no sign-in for this long are listed (new joiners excepted).", min: 30, max: 365, unit: "days" },
    ],
  },
  {
    key: "microsoft",
    checkPrefix: "microsoft",
    title: "Microsoft 365",
    subtitle:
      "Whether MFA is actually required at sign-in, who has registered, who holds admin, guests, apps that can read everyone's mail, and — with Intune — whether every laptop is encrypted. Read-only.",
    checks: MICROSOFT_CHECKS,
    areas: MICROSOFT_AREAS,
    connectStory:
      "You register an app in your own Entra ID tenant, give it read-only application permissions and grant admin consent; ShieldFlow signs in with its client ID and secret, which you can rotate or delete at any time. Only User.Read.All is required — every other permission adds checks, and a missing one shows as \"can't tell\", never as a pass.",
    reads: MICROSOFT_READS,
    never: [
      "Mail, files, chats or calendars — no Mail, Files, Sites or Chat permission is asked for.",
      "Change anything: every permission is a Read permission.",
      "Passwords or authentication secrets — only which methods are registered.",
    ],
    settings: [
      { key: "staleDays", label: "Devices count as stale after", help: "An Intune device that hasn't checked in for this long fails the check-in check, and its encryption counts as unknown.", min: 3, max: 90, unit: "days" },
    ],
  },
  ...(["personio", "hibob", "bamboohr"] as HrisProvider[]).map(
    (key): ProviderEntry => ({
      key,
      checkPrefix: key,
      title: HRIS_META[key].title,
      subtitle: `Your HR system keeps Personnel right: joiners, notice periods and leavers with their leaving date, synced every morning — so every leaver check in Google, Microsoft, GitHub and AWS runs off HR, not a list someone has to remember. Read-only.`,
      checks: HRIS_META[key].checks,
      areas: HRIS_AREAS,
      connectStory: HRIS_META[key].connect,
      reads: HRIS_META[key].reads,
      never: HRIS_META[key].never,
      settings: [{ key: "trainingDays", label: "Joiners finish security training within", help: "People who started longer ago than this without a completed training record fail the joiner check.", min: 7, max: 120, unit: "days" }],
    }),
  ),
  ...(["kandji", "jamf"] as MdmProvider[]).map(
    (key): ProviderEntry => ({
      key,
      checkPrefix: key,
      title: MDM_META[key].title,
      subtitle: `Every laptop encrypted, checking in, and belonging to someone in Personnel — and no leaver's laptop still out there. Without installing an agent: read from ${MDM_META[key].title}, read-only.`,
      checks: MDM_META[key].checks,
      areas: MDM_AREAS,
      connectStory: MDM_META[key].connect,
      reads: MDM_META[key].reads,
      never: MDM_META[key].never,
      settings: [{ key: "staleDays", label: "Devices count as stale after", help: "A device that hasn't checked in for this long fails the check-in check, and its encryption counts as unknown.", min: 3, max: 90, unit: "days" }],
    }),
  ),
  {
    key: "okta",
    checkPrefix: "okta",
    title: "Okta",
    subtitle: "A second factor for everyone (every account, not a sample), nobody on SMS alone, admins, dormant accounts, leavers, and apps that still keep a password. Read-only.",
    checks: OKTA_CHECKS,
    areas: OKTA_AREAS,
    connectStory: "Create an API token as a user with the Read-Only Administrator role and paste it with your Okta address. The token inherits that role's read-only rights; revoke it any time under Security → API → Tokens.",
    reads: OKTA_READS,
    never: ["Passwords, factor secrets or recovery codes — only which factor types are enrolled.", "Change anything: the token's administrator role is read-only."],
    settings: [{ key: "dormantDays", label: "Accounts count as unused after", help: "Active accounts with no sign-in for this long are listed (new accounts excepted).", min: 30, max: 365, unit: "days" }],
  },
  {
    key: "gitlab",
    checkPrefix: "gitlab",
    title: "GitLab",
    subtitle: "Whether every change to production went through an approved merge request, groups requiring 2FA, and projects that are public — on gitlab.com or your own server. Read-only.",
    checks: GITLAB_CHECKS,
    areas: GITLAB_AREAS,
    connectStory: "Create a personal (or group) access token with only the read_api scope and paste it, with your server's address if it isn't gitlab.com. ShieldFlow can't push, comment or change a setting with it.",
    reads: GITLAB_READS,
    never: ["Source code or files — only project settings, merge-request metadata and approvals.", "Write anything: read_api can't."],
    settings: [{ key: "windowDays", label: "Merged changes reviewed over the last", help: "The window of merged merge requests checked for an approval.", min: 7, max: 90, unit: "days" }],
  },
  {
    key: "cloudflare",
    checkPrefix: "cloudflare",
    title: "Cloudflare",
    subtitle: "Every site HTTPS-only with TLS 1.2+ and a verified origin, HSTS, DNSSEC — and whether everyone who can change Cloudflare uses 2FA. Read-only.",
    checks: CLOUDFLARE_CHECKS,
    areas: CLOUDFLARE_AREAS,
    connectStory: "Create an API token (My Profile → API Tokens → Custom token) with the read permissions listed below and paste it. It can't change a DNS record or a setting.",
    reads: CLOUDFLARE_READS,
    never: ["DNS records, traffic, logs or certificates' private keys.", "Change anything: every permission is Read."],
  },
  {
    key: "gcp",
    checkPrefix: "gcp",
    title: "Google Cloud",
    subtitle: "Who owns your projects, anything granted to the whole internet, old service-account keys, public buckets, SSH open to the world, and databases without backups — across every project the service account can see. Read-only.",
    checks: GCP_CHECKS,
    areas: GCP_AREAS,
    connectStory: "Create a service account with the Viewer and Security Reviewer roles (on the project, or the organisation to cover every project) and paste its JSON key. Both roles are read-only; delete the key any time to cut access.",
    reads: GCP_READS,
    never: ["Data inside buckets, databases or VMs — Viewer and Security Reviewer only see configuration.", "Change anything: both roles are read-only."],
    settings: [{ key: "keyMaxDays", label: "Service-account keys rotated within", help: "User-managed keys older than this fail the key-age check.", min: 30, max: 365, unit: "days" }],
  },
  {
    key: "jira",
    checkPrefix: "jira",
    title: "Jira",
    subtitle: "Every merged change traced to its Jira ticket, the incident log kept as evidence, and — if you switch it on — a ticket for any failing check in one click.",
    checks: trackerChecks("jira"),
    areas: TRACKER_AREAS,
    connectStory: "Paste your Jira Cloud address, your email and an API token (id.atlassian.com → Security → API tokens). ShieldFlow reads issues by key and searches for incidents; it creates issues only if you turn ticket creation on and pick a project.",
    reads: [
      ["Issues (read)", "the title, status and link of each ticket a merged change names"],
      ["Search (read)", "issues typed Incident or labelled incident / security-incident in the last 12 months"],
      ["Issues (create — only if you turn it on)", "a ticket for a failing check, in the project you choose"],
    ],
    never: ["Issue comments, attachments or anything outside the fields above.", "Create or change anything unless you switch ticket creation on — and even then only new issues, never edits."],
  },
  {
    key: "linear",
    checkPrefix: "linear",
    title: "Linear",
    subtitle: "Every merged change traced to its Linear issue, the incident log kept as evidence, and — if you switch it on — an issue for any failing check in one click.",
    checks: trackerChecks("linear"),
    areas: TRACKER_AREAS,
    connectStory: "Paste a personal API key (Linear → Settings → Security & access → Personal API keys). ShieldFlow reads issues by identifier and searches for incidents; it creates issues only if you turn ticket creation on and pick a team.",
    reads: [
      ["Issues (read)", "the title, status and link of each issue a merged change names"],
      ["Issues by label (read)", "issues labelled incident / security incident in the last 12 months"],
      ["Issue create (only if you turn it on)", "an issue for a failing check, in the team you choose"],
    ],
    never: ["Comments, attachments, projects or cycles.", "Create or change anything unless you switch issue creation on — and even then only new issues, never edits."],
  },
];

export const PROVIDER_BY_KEY = new Map(PROVIDERS.map((p) => [p.key, p]));
