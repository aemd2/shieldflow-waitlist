import { exceptionMap, resourceKey, Verdict, type CheckDef, type CheckOutcome, type ExceptionRow, type Section } from "@/lib/checks-core";
import { hrState, type HrEmployee } from "@/lib/integrations/hris/clients";

/**
 * HR system → checks. Pure. The HR system's real job is upstream: it keeps
 * Personnel right, and every system's leaver check reads Personnel. These
 * checks are about the HR record itself and the joiner process.
 */

export interface TrainingDone {
  email: string;
  completed: boolean;
}

export interface HrisEvaluateOptions {
  now: Date;
  exceptions: ExceptionRow[];
  training: TrainingDone[] | null;
  /** Joiners complete security training within this many days of starting. */
  trainingDays: number;
}

export const employeeResource = (prefix: string, e: Pick<HrEmployee, "externalId" | "name" | "email">, label?: string) => ({
  id: resourceKey(prefix, null, "employee", e.externalId),
  label: label ?? `${e.name}${e.email ? ` (${e.email})` : ""}`,
  region: null,
});

export function evaluateHris(prefix: string, employees: Section<HrEmployee[]>, truncated: boolean, missingFields: string[], opts: HrisEvaluateOptions): CheckOutcome[] {
  const ex = exceptionMap(opts.exceptions, opts.now);
  const V = (key: string) => new Verdict(`${prefix}.${key}`, ex);
  const today = opts.now.toISOString().slice(0, 10);
  const list = employees.ok ? employees.data : [];
  const current = list.filter((e) => hrState(e, today) !== "left");
  const out: CheckOutcome[] = [];

  {
    const v = V("records_complete");
    v.read(employees, "employees");
    if (truncated) v.gap("more people than one scan reads");
    if (missingFields.some((f) => f.startsWith("email"))) v.gap("the credentials can't read work email");
    for (const e of current) if (!e.email) v.flag(employeeResource(prefix, e, `${e.name} — no work email`));
    out.push(v.settle(`All ${current.length} current employees have a work email, so their accounts can be matched.`, (n) => `${n} current ${n === 1 ? "employee has" : "employees have"} no work email in the HR system, so their accounts can't be matched.`));
  }
  {
    const v = V("leaving_dates");
    v.read(employees, "employees");
    if (truncated) v.gap("more people than one scan reads");
    const dateField = missingFields.find((f) => /termination|internal/.test(f));
    if (dateField) v.gap(`the credentials can't read ${dateField}`);
    // Inactive without a leaving date: the access-removal window can't be measured.
    for (const e of list) if (!e.active && !e.endDate) v.flag(employeeResource(prefix, e, `${e.name} — inactive, no leaving date`));
    out.push(v.settle("Every leaver has a leaving date, so access removal can be timed.", (n) => `${n} ${n === 1 ? "leaver has" : "leavers have"} no leaving date in the HR system — the time to remove their access can't be measured.`));
  }
  {
    const v = V("joiners_training");
    v.read(employees, "employees");
    if (truncated) v.gap("more people than one scan reads");
    const done = new Set((opts.training ?? []).filter((t) => t.completed).map((t) => t.email.toLowerCase()));
    if (opts.training === null) v.gap("training records couldn't be read");
    const due = new Date(opts.now.getTime() - opts.trainingDays * 86_400_000).toISOString().slice(0, 10);
    const yearAgo = new Date(opts.now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
    const joiners = current.filter((e) => e.startDate && e.startDate >= yearAgo && e.startDate <= due);
    // Training unreadable: nobody can be said to have missed it.
    for (const e of opts.training === null ? [] : joiners) {
      if (!e.email) v.gap(`${e.name} has no work email to match training to`);
      else if (!done.has(e.email)) v.flag(employeeResource(prefix, e, `${e.name} (started ${e.startDate})`));
    }
    out.push(
      v.settle(
        joiners.length ? `All ${joiners.length} people who joined in the last year finished security training within ${opts.trainingDays} days.` : "Nobody joined in the last year (more than a month ago).",
        (n) => `${n} ${n === 1 ? "person who joined" : "people who joined"} more than ${opts.trainingDays} days ago ${n === 1 ? "hasn't" : "haven't"} finished security training.`,
      ),
    );
  }
  return out;
}

export function hrisChecks(prefix: string, title: string, consoleHint: { email: string; leaving: string }): CheckDef<"people" | "onboarding">[] {
  const ACCESS = ["CC6.2", "CC6.3", "A.5.16", "A.5.18"];
  const TRAINING = ["CC1.4", "CC2.2", "A.6.3", "Art. 20"];
  return [
    {
      key: `${prefix}.records_complete`,
      title: "Every employee has a work email",
      area: "people",
      severity: "medium",
      why: "The work email is how ShieldFlow ties a person to their Google, Microsoft, GitHub and AWS accounts — without it their access can't be checked when they leave.",
      controlCodes: ACCESS,
      apiCalls: [`${title}: employees (read)`],
      fix: { console: consoleHint.email },
    },
    {
      key: `${prefix}.leaving_dates`,
      title: "Every leaver has a leaving date",
      area: "people",
      severity: "high",
      why: "Auditors sample leavers and compare the leaving date with when access was removed. Without the date there is nothing to compare.",
      controlCodes: ACCESS,
      apiCalls: [`${title}: employees incl. former (read)`],
      fix: { console: consoleHint.leaving },
    },
    {
      key: `${prefix}.joiners_training`,
      title: "Joiners finish security training within 30 days",
      area: "onboarding",
      severity: "medium",
      why: "Security awareness training at onboarding is one of the first things an auditor samples: pick five joiners, show the completion date.",
      controlCodes: TRAINING,
      apiCalls: [`${title}: employees (start date)`, "Training (ShieldFlow)"],
      fix: { console: "Training → assign the security awareness course to each listed person; mark it complete when they finish." },
    },
  ];
}
