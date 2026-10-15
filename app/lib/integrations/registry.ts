import type { CheckDef } from "@/lib/checks-core";
import { GITHUB_AREAS, GITHUB_CHECKS, GITHUB_APP_PERMISSIONS } from "@/lib/integrations/github/catalog";
import { GOOGLE_AREAS, GOOGLE_CHECKS, GOOGLE_READS } from "@/lib/integrations/google/catalog";
import { MICROSOFT_AREAS, MICROSOFT_CHECKS, MICROSOFT_READS } from "@/lib/integrations/microsoft/catalog";
import { HRIS_AREAS, HRIS_META } from "@/lib/integrations/hris/catalog";
import type { HrisProvider } from "@/lib/integrations/hris/clients";

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
];

export const PROVIDER_BY_KEY = new Map(PROVIDERS.map((p) => [p.key, p]));
