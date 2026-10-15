/**
 * Seed the test workspace (RECORDING_EMAIL's company) with realistic scans for
 * every deep integration, so each /integrations/<provider> page can be tested
 * with data — then remove every trace again.
 *
 *   npx tsx scripts/e2e/seed-integrations.ts          seed (and dry-run the check engine on each)
 *   npx tsx scripts/e2e/seed-integrations.ts --clean  remove everything seeded or created since
 *
 * Postures are sample data run through the real evaluators. Rows are marked
 * metadata.seed = true; the stored credential is not a real one, so "Scan now"
 * on a seeded page fails cleanly (which is also worth testing). Checks are NOT
 * recorded, so no measure gets completed by sample data.
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

loadEnvConfig(process.cwd());

const STAMP = path.join(tmpdir(), "shieldflow-seed-started-at");
const SEEDED = ["github", "google_workspace", "microsoft", "okta", "gitlab", "cloudflare", "gcp", "personio", "kandji", "jira"] as const;
const CHECK_PREFIXES = ["github", "google", "microsoft", "okta", "gitlab", "cloudflare", "gcp", "personio", "kandji", "jira"];
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

(async () => {
  const { createAdminSupabase } = await import("@/lib/supabase/admin");
  const db = createAdminSupabase();
  const email = process.env.RECORDING_EMAIL!;
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const user = users.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error("test account not found");
  const { data: member } = await db.from("company_members").select("company_id").eq("user_id", user.id).limit(1).maybeSingle();
  const companyId = member!.company_id as string;

  if (process.argv.includes("--clean")) {
    const since = existsSync(STAMP) ? readFileSync(STAMP, "utf8").trim() : ago(1);
    const del = async (table: string, q: (b: ReturnType<typeof db.from>) => unknown) => {
      const r = (await q(db.from(table))) as { error: { message: string } | null; count?: number | null };
      console.log(`  ${table}: ${r.error ? `error ${r.error.message}` : "cleaned"}`);
    };
    await del("integrations", (t) => t.delete().eq("company_id", companyId).in("provider", [...SEEDED]).contains("metadata", { seed: true }));
    await del("code_changes", (t) => t.delete().eq("company_id", companyId).like("repo", "northwind-seed/%"));
    await del("incident_records", (t) => t.delete().eq("company_id", companyId).like("key", "SEED-%"));
    await del("check_exceptions", (t) => t.delete().eq("company_id", companyId).gte("created_at", since).or(CHECK_PREFIXES.map((p) => `check_key.like.${p}.%`).join(",")));
    await del("identity_links", (t) => t.delete().eq("company_id", companyId).gte("created_at", since));
    await del("identity_exceptions", (t) => t.delete().eq("company_id", companyId).gte("created_at", since));
    await del("vendors", (t) => t.delete().eq("company_id", companyId).gte("created_at", since).like("notes", "Found by ShieldFlow%"));
    await del("control_checks", (t) => t.delete().eq("company_id", companyId).in("provider", CHECK_PREFIXES));
    await del("integration_findings", (t) => t.delete().eq("company_id", companyId).in("provider", CHECK_PREFIXES));
    await del("audit_events", (t) =>
      t
        .delete()
        .eq("company_id", companyId)
        .gte("created_at", since)
        .in("action", ["check.exception_added", "check.exception_removed", "identity_link.created", "identity_link.removed", "identity_exception.created", "identity_exception.removed", "vendor.created", "ticketing.enabled", "ticketing.disabled", "ticket.created"]),
    );
    console.log("clean done");
    return;
  }

  writeFileSync(STAMP, new Date().toISOString());
  const { encryptSecret } = await import("@/lib/crypto");
  const { ok } = await import("@/lib/checks-core");
  const { rawChecksFor } = await import("@/lib/checks");
  const { data: people } = await db.from("personnel").select("name, email, status").eq("company_id", companyId).order("name");
  const staff = ((people ?? []) as { name: string; email: string | null; status: string }[]).filter((p) => p.email);
  const active = staff.filter((p) => p.status !== "offboarded");
  const leaver = staff.find((p) => p.status === "offboarded");
  const local = (e: string) => e.split("@")[0];
  const domain = active[0]?.email?.split("@")[1] ?? "northwind.test";

  async function save(provider: (typeof SEEDED)[number], scan: { provider: string; results: unknown[]; roster: unknown; extra: unknown; scannedAt: string; durationMs: number }, metadata: Record<string, unknown>) {
    const row = {
      company_id: companyId,
      provider,
      access_token: encryptSecret("seed-not-a-real-credential"),
      status: "connected",
      connected_by: user!.id,
      metadata: { seed: true, ...metadata },
      last_scan: scan,
      last_synced_at: new Date().toISOString(),
    };
    const { error } = await db.from("integrations").upsert(row, { onConflict: "company_id,provider" });
    const raw = await rawChecksFor(provider === "google_workspace" ? "google" : provider, scan, db, companyId);
    const tally = { pass: 0, fail: 0, inconclusive: 0 } as Record<string, number>;
    for (const r of raw ?? []) tally[r.result]++;
    console.log(`${provider.padEnd(17)} ${error ? `ERROR ${error.message}` : "seeded"}  engine: ${raw?.length ?? 0} checks (${tally.fail} fail, ${tally.pass} pass, ${tally.inconclusive} can't tell)`);
  }

  // ---------------------------------------------------------------- GitHub
  {
    const { evaluateGitHub } = await import("@/lib/integrations/github/evaluate");
    const prot = { prRequired: true, approvals: 1, dismissStale: true, forcePushBlocked: true, enforceAdmins: true, source: "ruleset" as const };
    const repo = (name: string, over: Record<string, unknown> = {}) => ({ fullName: `northwind-seed/${name}`, private: true, archived: false, fork: false, defaultBranch: "main", pushedAt: ago(1), topics: [], protection: prot, dependabot: true, writeDeployKeys: [], ...over });
    const members = active.slice(0, 6).map((p, i) => ({ login: i === 3 ? `${local(p.email!)}-dev` : local(p.email!).replace(/\./g, ""), name: p.name as string | null, email: null, role: (i < 2 ? "owner" : "member") as "owner" | "member", twoFactor: i !== 4 }));
    members.push({ login: "contractor-x", name: null, email: null, role: "member", twoFactor: true });
    if (leaver) members.push({ login: local(leaver.email!).replace(/\./g, ""), name: leaver.name, email: null, role: "member", twoFactor: true });
    const pr = (n: number, approved: boolean, ticket: string | null, d: number) => ({
      repo: "northwind-seed/api", number: n, title: `${ticket ? `${ticket} ` : ""}change ${n}`, url: `https://github.com/northwind-seed/api/pull/${n}`,
      author: members[2].login, mergedBy: approved ? members[0].login : members[2].login, mergedAt: ago(d), approvers: approved ? [members[0].login] : [], independentApproval: approved, ticket,
    });
    const pulls = [pr(101, true, "SEED-1", 2), pr(102, true, "SEED-2", 5), pr(103, false, null, 6), pr(104, true, "SEED-99", 9), pr(105, true, "SEED-3", 12)];
    const posture = {
      owners: [{ login: "northwind-seed", type: "Organization" as const }], scannedAt: new Date().toISOString(), durationMs: 4200,
      repos: ok([repo("api"), repo("web", { protection: { ...prot, prRequired: false, approvals: 0, source: "none" as const } }), repo("site", { private: false }), repo("legacy", { archived: true, protection: null }), repo("infra", { dependabot: false })]),
      reposTruncated: false, reposUnread: [],
      orgs: [{ login: "northwind-seed", twoFactorRequired: ok(false), without2fa: ok([members[4].login]), members: ok(members) }],
      pulls: ok(pulls), pullsUnread: [],
      dependabot: ok([{ id: "northwind-seed/api#11", repo: "northwind-seed/api", severity: "critical" as const, title: "lodash: prototype pollution", createdAt: ago(16), url: "https://github.com" }, { id: "northwind-seed/web#4", repo: "northwind-seed/web", severity: "high" as const, title: "next: SSRF in image optimizer", createdAt: ago(3), url: "https://github.com" }]),
      secretScanning: ok([{ id: "northwind-seed/infra#1", repo: "northwind-seed/infra", severity: "critical" as const, title: "AWS access key exposed", createdAt: ago(2), url: "https://github.com" }]),
      codeScanning: null,
    };
    const results = evaluateGitHub(posture, { now: new Date(), exceptions: [], criticalDays: 7, highDays: 30, windowDays: 30 });
    const { matchAddresses, toIdentityAccount } = await import("@/lib/integrations/people-match");
    const memberViews = members.map((m) => ({ ...m, org: "northwind-seed", person: matchAddresses({ names: [m.name], handles: [m.login] }, staff)[0] ?? null }));
    await db.from("code_changes").upsert(
      pulls.map((p) => ({ company_id: companyId, provider: "github", repo: p.repo, number: p.number, title: p.title, url: p.url, author: p.author, merged_by: p.mergedBy, merged_at: p.mergedAt, approvers: p.approvers, independent_approval: p.independentApproval, ticket: p.ticket })),
      { onConflict: "company_id,provider,repo,number" },
    );
    await save(
      "github",
      {
        provider: "github", scannedAt: posture.scannedAt, durationMs: posture.durationMs, results,
        roster: { all: memberViews.map((m) => toIdentityAccount(`github:${m.login}`, true, m.person ? [m.person] : [])), humans: memberViews.map((m) => toIdentityAccount(`github:${m.login}`, true, m.person ? [m.person] : [])), truncated: false, blindSpot: null },
        extra: { connection: "app", owners: posture.owners, personal: false, repos: posture.repos.ok ? posture.repos.data : [], reposTruncated: false, reposUnread: [], pulls, members: memberViews, alerts: { dependabot: posture.dependabot.ok ? posture.dependabot.data : [], secret: posture.secretScanning.ok ? posture.secretScanning.data : [], code: null }, settings: { criticalDays: 7, highDays: 30, windowDays: 30 } },
      },
      { login: "northwind-seed", connection: "app" },
    );
  }

  // ------------------------------------------------------- Google Workspace
  {
    const { evaluateGoogle, isLive } = await import("@/lib/integrations/google/evaluate");
    const users = active.map((p, i) => ({
      email: p.email!.toLowerCase(), aliases: [], name: p.name, enrolled2sv: i !== 5, enforced2sv: i < 6, superAdmin: i < 2, delegatedAdmin: i === 2,
      suspended: false, archived: false, lastLogin: i === 7 ? ago(140) : ago(1), created: ago(400), orgUnit: i < 6 ? "/" : "/Sales",
    }));
    if (leaver) users.push({ email: leaver.email!.toLowerCase(), aliases: [], name: leaver.name, enrolled2sv: true, enforced2sv: true, superAdmin: false, delegatedAdmin: false, suspended: false, archived: false, lastLogin: ago(30), created: ago(500), orgUnit: "/" });
    users.push({ email: `shared-inbox@${domain}`, aliases: [], name: "Shared inbox", enrolled2sv: false, enforced2sv: false, superAdmin: false, delegatedAdmin: false, suspended: false, archived: false, lastLogin: ago(3), created: ago(600), orgUnit: "/" });
    const apps = [
      { clientId: "mailmerge.apps", name: "MailMerge Pro", scopes: ["https://mail.google.com/"], users: [users[3].email, users[4].email], lastAuthorized: ago(20) },
      { clientId: "hubspot.apps", name: "HubSpot", scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar"], users: [users[1].email], lastAuthorized: ago(60) },
      { clientId: "calendly.apps", name: "Calendly", scopes: ["https://www.googleapis.com/auth/calendar"], users: users.slice(0, 5).map((u) => u.email), lastAuthorized: ago(10) },
    ];
    const posture = { domain, scannedAt: new Date().toISOString(), durationMs: 1800, users: ok(users), truncated: false, apps: ok(apps), appsWindowDays: 180 };
    const results = evaluateGoogle(posture, { now: new Date(), exceptions: [], dormantDays: 90 });
    const { toIdentityAccount } = await import("@/lib/integrations/people-match");
    await save(
      "google_workspace",
      { provider: "google", scannedAt: posture.scannedAt, durationMs: posture.durationMs, results, roster: { all: users.map((u) => toIdentityAccount(u.email, isLive(u), [u.email])), humans: users.map((u) => toIdentityAccount(u.email, isLive(u), [u.email])), truncated: false, blindSpot: null }, extra: { domain, users, truncated: false, apps, appsError: null, appsWindowDays: 180, settings: { dormantDays: 90 } } },
      { scopes: ["https://www.googleapis.com/auth/admin.directory.user.readonly", "https://www.googleapis.com/auth/admin.reports.audit.readonly"] },
    );
  }

  // ------------------------------------------------------------- Microsoft
  {
    const { evaluateMicrosoft } = await import("@/lib/integrations/microsoft/evaluate");
    const users = active.slice(0, 8).map((p, i) => ({ id: p.email!, upn: p.email!.toLowerCase(), mail: p.email!.toLowerCase(), name: p.name, enabled: true, guest: false, created: ago(300 + i) }));
    users.push({ id: "guest", upn: `jo_partner.com#ext#@${domain}`, mail: "jo@partner.com", name: "Jo (Partner)", enabled: true, guest: true, created: ago(40) });
    const devices = active.slice(0, 7).map((p, i) => ({ id: `dev-${i}`, name: `${p.name.split(" ")[0]}-MacBook`, os: "macOS", osVersion: "15.1", encrypted: i !== 2, lastSeen: i === 4 ? ago(40) : ago(1), owner: p.email!.toLowerCase(), ownerName: p.name, corporate: true }));
    const posture = {
      tenant: `${domain}`, scannedAt: new Date().toISOString(), durationMs: 2600,
      users: ok(users), usersTruncated: false,
      registration: ok(users.filter((u) => !u.guest).map((u, i) => ({ upn: u.upn, mfaRegistered: i !== 3, methods: ["microsoftAuthenticatorPush"] }))),
      securityDefaults: ok(false),
      conditionalAccess: ok([{ name: "Require MFA for admins", state: "enabled" as const, mfaForAll: false, excludedUsers: 0 }]),
      roles: ok([{ role: "Global Administrator", global: true, member: users[0].upn, kind: "user" as const }, { role: "User Administrator", global: false, member: users[3].upn, kind: "user" as const }]),
      consents: ok([{ app: "MailSync", clientId: "c1", tenantWide: true, scopes: ["Mail.Read", "offline_access"], microsoft: false }]),
      devices: ok(devices), devicesTruncated: false,
    };
    const results = evaluateMicrosoft(posture, { now: new Date(), exceptions: [], staleDays: 14, people: staff.map((p) => ({ name: p.name, email: p.email!, status: p.status })) });
    const { toIdentityAccount } = await import("@/lib/integrations/people-match");
    await save(
      "microsoft",
      {
        provider: "microsoft", scannedAt: posture.scannedAt, durationMs: posture.durationMs, results,
        roster: { all: users.map((u) => toIdentityAccount(u.mail ?? u.upn, u.enabled, [u.mail ?? u.upn])), humans: users.filter((u) => !u.guest).map((u) => toIdentityAccount(u.mail ?? u.upn, u.enabled, [u.mail ?? u.upn])), truncated: false, blindSpot: null },
        extra: { tenant: posture.tenant, users: users.map((u, i) => ({ ...u, mfa: u.guest ? null : i !== 3, roles: i === 0 ? ["Global Administrator"] : i === 3 ? ["User Administrator"] : [] })), truncated: false, securityDefaults: false, enforcing: null, consents: posture.consents.ok ? posture.consents.data : [], admins: posture.roles.ok ? posture.roles.data : [], devices, unread: [], settings: { staleDays: 14 } },
      },
      { org: "Northwind (seed)", tenant_id: domain },
    );
  }

  // ------------------------------------------------------------------ Okta
  {
    const { evaluateOkta, canSignIn } = await import("@/lib/integrations/okta/evaluate");
    const users = active.slice(0, 9).map((p, i) => ({ id: `u${i}`, email: p.email!.toLowerCase(), name: p.name, status: "ACTIVE", lastLogin: i === 6 ? ago(120) : ago(1), created: ago(400), factors: i === 2 ? [] : i === 3 ? ["sms"] : ["push"], roles: i === 0 ? ["SUPER_ADMIN"] : [] as string[] }));
    if (leaver) users.push({ id: "uL", email: leaver.email!.toLowerCase(), name: leaver.name, status: "ACTIVE", lastLogin: ago(20), created: ago(500), factors: ["push"], roles: [] });
    const posture = { host: "northwind-seed.okta.com", scannedAt: new Date().toISOString(), durationMs: 3100, users: ok(users), usersTruncated: false, factorsIncomplete: false, admins: ok([{ userId: "u0", roles: ["SUPER_ADMIN"] }]), passwordMinLength: ok(12), apps: { total: 6, federated: 5, passwordVaulted: 1, passwordVaultedNames: ["Legacy CRM"], truncated: false } };
    const results = evaluateOkta(posture, { now: new Date(), exceptions: [], dormantDays: 90 });
    const { toIdentityAccount } = await import("@/lib/integrations/people-match");
    await save(
      "okta",
      { provider: "okta", scannedAt: posture.scannedAt, durationMs: posture.durationMs, results, roster: { all: users.map((u) => toIdentityAccount(u.email, canSignIn(u), [u.email])), humans: users.map((u) => toIdentityAccount(u.email, true, [u.email])), truncated: false, blindSpot: null }, extra: { host: posture.host, users, truncated: false, factorsIncomplete: false, passwordMinLength: 12, apps: posture.apps, unread: [], settings: { dormantDays: 90 } } },
      { org: "Northwind (seed)", host: "northwind-seed.okta.com" },
    );
  }

  // ---------------------------------------------------------------- GitLab
  {
    const { evaluateGitLab } = await import("@/lib/integrations/gitlab/evaluate");
    const proj = (path: string, over: Record<string, unknown> = {}) => ({ id: 1, path, visibility: "private", archived: false, defaultBranch: "main", topics: [], protection: { pushRestricted: true, forcePushAllowed: false }, approvalsRequired: 1, authorCanApprove: false, writeDeployKeys: [], ...over });
    const merges = [
      { repo: "northwind-seed/data-pipeline", number: 41, title: "SEED-4 add retention job", url: "https://gitlab.com", author: "amara", mergedBy: "amara", mergedAt: ago(3), approvers: ["sam"], independentApproval: true, ticket: "SEED-4" },
      { repo: "northwind-seed/data-pipeline", number: 42, title: "hotfix: timezone", url: "https://gitlab.com", author: "dani", mergedBy: "dani", mergedAt: ago(4), approvers: [], independentApproval: false, ticket: null },
    ];
    const posture = { base: "https://gitlab.com", login: "northwind-bot", scannedAt: new Date().toISOString(), durationMs: 2000, projects: ok([proj("northwind-seed/data-pipeline", { approvalsRequired: 0 }), proj("northwind-seed/docs", { visibility: "public" })]), projectsTruncated: false, projectsUnread: [], merges, mergesUnread: [], groups: ok([{ path: "northwind-seed", require2fa: false }]) };
    const results = evaluateGitLab(posture, { now: new Date(), exceptions: [], windowDays: 30 });
    await db.from("code_changes").upsert(
      merges.map((m) => ({ company_id: companyId, provider: "gitlab", repo: m.repo, number: m.number, title: m.title, url: m.url, author: m.author, merged_by: m.mergedBy, merged_at: m.mergedAt, approvers: m.approvers, independent_approval: m.independentApproval, ticket: m.ticket })),
      { onConflict: "company_id,provider,repo,number" },
    );
    await save("gitlab", { provider: "gitlab", scannedAt: posture.scannedAt, durationMs: posture.durationMs, results, roster: null, extra: { base: posture.base, login: posture.login, projects: posture.projects.ok ? posture.projects.data : [], projectsTruncated: false, merges, groups: [{ path: "northwind-seed", require2fa: false }], settings: { windowDays: 30 } } }, { username: "northwind-bot", login: "northwind-bot", base: "https://gitlab.com" });
  }

  // ------------------------------------------------------------ Cloudflare
  {
    const { evaluateCloudflare } = await import("@/lib/integrations/cloudflare/evaluate");
    const zone = (name: string, over: Record<string, unknown> = {}) => ({ id: name, name, ssl: "strict", minTls: "1.2", alwaysHttps: "on", hsts: true, dnssec: "active" as const, plan: "Pro", ...over });
    const members = active.slice(0, 3).map((p, i) => ({ email: p.email!.toLowerCase(), name: p.name, twoFactor: i !== 1, status: "accepted", roles: [i === 0 ? "Super Administrator" : "Administrator"] }));
    members.push({ email: "dev@agency.example", name: null as unknown as string, twoFactor: false, status: "accepted", roles: ["Administrator"] });
    const posture = { scannedAt: new Date().toISOString(), durationMs: 1500, zones: ok([zone(`${domain}`), zone(`status.${domain}`, { ssl: "full", hsts: false }), zone(`legacy-${domain}`, { dnssec: "disabled" as const })]), zonesTruncated: false, accounts: ok([{ id: "acc1", name: "Northwind", enforceTwoFactor: false, members: ok(members) }]) };
    const results = evaluateCloudflare(posture as never, { now: new Date(), exceptions: [] });
    const { toIdentityAccount } = await import("@/lib/integrations/people-match");
    await save(
      "cloudflare",
      { provider: "cloudflare", scannedAt: posture.scannedAt, durationMs: posture.durationMs, results, roster: { all: members.map((m) => toIdentityAccount(m.email, true, [m.email])), humans: members.map((m) => toIdentityAccount(m.email, true, [m.email])), truncated: false, blindSpot: null }, extra: { zones: posture.zones.ok ? posture.zones.data : [], zonesTruncated: false, accounts: [{ id: "acc1", name: "Northwind", enforceTwoFactor: false, members }], unread: [] } },
      {},
    );
  }

  // ------------------------------------------------------------ Google Cloud
  {
    const { evaluateGcp } = await import("@/lib/integrations/gcp/evaluate");
    const project = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      iam: ok([{ role: "roles/owner", members: [`user:${active[0].email}`, `user:${active[1].email}`] }, { role: "roles/editor", members: ["serviceAccount:ci@" + id + ".iam.gserviceaccount.com", "user:sam.dev@gmail.com"] }]),
      keys: ok([{ serviceAccount: `ci@${id}.iam.gserviceaccount.com`, keyId: "a1b2c3d4e5f6", created: ago(200) }]),
      buckets: ok([{ name: `${id}-uploads`, publicRoles: [], publicAccessPrevention: true }, { name: `${id}-www`, publicRoles: ["roles/storage.objectViewer"], publicAccessPrevention: false }]),
      firewalls: ok([{ name: "default-allow-ssh", network: "default", openAdminPorts: ["22"] }]),
      sql: ok([{ name: "prod-db", publicIp: true, openToWorld: false, sslRequired: true, backups: true }, { name: "analytics-db", publicIp: false, openToWorld: false, sslRequired: false, backups: false }]),
      ...over,
    });
    const posture = { scannedAt: new Date().toISOString(), durationMs: 5200, projects: [project("northwind-seed-prod"), project("northwind-seed-staging", { sql: ok([]) })], projectsTruncated: false, serviceAccount: "shieldflow@northwind-seed-prod.iam.gserviceaccount.com" };
    const results = evaluateGcp(posture as never, { now: new Date(), exceptions: [], keyMaxDays: 90 });
    await save(
      "gcp",
      { provider: "gcp", scannedAt: posture.scannedAt, durationMs: posture.durationMs, results, roster: null, extra: { serviceAccount: posture.serviceAccount, projects: posture.projects.map((p) => ({ id: p.id, owners: [`user:${active[0].email}`, `user:${active[1].email}`], keys: (p.keys as { data: unknown }).data, buckets: (p.buckets as { data: unknown }).data, firewalls: (p.firewalls as { data: unknown }).data, sql: (p.sql as { data: unknown }).data })), projectsTruncated: false, unread: [], settings: { keyMaxDays: 90 } } },
      { project: "northwind-seed-prod" },
    );
  }

  // ---------------------------------------------------------------- Personio
  {
    const { evaluateHris } = await import("@/lib/integrations/hris/evaluate");
    const { hrState } = await import("@/lib/integrations/hris/clients");
    const today = new Date().toISOString().slice(0, 10);
    const employees = active.map((p, i) => ({ externalId: `p${i}`, name: p.name, email: i === 9 ? null : p.email!.toLowerCase(), title: "Engineer", startDate: i === 1 ? ago(60).slice(0, 10) : "2024-02-01", endDate: i === 2 ? ago(-20).slice(0, 10) : null, active: true }));
    if (leaver) employees.push({ externalId: "pL", name: leaver.name, email: leaver.email!.toLowerCase(), title: "Designer", startDate: "2023-05-01", endDate: ago(45).slice(0, 10), active: false });
    employees.push({ externalId: "pX", name: "Old Contractor", email: null, title: null as unknown as string, startDate: "2022-01-01", endDate: null, active: false });
    const results = evaluateHris("personio", ok(employees), false, [], { now: new Date(), exceptions: [], training: [], trainingDays: 30 });
    await save(
      "personio",
      { provider: "personio", scannedAt: new Date().toISOString(), durationMs: 900, results, roster: null, extra: { employees: employees.map((e) => ({ ...e, state: hrState(e, today), trained: e.email ? false : null })), truncated: false, missingFields: [], sync: { added: 0, updated: 2, offboarded: leaver ? [leaver.name] : [], errors: 0 }, settings: { trainingDays: 30 } } },
      { org: "Personio · seed" },
    );
  }

  // ------------------------------------------------------------------ Kandji
  {
    const { evaluateDevices } = await import("@/lib/integrations/devices");
    const devices = active.slice(0, 10).map((p, i) => ({ id: `k${i}`, name: `${p.name.split(" ")[0]}'s MacBook Pro`, os: "Mac", osVersion: "15.1", encrypted: i === 6 ? false : i === 8 ? null : true, lastSeen: i === 5 ? ago(30) : ago(1), owner: p.email!.toLowerCase(), ownerName: p.name, corporate: true }));
    if (leaver) devices.push({ id: "kL", name: `${leaver.name.split(" ")[0]}'s MacBook Air`, os: "Mac", osVersion: "14.6", encrypted: true, lastSeen: ago(2), owner: leaver.email!.toLowerCase(), ownerName: leaver.name, corporate: true });
    const results = evaluateDevices("kandji", ok(devices), { now: new Date(), exceptions: [], staleDays: 14, people: staff.map((p) => ({ name: p.name, email: p.email!, status: p.status })) });
    await save("kandji", { provider: "kandji", scannedAt: new Date().toISOString(), durationMs: 2500, results, roster: null, extra: { devices, truncated: false, detailsSkipped: 0, settings: { staleDays: 14 } } }, { org: "Kandji · seed", host: "northwind-seed.api.kandji.io" });
  }

  // -------------------------------------------------------------------- Jira
  {
    const { evaluateTracker } = await import("@/lib/integrations/tickets/scan");
    const checkedAt = new Date().toISOString();
    for (const [key, title, status] of [["SEED-1", "Login rate limiting", "Done"], ["SEED-2", "Export audit CSV", "Done"], ["SEED-3", "Retention policy job", "In Progress"]]) {
      await db.from("code_changes").update({ ticket_title: title, ticket_status: status, ticket_url: `https://northwind-seed.atlassian.net/browse/${key}`, ticket_checked_at: checkedAt }).eq("company_id", companyId).eq("ticket", key);
    }
    await db.from("code_changes").update({ ticket_checked_at: checkedAt }).eq("company_id", companyId).eq("ticket", "SEED-99");
    await db.from("incident_records").upsert(
      [
        { company_id: companyId, provider: "jira", key: "SEED-50", title: "Phishing email reported by finance", status: "Done", url: "https://northwind-seed.atlassian.net/browse/SEED-50", created_at_source: ago(80), resolved_at: ago(79) },
        { company_id: companyId, provider: "jira", key: "SEED-61", title: "API latency incident (sev2)", status: "In Review", url: "https://northwind-seed.atlassian.net/browse/SEED-61", created_at_source: ago(9), resolved_at: null },
      ],
      { onConflict: "company_id,provider,key" },
    );
    const { data: changes } = await db.from("code_changes").select("provider, repo, number, title, ticket, merged_at, ticket_checked_at, ticket_title").eq("company_id", companyId).like("repo", "northwind-seed/%");
    const rows = (changes ?? []) as Parameters<typeof evaluateTracker>[1];
    const results = evaluateTracker("jira", rows, [], new Date());
    const unlinked = rows.filter((c) => !c.ticket || (c.ticket_checked_at && !c.ticket_title)).map((c) => ({ repo: c.repo, number: c.number, title: c.title, ticket: c.ticket, provider: c.provider }));
    await save(
      "jira",
      { provider: "jira", scannedAt: new Date().toISOString(), durationMs: 1300, results, roster: null, extra: { checked: 4, found: 3, missing: ["SEED-99"], incidents: [], unlinked } },
      { site: "northwind-seed.atlassian.net", account: "Northwind bot" },
    );
  }

  console.log(`\nSeeded. Clean up with:  npx tsx scripts/e2e/seed-integrations.ts --clean`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
