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
 * Evaluate a sync's posture into checks, resolve each control code to the
 * company's actual control rows, and persist the verdicts. Best-effort: a failure
 * here never breaks the sync that called it (mirrors logEvent).
 */
export async function recordChecksForSync(
  supabase: SupabaseClient,
  companyId: string,
  provider: string,
  posture: unknown,
  evidenceId: string | null,
): Promise<void> {
  try {
    const evaluator = EVALUATORS[provider];
    if (!evaluator) return;
    const raw = evaluator(posture);

    const frameworkIds = await listSelectedFrameworkIds(supabase, companyId);
    if (frameworkIds.length === 0) {
      await callRecord(supabase, companyId, provider, []);
      return;
    }

    const { data: controls } = await supabase
      .from("controls")
      .select("id, code")
      .in("framework_id", frameworkIds);

    const codeToId = new Map<string, string>();
    for (const c of controls ?? []) codeToId.set((c as any).code, (c as any).id);

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

    await callRecord(supabase, companyId, provider, results);
  } catch {
    // Never let check recording break a sync.
  }
}

/** Clear a provider's checks (used on disconnect so no stale "pass" lingers). */
export async function clearChecksForProvider(
  supabase: SupabaseClient,
  companyId: string,
  provider: string,
): Promise<void> {
  try {
    await callRecord(supabase, companyId, provider, []);
  } catch {
    // Best-effort.
  }
}
