import type { SupabaseClient } from "@supabase/supabase-js";
import { listSelectedFrameworkIds } from "@/lib/db/queries";

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
  raw: { control_codes: string[] };
}

/** Evaluate a provider's posture into raw checks (null if the provider has no evaluator). */
function rawChecksFor(provider: string, posture: unknown): RawCheck[] | null {
  const evaluator = EVALUATORS[provider];
  if (!evaluator) return null;
  return evaluator(posture);
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
    raw: { control_codes: rc.controlCodes },
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
 * Manual-sync path (user session). Evaluate a sync's posture into checks +
 * findings and persist both through the SECURITY DEFINER RPCs (the tamper-safe
 * writers). Best-effort: a failure here never breaks the sync that called it.
 */
export async function recordChecksForSync(
  supabase: SupabaseClient,
  companyId: string,
  provider: string,
  posture: unknown,
  evidenceId: string | null,
): Promise<void> {
  try {
    const raw = rawChecksFor(provider, posture);
    if (!raw) return;
    const codeToId = await loadCodeToId(supabase, companyId);
    await callRecord(supabase, companyId, provider, buildResults(raw, codeToId, evidenceId));
    await supabase.rpc("record_integration_findings", {
      p_company_id: companyId,
      p_provider: provider,
      p_findings: buildFindings(raw),
    });
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
  provider: string,
  posture: unknown,
  evidenceId: string | null,
): Promise<RawCheck[]> {
  const raw = rawChecksFor(provider, posture);
  if (!raw) return [];

  const codeToId = await loadCodeToId(admin, companyId);
  const results = buildResults(raw, codeToId, evidenceId);

  // Replace this provider's checks (delete + insert), mirroring record_control_checks.
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

  // Replace this provider's findings.
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

  return raw;
}

/** Clear a provider's checks + findings (used on disconnect so no stale data lingers). */
export async function clearChecksForProvider(
  supabase: SupabaseClient,
  companyId: string,
  provider: string,
): Promise<void> {
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
