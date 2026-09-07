import type { SupabaseClient } from "@supabase/supabase-js";
import { autoCompleteMeasuresFromChecks } from "@/lib/measures";
import { listSelectedFrameworkIds } from "@/lib/db/queries";
import {
  evaluateOffboardingDrift,
  evaluateUntrackedAccounts,
  type IdentityAccount,
  type PersonRecord,
} from "@/lib/identity-checks";

// Continuous control checks: turn the security posture each integration already
// computes (root MFA, branch protection, 2FA %, TLS…) into pass/fail results
// mapped to real controls. The hard part (talking to the provider APIs) lives in
// the sync actions; this module only interprets their posture and persists the
// verdicts via the record_control_checks RPC (the sole, tamper-safe writer).

export type CheckResultValue = "pass" | "fail" | "inconclusive";

export interface RawCheck {
  checkKey: string;
  controlCodes: string[];
  result: CheckResultValue;
  detail: string;
  /**
   * The specific things a failing check is about (e.g. the unmatched account
   * addresses). Stored on the finding so the UI can offer an action per subject
   * rather than making the user retype one out of a sentence. Never persisted to
   * control_checks — those stay one row per (check x control).
   */
  subjects?: string[];
}

// Control-code sets — the real codes seeded across SOC 2, ISO 27001, HIPAA, GDPR
// and PCI DSS. A code that isn't in the company's selected frameworks is simply
// skipped when results are recorded, so over-mapping here is harmless.
const MFA = ["CC6.1", "A.8.5", "164.312(d)", "164.312(a)(1)", "Req 8", "Art. 32"];
const PASSWORD = ["CC6.1", "A.8.5", "164.312(a)(1)", "Req 8"];
const CHANGE_MGMT = ["CC8.1", "A.8.28", "A.8.9", "Req 6"];
const TLS = ["CC6.6", "A.8.24", "164.312(e)(1)", "Req 4", "Art. 32"];
const LEAST_PRIV = ["CC6.1", "CC6.3", "A.5.15", "164.308(a)(4)", "Req 7"];
const VISIBILITY = ["CC6.1", "CC6.6", "A.5.15"];

/**
 * Days after someone's leaving date before a still-open account is a finding.
 * Fixed rather than configurable: an account open the day after someone leaves is
 * normal, one open a week later is the thing auditors sample for. Revisit when a
 * customer's own policy actually differs.
 */
export const OFFBOARDING_GRACE_DAYS = 7;

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/**
 * Per-provider posture → checks. Each evaluator reads the same posture object the
 * sync action already built. Providers with no security signal (Jira, Linear,
 * Slack) are intentionally absent.
 */
export const EVALUATORS: Record<string, (p: any) => RawCheck[]> = {
  aws(p) {
    const checks: RawCheck[] = [
      {
        checkKey: "aws.root_mfa",
        controlCodes: MFA,
        result: p.rootMfaEnabled ? "pass" : "fail",
        detail: p.rootMfaEnabled
          ? "Root account MFA is enabled."
          : "Root account MFA is DISABLED — enable it in the AWS IAM console.",
      },
    ];
    const pp = p.passwordPolicy;
    checks.push({
      checkKey: "aws.password_policy",
      controlCodes: PASSWORD,
      result: pp ? (pp.minimumLength >= 8 ? "pass" : "fail") : "fail",
      detail: pp
        ? `IAM password policy is set (minimum length ${pp.minimumLength}).`
        : "No IAM password policy is set.",
    });
    return checks;
  },

  github(p) {
    const checks: RawCheck[] = [];
    if (p.totalRepos === 0) {
      checks.push({
        checkKey: "github.branch_protection",
        controlCodes: CHANGE_MGMT,
        result: "inconclusive",
        detail: "No repositories found to check.",
      });
    } else if (p.checked === 0) {
      checks.push({
        checkKey: "github.branch_protection",
        controlCodes: CHANGE_MGMT,
        result: "inconclusive",
        detail: "Branch protection couldn't be read (token lacks permission or was rate-limited).",
      });
    } else {
      const unprotected = (p.repos ?? []).filter(
        (r: any) => !r.archived && r.branchProtection === "unprotected",
      ).length;
      checks.push({
        checkKey: "github.branch_protection",
        controlCodes: CHANGE_MGMT,
        result: unprotected === 0 ? "pass" : "fail",
        detail:
          unprotected === 0
            ? `All ${p.checked} checked repositories enforce branch protection.`
            : `${unprotected} active repository(ies) have no branch protection on the default branch.`,
      });
    }
    checks.push({
      checkKey: "github.repo_visibility",
      controlCodes: VISIBILITY,
      result: p.publicCount === 0 ? "pass" : "fail",
      detail:
        p.publicCount === 0
          ? "No public repositories."
          : `${p.publicCount} public repository(ies) — confirm this exposure is intended.`,
    });
    return checks;
  },

  okta(p) {
    const checks: RawCheck[] = [];
    if (p.mfaChecked === 0) {
      checks.push({
        checkKey: "okta.mfa",
        controlCodes: MFA,
        result: "inconclusive",
        detail: "No active users were available to check MFA enrollment.",
      });
    } else {
      const ratio = pct(p.mfaEnrolled, p.mfaChecked);
      checks.push({
        checkKey: "okta.mfa",
        controlCodes: MFA,
        result: ratio >= 90 ? "pass" : "fail",
        detail: `${p.mfaEnrolled}/${p.mfaChecked} active users have MFA enrolled (${ratio}%).`,
      });
    }
    const minLen = p.passwordMinLength;
    checks.push({
      checkKey: "okta.password_policy",
      controlCodes: PASSWORD,
      result: typeof minLen === "number" ? (minLen >= 8 ? "pass" : "fail") : "inconclusive",
      detail:
        typeof minLen === "number"
          ? `Password minimum length is ${minLen}.`
          : "Password policy minimum length is unavailable.",
    });
    return checks;
  },

  google(p) {
    if (!p.total) {
      return [
        { checkKey: "google.2fa", controlCodes: MFA, result: "inconclusive", detail: "No users found." },
      ];
    }
    const ratio = pct(p.with2fa, p.total);
    return [
      {
        checkKey: "google.2fa",
        controlCodes: MFA,
        result: ratio >= 90 ? "pass" : "fail",
        detail: `${p.with2fa}/${p.total} users have 2-step verification (${ratio}%).`,
      },
    ];
  },

  gcp(p) {
    return [
      {
        checkKey: "gcp.over_privilege",
        controlCodes: LEAST_PRIV,
        result: p.owners <= 3 ? "pass" : "fail",
        detail:
          p.owners <= 3
            ? `${p.owners} project owner(s) — within least-privilege guidance.`
            : `${p.owners} project owners — review for least privilege (≤3 recommended).`,
      },
    ];
  },

  cloudflare(p) {
    if (!p.zones || p.totalZones === 0) {
      return [
        { checkKey: "cloudflare.tls", controlCodes: TLS, result: "inconclusive", detail: "No zones found." },
      ];
    }
    const weak = p.zones.filter((z: any) => {
      const sslOk = z.ssl === "full" || z.ssl === "strict";
      const tlsOk = parseFloat(z.minTls) >= 1.2;
      const httpsOk = z.alwaysHttps === "on";
      return !(sslOk && tlsOk && httpsOk);
    });
    return [
      {
        checkKey: "cloudflare.tls",
        controlCodes: TLS,
        result: weak.length === 0 ? "pass" : "fail",
        detail:
          weak.length === 0
            ? `All ${p.totalZones} zones enforce strong TLS (full/strict SSL, min TLS ≥ 1.2, always-HTTPS).`
            : `${weak.length} zone(s) have weak TLS settings (SSL mode, minimum TLS, or always-HTTPS).`,
      },
    ];
  },

  gitlab(p) {
    const checks: RawCheck[] = [];
    if (p.total === 0) {
      checks.push({
        checkKey: "gitlab.branch_protection",
        controlCodes: CHANGE_MGMT,
        result: "inconclusive",
        detail: "No projects found to check.",
      });
    } else {
      const unprotected = (p.repos ?? []).filter(
        (r: any) => r.branchProtection === "unprotected",
      ).length;
      checks.push({
        checkKey: "gitlab.branch_protection",
        controlCodes: CHANGE_MGMT,
        result: unprotected === 0 ? "pass" : "fail",
        detail:
          unprotected === 0
            ? `All ${p.total} projects have protected branches.`
            : `${unprotected} project(s) have no protected branches.`,
      });
    }
    checks.push({
      checkKey: "gitlab.visibility",
      controlCodes: VISIBILITY,
      result: p.publicCount === 0 ? "pass" : "fail",
      detail:
        p.publicCount === 0
          ? "No public projects."
          : `${p.publicCount} public project(s) — confirm this exposure is intended.`,
    });
    return checks;
  },
};

/**
 * Human-readable names for the `provider` column on a check. This is a different
 * namespace from INTEGRATION_LABELS in lib/integration-evidence.ts: that one keys
 * off the `integrations` row ("google_workspace"), this one off whatever the check
 * was written under ("google"), and it also has to name the internal provider.
 */
export const CHECK_PROVIDER_LABELS: Record<string, string> = {
  aws: "AWS",
  github: "GitHub",
  okta: "Okta",
  google: "Google Workspace",
  gcp: "Google Cloud",
  cloudflare: "Cloudflare",
  gitlab: "GitLab",
  microsoft: "Microsoft 365",
  shieldflow: "ShieldFlow",
};

/**
 * Checks derived from ShieldFlow's own data rather than a provider API. They live
 * under their own provider string so the delete-then-insert contract keeps them in
 * a separate bucket from any integration.
 */
export const INTERNAL_PROVIDER = "shieldflow";

/**
 * The `integrations` row and the `control_checks` row don't always use the same
 * name for the same provider: we connect "google_workspace" but have always
 * written its checks under "google".
 *
 * This is normalised inside the record functions rather than at each call site,
 * because getting it wrong is quiet and nasty. control_checks is UNIQUE on
 * (company_id, control_id, check_key) with no provider column in the key, so
 * writing the same check under a second provider name means the delete-by-
 * provider clears nothing, the insert then collides, and the checks silently
 * stop updating — while clearChecksForProvider("google") on disconnect leaves
 * half the rows behind.
 */
const CHECK_PROVIDER: Record<string, string> = { google_workspace: "google" };

/** The name a provider's checks are stored under. Identity for most providers. */
export function checkProviderFor(provider: string): string {
  return CHECK_PROVIDER[provider] ?? provider;
}

export const ACCESS_REVIEW_CHECK_KEY = "shieldflow.access_review_cadence";

/** SOC 2 CC6.2/CC6.3 don't name a period; quarterly is the near-universal practice. */
export const ACCESS_REVIEW_MAX_AGE_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * Did an access review actually happen inside the cadence?
 *
 * Pure so the three verdicts are readable without a database. The important one is
 * the third: a workspace that has never completed a review is INCONCLUSIVE, never
 * a pass. Vacuously passing a control by having done nothing is the exact failure
 * mode that makes automated compliance untrustworthy.
 */
export function evaluateAccessReviewCadence(
  lastCompletedAt: string | null | undefined,
  now: Date = new Date(),
): { result: CheckResultValue; detail: string } {
  if (!lastCompletedAt) {
    return {
      result: "inconclusive",
      detail:
        "No access review has been completed yet, so the cadence can't be evidenced. " +
        "Run one to prove access is reviewed periodically.",
    };
  }

  const completed = new Date(lastCompletedAt);
  if (Number.isNaN(completed.getTime())) {
    return {
      result: "inconclusive",
      detail: "The most recent access review has no usable completion date.",
    };
  }

  const days = Math.floor((now.getTime() - completed.getTime()) / DAY_MS);
  const on = completed.toISOString().slice(0, 10);

  if (days <= ACCESS_REVIEW_MAX_AGE_DAYS) {
    return {
      result: "pass",
      detail: `Access review completed ${on} (${days} day(s) ago) — within the ${ACCESS_REVIEW_MAX_AGE_DAYS}-day cadence.`,
    };
  }
  return {
    result: "fail",
    detail: `The last access review completed ${on}, ${days} days ago — past the ${ACCESS_REVIEW_MAX_AGE_DAYS}-day cadence. Start a new review.`,
  };
}

interface ResultRow {
  control_id: string;
  check_key: string;
  result: CheckResultValue;
  detail: string;
  evidence_id: string | null;
}

interface FindingRow {
  check_key: string;
  result: CheckResultValue;
  detail: string;
  raw: { control_codes: string[]; subjects?: string[] };
}

/**
 * Checks that need the company's own data as well as the provider's posture —
 * reconciling the identity roster against Personnel. Kept in a separate map so
 * EVALUATORS stays synchronous and free of database access: the moment one
 * evaluator can await, every evaluator becomes hard to reason about.
 */
export const ASYNC_EVALUATORS: Record<
  string,
  (posture: any, db: SupabaseClient, companyId: string) => Promise<RawCheck[]>
> = {
  okta: (posture, db, companyId) =>
    identityChecks(db, companyId, "okta", oktaAccounts(posture), Boolean(posture?.truncated)),
  google: (posture, db, companyId) =>
    identityChecks(db, companyId, "google", googleAccounts(posture), Boolean(posture?.truncated)),
  microsoft: (posture, db, companyId) =>
    identityChecks(db, companyId, "microsoft", microsoftAccounts(posture), Boolean(posture?.truncated)),
};

/**
 * Okta: "still has access" is NOT (DEPROVISIONED || SUSPENDED), deliberately not
 * `=== ACTIVE`. LOCKED_OUT, PASSWORD_EXPIRED and RECOVERY accounts still belong
 * to the person and can be restored, so treating them as closed would let a real
 * finding pass.
 */
function oktaAccounts(posture: any): IdentityAccount[] | null {
  if (!Array.isArray(posture?.roster)) return null;
  return posture.roster
    .filter((u: any) => u?.email)
    .map((u: any) => ({
      email: String(u.email),
      active: u.status !== "DEPROVISIONED" && u.status !== "SUSPENDED",
    }));
}

/**
 * Entra ID: `accountEnabled` is the whole story — a disabled account cannot sign
 * in. Both addresses are carried through because `mail` and the sign-on UPN
 * frequently differ, and Personnel may hold either one.
 */
function microsoftAccounts(posture: any): IdentityAccount[] | null {
  if (!Array.isArray(posture?.roster)) return null;
  return posture.roster
    .filter((u: any) => u?.email)
    .map((u: any) => ({
      email: String(u.email),
      active: u.enabled !== false,
      aliases: Array.isArray(u.aliases) ? u.aliases.map(String) : [],
    }));
}

function googleAccounts(posture: any): IdentityAccount[] | null {
  if (!Array.isArray(posture?.roster)) return null;
  return posture.roster
    .filter((u: any) => u?.primaryEmail)
    .map((u: any) => ({ email: String(u.primaryEmail), active: !u.suspended }));
}

/** One Personnel read, one exceptions read, then two pure evaluations. */
async function identityChecks(
  db: SupabaseClient,
  companyId: string,
  provider: string,
  roster: IdentityAccount[] | null,
  truncated: boolean,
): Promise<RawCheck[]> {
  // Control codes come from the measure crosswalk rather than a hardcoded list,
  // so these checks cover whatever frameworks the measure covers — including any
  // added later — and can never name a code that doesn't exist.
  const [{ data: people }, { data: exceptions }, offCodes, onCodes] = await Promise.all([
    db.from("personnel").select("name, email, status, ended_at").eq("company_id", companyId),
    db.from("identity_exceptions").select("email").eq("company_id", companyId),
    controlCodesForMeasure(db, "offboarding-checklist"),
    controlCodesForMeasure(db, "onboarding-checklist"),
  ]);

  const records = (people ?? []) as PersonRecord[];
  const dismissed = ((exceptions ?? []) as { email: string }[]).map((e) => e.email);

  const drift = evaluateOffboardingDrift({
    roster,
    truncated,
    people: records,
    graceDays: OFFBOARDING_GRACE_DAYS,
  });
  const untracked = evaluateUntrackedAccounts({ roster, truncated, people: records, dismissed });

  return [
    {
      checkKey: `${provider}.offboarding_drift`,
      controlCodes: offCodes,
      result: drift.result,
      detail: drift.detail,
    },
    {
      checkKey: `${provider}.untracked_accounts`,
      controlCodes: onCodes,
      result: untracked.result,
      detail: untracked.detail,
      subjects: untracked.subjects,
    },
  ];
}

/** Evaluate a provider's posture into raw checks (null if the provider has no evaluator). */
async function rawChecksFor(
  provider: string,
  posture: unknown,
  db: SupabaseClient,
  companyId: string,
): Promise<RawCheck[] | null> {
  const sync = EVALUATORS[provider];
  const async_ = ASYNC_EVALUATORS[provider];
  if (!sync && !async_) return null;

  const checks: RawCheck[] = sync ? sync(posture) : [];

  // Isolated on purpose. recordChecksForSyncAdmin has no try/catch of its own, so
  // a throwing async evaluator would abort the cron's handler for this provider
  // before anything was written — losing its passing checks too. A roster read
  // that fails should cost us the roster checks, nothing else.
  if (async_) {
    try {
      checks.push(...(await async_(posture, db, companyId)));
    } catch {
      // Leave the sync checks standing.
    }
  }
  return checks;
}

/** Map every control code in the company's selected frameworks to its control id. */
async function loadCodeToId(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Map<string, string>> {
  const frameworkIds = await listSelectedFrameworkIds(supabase, companyId);
  const codeToId = new Map<string, string>();
  if (frameworkIds.length === 0) return codeToId;
  const { data: controls } = await supabase
    .from("controls")
    .select("id, code")
    .in("framework_id", frameworkIds);
  for (const c of controls ?? []) codeToId.set((c as any).code, (c as any).id);
  return codeToId;
}

/** Fan each raw check out to every selected-framework control it satisfies. */
function buildResults(
  raw: RawCheck[],
  codeToId: Map<string, string>,
  evidenceId: string | null,
): ResultRow[] {
  const results: ResultRow[] = [];
  for (const rc of raw) {
    for (const code of rc.controlCodes) {
      const controlId = codeToId.get(code);
      if (!controlId) continue;
      results.push({
        control_id: controlId,
        check_key: rc.checkKey,
        result: rc.result,
        detail: rc.detail,
        evidence_id: evidenceId,
      });
    }
  }
  return results;
}

function buildFindings(raw: RawCheck[]): FindingRow[] {
  return raw.map((rc) => ({
    check_key: rc.checkKey,
    result: rc.result,
    detail: rc.detail,
    raw: {
      control_codes: rc.controlCodes,
      ...(rc.subjects?.length ? { subjects: rc.subjects } : {}),
    },
  }));
}

async function callRecord(
  supabase: SupabaseClient,
  companyId: string,
  provider: string,
  results: ResultRow[],
): Promise<void> {
  await supabase.rpc("record_control_checks", {
    p_company_id: companyId,
    p_provider: provider,
    p_results: results,
  });
}

/**
 * Persist through the SECURITY DEFINER RPCs. Used whenever there is a user
 * session, because the RPCs gate on the caller's auth.uid() and own the
 * delete-then-insert contract.
 */
async function persistViaRpc(
  supabase: SupabaseClient,
  companyId: string,
  provider: string,
  raw: RawCheck[],
  codeToId: Map<string, string>,
  evidenceId: string | null,
): Promise<void> {
  await callRecord(supabase, companyId, provider, buildResults(raw, codeToId, evidenceId));
  await supabase.rpc("record_integration_findings", {
    p_company_id: companyId,
    p_provider: provider,
    p_findings: buildFindings(raw),
  });
}

/**
 * Persist by direct write. Used by the cron, which holds a service-role client and
 * therefore has no auth.uid() for the RPCs to gate on. Mirrors what the RPCs do,
 * including replacing the provider's rows rather than appending to them.
 */
async function persistAsAdmin(
  admin: SupabaseClient,
  companyId: string,
  provider: string,
  raw: RawCheck[],
  codeToId: Map<string, string>,
  evidenceId: string | null,
): Promise<void> {
  const results = buildResults(raw, codeToId, evidenceId);

  await admin.from("control_checks").delete().eq("company_id", companyId).eq("provider", provider);
  if (results.length > 0) {
    await admin.from("control_checks").insert(
      results.map((r) => ({
        company_id: companyId,
        control_id: r.control_id,
        check_key: r.check_key,
        provider,
        result: r.result,
        detail: r.detail,
        evidence_id: r.evidence_id,
      })),
    );
  }

  await admin.from("integration_findings").delete().eq("company_id", companyId).eq("provider", provider);
  const findings = buildFindings(raw);
  if (findings.length > 0) {
    await admin.from("integration_findings").insert(
      findings.map((f) => ({
        company_id: companyId,
        provider,
        check_key: f.check_key,
        result: f.result,
        detail: f.detail,
        raw: f.raw,
      })),
    );
  }
}

/**
 * Manual-sync path (user session). Evaluate a sync's posture into checks +
 * findings and persist both through the SECURITY DEFINER RPCs (the tamper-safe
 * writers). Best-effort: a failure here never breaks the sync that called it.
 */
export async function recordChecksForSync(
  supabase: SupabaseClient,
  companyId: string,
  rawProvider: string,
  posture: unknown,
  evidenceId: string | null,
): Promise<void> {
  const provider = checkProviderFor(rawProvider);
  try {
    const raw = await rawChecksFor(provider, posture, supabase, companyId);
    if (!raw) return;
    const codeToId = await loadCodeToId(supabase, companyId);
    await persistViaRpc(supabase, companyId, provider, raw, codeToId, evidenceId);
    // A passing check has already proven the work — complete the measure it
    // satisfies rather than leaving it for a human to confirm by hand, and let
    // that fan out to every control the measure covers.
    await autoCompleteMeasuresFromChecks(supabase, companyId, null);
  } catch {
    // Never let check recording break a sync.
  }
}

/**
 * Cron path (service-role admin client, no user session). Writes the same checks
 * + findings directly — the admin client bypasses RLS, and the RPCs can't be used
 * because they gate on the caller's auth.uid(). Returns the raw checks so the
 * caller can diff against the prior results for drift detection. Preserves the
 * evidence_id link so the report stays attached to its controls.
 */
export async function recordChecksForSyncAdmin(
  admin: SupabaseClient,
  companyId: string,
  rawProvider: string,
  posture: unknown,
  evidenceId: string | null,
): Promise<RawCheck[]> {
  const provider = checkProviderFor(rawProvider);
  const raw = await rawChecksFor(provider, posture, admin, companyId);
  if (!raw) return [];

  const codeToId = await loadCodeToId(admin, companyId);
  await persistAsAdmin(admin, companyId, provider, raw, codeToId, evidenceId);

  // Same as the manual path: a passing check completes the measure it proves.
  // No userId here — the cron has no session, and measure_status.updated_by is
  // nullable precisely so an automated write can leave it blank rather than
  // attribute the change to whoever happened to connect the integration.
  await autoCompleteMeasuresFromChecks(admin, companyId, null);

  return raw;
}

/**
 * Every control code a measure satisfies, read from the crosswalk rather than
 * hardcoded. buildResults then drops the ones outside the company's selected
 * frameworks. Reading it live means adding a framework to the measure's crosswalk
 * extends this check for free; a hardcoded list would silently stop covering it.
 */
async function controlCodesForMeasure(
  db: SupabaseClient,
  measureKey: string,
): Promise<string[]> {
  const { data: measure } = await db
    .from("measures")
    .select("id")
    .eq("key", measureKey)
    .maybeSingle();
  if (!measure) return [];

  const { data: links } = await db
    .from("measure_controls")
    .select("controls(code)")
    .eq("measure_id", (measure as { id: string }).id);

  const codes = new Set<string>();
  for (const link of (links ?? []) as unknown as { controls: { code: string } | null }[]) {
    if (link.controls?.code) codes.add(link.controls.code);
  }
  return [...codes];
}

/**
 * Checks computed from ShieldFlow's own tables, with no provider API involved.
 *
 * Today that is one check — did an access review actually happen inside the
 * cadence — and it is the highest-leverage one we have: the `access-reviews`
 * measure is mandatory on CC6.1, CC6.2 and CC6.3 at once, so a single verdict
 * moves all three. With no integration to connect, it works on day one for every
 * workspace.
 *
 * Runs on both paths (`admin: true` from the cron, the RPCs from a user session)
 * and swallows its own errors: the cron calls this outside the per-integration
 * try/catch, and a throw here must not cost a company its other check results.
 */
export async function recordInternalChecks(
  db: SupabaseClient,
  companyId: string,
  opts: { admin?: boolean } = {},
): Promise<RawCheck[]> {
  try {
    // The newest completed review. Its own evidence CSV becomes the artifact
    // attached to every control this check lands on, so the auditor gets the
    // attestation itself and not just a green tick.
    const { data: review } = await db
      .from("access_reviews")
      .select("completed_at, evidence_id")
      .eq("company_id", companyId)
      .eq("status", "completed")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const latest = review as { completed_at: string | null; evidence_id: string | null } | null;

    const verdict = evaluateAccessReviewCadence(latest?.completed_at);
    const raw: RawCheck[] = [
      {
        checkKey: ACCESS_REVIEW_CHECK_KEY,
        controlCodes: await controlCodesForMeasure(db, "access-reviews"),
        result: verdict.result,
        detail: verdict.detail,
      },
    ];

    const codeToId = await loadCodeToId(db, companyId);
    // Only attach the CSV when the review is current. A stale review's evidence
    // would otherwise keep counting toward the control long after it went red.
    const evidenceId = verdict.result === "pass" ? (latest?.evidence_id ?? null) : null;

    if (opts.admin) {
      await persistAsAdmin(db, companyId, INTERNAL_PROVIDER, raw, codeToId, evidenceId);
    } else {
      await persistViaRpc(db, companyId, INTERNAL_PROVIDER, raw, codeToId, evidenceId);
    }
    await autoCompleteMeasuresFromChecks(db, companyId, null);

    return raw;
  } catch {
    // Best-effort, exactly like recordChecksForSync.
    return [];
  }
}

/** Clear a provider's checks + findings (used on disconnect so no stale data lingers). */
export async function clearChecksForProvider(
  supabase: SupabaseClient,
  companyId: string,
  rawProvider: string,
): Promise<void> {
  const provider = checkProviderFor(rawProvider);
  try {
    await callRecord(supabase, companyId, provider, []);
    await supabase.rpc("record_integration_findings", {
      p_company_id: companyId,
      p_provider: provider,
      p_findings: [],
    });
  } catch {
    // Best-effort.
  }
}
