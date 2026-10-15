import type { CheckDef } from "@/lib/checks-core";
import { hrisChecks } from "@/lib/integrations/hris/evaluate";
import type { HrisProvider } from "@/lib/integrations/hris/clients";

export const HRIS_AREAS = [
  { area: "people", title: "Employee records" },
  { area: "onboarding", title: "Joiners" },
];

export const HRIS_META: Record<HrisProvider, { title: string; checks: CheckDef[]; reads: readonly (readonly [string, string])[]; connect: string; never: string[] }> = {
  personio: {
    title: "Personio",
    checks: hrisChecks("personio", "Personio", {
      email: "Personio → the employee → Profile → Email: set their work email.",
      leaving: "Personio → the employee → Employment → Termination: record the termination and last working day.",
    }),
    reads: [
      ["Employees (read)", "name, work email, position, hire date, status"],
      ["Termination attributes (read)", "termination date, last working day, contract end date"],
    ],
    connect:
      "In Personio → Settings → Integrations → API credentials, generate credentials with read access to employees and tick only the attributes listed below as readable. ShieldFlow uses them once a day to read the employee list — nothing else.",
    never: ["Salaries, bank details, absences, documents or any attribute you don't tick — Personio only returns the attributes you whitelist.", "Write anything: the credentials are read-only."],
  },
  hibob: {
    title: "HiBob",
    checks: hrisChecks("hibob", "HiBob", {
      email: "HiBob → People → the employee → Personal → Email: set their work email.",
      leaving: "HiBob → the employee → Actions → Terminate: record the termination date.",
    }),
    reads: [
      ["People search (read)", "name, work email, title, start date"],
      ["Lifecycle (read)", "status and termination date — including former employees"],
    ],
    connect:
      "In HiBob → Settings → Integrations → Service users, create a service user and give its permission group read access to the People fields listed below, including former employees. ShieldFlow reads the list once a day.",
    never: ["Payroll, compensation, time off, documents or any field outside the permission group.", "Write anything: the service user has read permissions only."],
  },
  bamboohr: {
    title: "BambooHR",
    checks: hrisChecks("bamboohr", "BambooHR", {
      email: "BambooHR → the employee → Personal → Work Email.",
      leaving: "BambooHR → the employee → Job → Employment Status → Terminated, with the termination date.",
    }),
    reads: [["Custom report (read)", "id, name, work email, job title, hire date, termination date, status — current and former employees"]],
    connect:
      "In BambooHR → your name → API Keys, create a key for a user whose access level can see the fields listed below (a read-only custom access level is best). ShieldFlow runs one report a day.",
    never: ["Compensation, SSNs, bank details, time off or any field outside the report.", "Write anything: ShieldFlow only runs a report."],
  },
};
