import type { CheckDef } from "@/lib/checks-core";

export type CloudflareArea = "edge" | "dns" | "people";

export const CLOUDFLARE_AREAS: { area: CloudflareArea; title: string }[] = [
  { area: "edge", title: "Encryption in transit" },
  { area: "dns", title: "DNS" },
  { area: "people", title: "Who can change it" },
];

const TLS = ["CC6.7", "A.8.24", "164.312(e)(1)", "Req 4", "Art. 32"];
const MFA = ["CC6.1", "A.8.5", "164.312(d)", "Req 8", "Art. 32"];
const ACCESS = ["CC6.2", "CC6.3", "A.5.16", "A.5.18"];

export const CLOUDFLARE_CHECKS: CheckDef<CloudflareArea>[] = [
  {
    key: "cloudflare.tls",
    title: "Every site is HTTPS-only with TLS 1.2+ and a verified origin",
    area: "edge",
    severity: "high",
    why: "SSL 'Full (strict)' means Cloudflare verifies your server's certificate — 'Flexible' and 'Full' leave the last hop open to interception. Old TLS versions and plain HTTP are what auditors and pen-testers flag first.",
    controlCodes: TLS,
    apiCalls: ["GET /zones", "GET /zones/{id}/settings (ssl, min_tls_version, always_use_https)"],
    fix: {
      terraform: `resource "cloudflare_zone_settings_override" "{id}" {
  zone_id = "<ZONE_ID>"
  settings {
    ssl              = "strict"
    min_tls_version  = "1.2"
    always_use_https = "on"
  }
}`,
      console: "Cloudflare → {id} → SSL/TLS → Overview → Full (strict); Edge Certificates → Always Use HTTPS on, Minimum TLS Version 1.2.",
    },
  },
  {
    key: "cloudflare.hsts",
    title: "Browsers are told to always use HTTPS (HSTS)",
    area: "edge",
    severity: "medium",
    why: "Without HSTS the first visit can still be downgraded to plain HTTP on a hostile network. It's a standard pen-test and questionnaire item.",
    controlCodes: TLS,
    apiCalls: ["GET /zones/{id}/settings (security_header)"],
    fix: { console: "Cloudflare → {id} → SSL/TLS → Edge Certificates → HTTP Strict Transport Security → Enable (max-age 6 months, include subdomains once every subdomain serves HTTPS)." },
  },
  {
    key: "cloudflare.dnssec",
    title: "DNSSEC is on",
    area: "dns",
    severity: "low",
    why: "DNSSEC stops someone answering for your domain with forged records — routing your users and your email somewhere else.",
    controlCodes: [],
    apiCalls: ["GET /zones/{id}/dnssec"],
    fix: { console: "Cloudflare → {id} → DNS → Settings → Enable DNSSEC, then add the DS record at your registrar (automatic if Cloudflare is the registrar)." },
  },
  {
    key: "cloudflare.members_2fa",
    title: "Everyone who can change Cloudflare uses 2FA",
    area: "people",
    severity: "high",
    why: "Whoever controls Cloudflare controls where your domain points and can read your traffic. One phished password is enough without a second factor.",
    controlCodes: MFA,
    apiCalls: ["GET /accounts (settings.enforce_twofactor)", "GET /accounts/{id}/members"],
    fix: { console: "Cloudflare → Manage Account → Members → Enforce two-factor authentication on, and ask each listed member to set it up (My Profile → Authentication)." },
  },
  {
    key: "cloudflare.offboarding_drift",
    title: "Leavers are out of Cloudflare",
    area: "people",
    severity: "high",
    why: "A leaver who's still a member can still repoint your domain.",
    controlCodes: ACCESS,
    apiCalls: ["GET /accounts/{id}/members"],
    fix: { console: "Cloudflare → Manage Account → Members → the person → Remove." },
  },
  {
    key: "cloudflare.untracked_accounts",
    title: "Every member is someone you know",
    area: "people",
    severity: "medium",
    why: "A member nobody can name is a leaver nobody recorded or an agency nobody tracked.",
    controlCodes: ACCESS,
    apiCalls: ["GET /accounts/{id}/members"],
    fix: { console: "Add the person in Personnel, or mark the account as not a person if it's a shared login." },
  },
];

export const CLOUDFLARE_READS = [
  ["Zone: Read", "your sites"],
  ["Zone Settings: Read", "SSL mode, minimum TLS, Always Use HTTPS, HSTS"],
  ["DNS: Read", "whether DNSSEC is on (no DNS records are stored)"],
  ["Account Settings: Read", "members, their roles and 2FA (optional)"],
] as const;
