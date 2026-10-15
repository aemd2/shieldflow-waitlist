import type { CheckDef } from "@/lib/checks-core";
import { GITHUB_AREAS, GITHUB_CHECKS, GITHUB_APP_PERMISSIONS } from "@/lib/integrations/github/catalog";

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
];

export const PROVIDER_BY_KEY = new Map(PROVIDERS.map((p) => [p.key, p]));
