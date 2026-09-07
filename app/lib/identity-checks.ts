/**
 * Reconcile an identity provider's account list against the Personnel roster.
 *
 * Two questions an auditor asks about CC6.2 and CC6.3, in opposite directions:
 *
 *   offboarding drift  — someone left; does their account still work?
 *   untracked accounts — an account works; who does it belong to?
 *
 * Vanta and Drata answer the first from an HRIS. We answer it from the Personnel
 * table, which the 11-200 person companies we sell to actually have. Nobody in
 * the SOC 2 tools answers the second; it comes from identity governance.
 *
 * These functions are pure on purpose. There is no test runner in this repo, so
 * being able to read the branches without a database or an HTTP client is what
 * makes them reviewable — and the branch that matters most is the one that
 * refuses to answer. Anything we could not actually see is `inconclusive`, never
 * `pass` and never `fail`. A roster check that passes because it read half the
 * directory is worse than no check at all: it tells the customer they are clean
 * when they are not, and they stop looking.
 */

import type { CheckResultValue } from "@/lib/checks";

/** One account as seen at the identity provider. */
export interface IdentityAccount {
  email: string;
  /**
   * Whether this account can still be used to sign in. Deliberately computed by
   * the caller: for Okta it is NOT (DEPROVISIONED || SUSPENDED) rather than
   * `=== ACTIVE`, because LOCKED_OUT and PASSWORD_EXPIRED accounts still hold
   * their access and can come back.
   */
  active: boolean;
}

/** One row of the Personnel register. */
export interface PersonRecord {
  name: string;
  email: string | null;
  status: string;
  /** ISO date (YYYY-MM-DD) the person left. */
  ended_at: string | null;
}

export interface IdentityVerdict {
  result: CheckResultValue;
  detail: string;
  /**
   * The specific accounts a failing verdict is about, so the UI can offer an
   * action per account instead of asking the user to retype an address out of a
   * sentence. Absent unless the verdict names accounts.
   */
  subjects?: string[];
}

export interface DriftInput {
  /** Null when the provider posture had no roster (older cached posture, or a failed read). */
  roster: IdentityAccount[] | null;
  /** True when the provider client stopped on its page budget rather than the data. */
  truncated: boolean;
  people: PersonRecord[];
  /** Days after `ended_at` before an account still being live counts as a finding. */
  graceDays: number;
  now?: Date;
}

export interface UntrackedInput {
  roster: IdentityAccount[] | null;
  truncated: boolean;
  people: PersonRecord[];
  /** Emails the workspace has explicitly marked as "not a person". */
  dismissed: string[];
}

/** How many names to spell out before summarising. Keeps the alert readable. */
const MAX_NAMED = 5;

const DAY_MS = 86_400_000;

function norm(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function list(names: string[]): string {
  if (names.length <= MAX_NAMED) return names.join(", ");
  return `${names.slice(0, MAX_NAMED).join(", ")} and ${names.length - MAX_NAMED} more`;
}

const TRUNCATED_NOTE =
  "the directory is larger than we read in one sync, so accounts we did not see could still be open";

/**
 * Did anyone who left keep their access?
 *
 * The due set is people marked offboarded, with a leaving date, whose grace
 * period has expired. Someone offboarded yesterday is not a finding — the point
 * is to catch the account nobody got round to closing, not to nag on day one.
 */
export function evaluateOffboardingDrift(input: DriftInput): IdentityVerdict {
  const { roster, truncated, people, graceDays } = input;
  const now = input.now ?? new Date();

  if (!roster) {
    return {
      result: "inconclusive",
      detail: "Couldn't read the directory, so leavers' accounts couldn't be checked.",
    };
  }

  const offboarded = people.filter((p) => p.status === "offboarded");
  if (offboarded.length === 0) {
    return {
      result: "inconclusive",
      detail:
        "No offboarded people are recorded in Personnel, so there is nothing to check yet. " +
        "Mark leavers as offboarded with their leaving date to turn this on.",
    };
  }

  const cutoff = now.getTime() - graceDays * DAY_MS;
  const due = offboarded.filter((p) => {
    if (!p.ended_at) return false;
    const ended = new Date(p.ended_at).getTime();
    return Number.isFinite(ended) && ended <= cutoff;
  });

  if (due.length === 0) {
    const undated = offboarded.filter((p) => !p.ended_at).length;
    return {
      result: "inconclusive",
      detail: undated
        ? `${undated} offboarded person(s) have no leaving date recorded, so the ${graceDays}-day ` +
          `deprovisioning window can't be measured. Add their end date in Personnel.`
        : `${offboarded.length} person(s) offboarded, all still inside the ${graceDays}-day ` +
          `deprovisioning window. Nothing is overdue.`,
    };
  }

  const withEmail = due.filter((p) => norm(p.email));
  const withoutEmail = due.length - withEmail.length;

  if (withEmail.length === 0) {
    return {
      result: "inconclusive",
      detail:
        `${due.length} person(s) are past the ${graceDays}-day deprovisioning window but have no ` +
        `email recorded in Personnel, so their accounts can't be matched. Add their work email.`,
    };
  }

  // One bad row must not disable the check: evaluate everyone we can match and
  // say how many were skipped.
  const activeByEmail = new Map<string, boolean>();
  for (const account of roster) activeByEmail.set(norm(account.email), account.active);

  const stillOpen = withEmail.filter((p) => activeByEmail.get(norm(p.email)) === true);
  const skipped = withoutEmail ? ` ${withoutEmail} other leaver(s) skipped: no email recorded.` : "";

  if (stillOpen.length > 0) {
    const named = list(
      stillOpen.map((p) => `${p.name}${p.ended_at ? ` (left ${p.ended_at})` : ""}`),
    );
    return {
      result: "fail",
      detail:
        `${stillOpen.length} person(s) left more than ${graceDays} days ago but their account is ` +
        `still open: ${named}. Deprovision or suspend them at the identity provider.${skipped}`,
    };
  }

  if (truncated) {
    return {
      result: "inconclusive",
      detail:
        `The ${withEmail.length} leaver(s) we could check have no open account, but ${TRUNCATED_NOTE}.${skipped}`,
    };
  }

  return {
    result: "pass",
    detail:
      `All ${withEmail.length} person(s) offboarded more than ${graceDays} days ago have had their ` +
      `access removed.${skipped}`,
  };
}

/**
 * Does every working account belong to someone we onboarded?
 *
 * The completeness half of the same reconciliation. A live account with nobody
 * behind it is either a leaver Personnel never recorded, a contractor nobody
 * tracked, or a service account — and all three are things an auditor asks about.
 *
 * We deliberately do NOT guess at service accounts from the address. An `svc-` or
 * `noreply` prefix rule looks tidy and quietly passes real orphans that happen to
 * be named that way. A service account belongs in Personnel with a role of
 * "Service account", which needs no schema change and is the inventory the
 * service-accounts measure asks for anyway.
 */
export function evaluateUntrackedAccounts(input: UntrackedInput): IdentityVerdict {
  const { roster, truncated, people, dismissed } = input;

  if (!roster) {
    return {
      result: "inconclusive",
      detail: "Couldn't read the directory, so accounts couldn't be matched to people.",
    };
  }

  // Match against everyone on the register, not just current staff: a leaver's
  // lingering account is offboarding drift's finding, not an untracked account.
  const known = new Set(people.map((p) => norm(p.email)).filter(Boolean));
  const ignored = new Set(dismissed.map(norm).filter(Boolean));

  if (people.filter((p) => p.status === "active").length === 0) {
    return {
      result: "inconclusive",
      detail:
        "No active people are recorded in Personnel, so every account would look unmatched. " +
        "Add your people in Personnel first — you can import them from this provider.",
    };
  }

  const live = roster.filter((a) => a.active && norm(a.email));
  const unmatched = live.filter((a) => !known.has(norm(a.email)) && !ignored.has(norm(a.email)));

  // If half the directory is unknown the roster is what's broken, not the IdP.
  // Failing here would bury a real finding under dozens of false ones.
  if (live.length > 0 && unmatched.length * 2 > live.length) {
    return {
      result: "inconclusive",
      detail:
        `${unmatched.length} of ${live.length} active accounts match nobody in Personnel. ` +
        "That usually means the roster is incomplete rather than the directory being wrong — " +
        "import your people, then this check becomes meaningful.",
    };
  }

  if (unmatched.length > 0) {
    return {
      result: "fail",
      detail:
        `${unmatched.length} active account(s) belong to nobody in Personnel: ` +
        `${list(unmatched.map((a) => a.email))}. Add them as people, or mark them as not a person ` +
        "(use a role of “Service account” for non-human accounts).",
      subjects: unmatched.map((a) => a.email),
    };
  }

  if (truncated) {
    return {
      result: "inconclusive",
      detail: `The ${live.length} account(s) we read all match someone in Personnel, but ${TRUNCATED_NOTE}.`,
    };
  }

  return {
    result: "pass",
    detail: `All ${live.length} active account(s) belong to someone recorded in Personnel.`,
  };
}
