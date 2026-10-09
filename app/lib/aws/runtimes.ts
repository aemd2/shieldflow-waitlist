/**
 * Lambda runtime deprecation dates, from AWS's own table
 * (docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html, read 2026-10-09).
 *
 * After the deprecation date AWS may stop patching the runtime and functions lose
 * technical support. There's no API for this, so the table lives here — update
 * it when AWS publishes new dates. A runtime missing from the table is never
 * flagged: we don't guess.
 */
export const LAMBDA_DEPRECATION: Record<string, string> = {
  // Supported, with a scheduled date
  "nodejs24.x": "2028-04-30",
  "nodejs22.x": "2027-04-30",
  "python3.14": "2029-06-30",
  "python3.13": "2029-06-30",
  "python3.12": "2028-10-31",
  "python3.11": "2027-06-30",
  "python3.10": "2026-10-31",
  java25: "2029-06-30",
  java21: "2029-06-30",
  "java17.al2023": "2029-06-30",
  "java11.al2023": "2029-06-30",
  "java8.al2023": "2029-06-30",
  java17: "2027-06-30",
  java11: "2027-06-30",
  "java8.al2": "2027-06-30",
  dotnet10: "2028-11-14",
  dotnet9: "2026-11-10",
  dotnet8: "2026-11-10",
  "ruby4.0": "2029-03-31",
  "ruby3.4": "2028-03-31",
  "ruby3.3": "2027-03-31",
  "provided.al2023": "2029-06-30",
  // Already deprecated
  "provided.al2": "2026-07-31",
  "nodejs20.x": "2026-04-30",
  "ruby3.2": "2026-03-31",
  "python3.9": "2025-12-15",
  "nodejs18.x": "2025-09-01",
  dotnet6: "2024-12-20",
  "python3.8": "2024-10-14",
  "nodejs16.x": "2024-06-12",
  dotnet7: "2024-05-14",
  java8: "2024-01-08",
  "go1.x": "2024-01-08",
  provided: "2024-01-08",
  "ruby2.7": "2023-12-07",
  "nodejs14.x": "2023-12-04",
  "python3.7": "2023-12-04",
  "dotnetcore3.1": "2023-04-03",
  "nodejs12.x": "2023-03-31",
  "python3.6": "2022-07-18",
  "dotnet5.0": "2022-05-10",
  "dotnetcore2.1": "2022-01-05",
  "nodejs10.x": "2021-07-30",
  "ruby2.5": "2021-07-30",
  "python2.7": "2021-07-15",
};

/** How far ahead a coming deprecation starts to count. */
export const RUNTIME_WARNING_DAYS = 90;

export type RuntimeStatus = "ok" | "deprecated" | "soon" | "unknown";

export function runtimeStatus(runtime: string | null, now: Date): { status: RuntimeStatus; date: string | null } {
  if (!runtime) return { status: "unknown", date: null }; // container images: no managed runtime
  const date = LAMBDA_DEPRECATION[runtime] ?? null;
  if (!date) return { status: "unknown", date: null };
  const days = (Date.parse(date) - now.getTime()) / 86_400_000;
  if (days <= 0) return { status: "deprecated", date };
  if (days <= RUNTIME_WARNING_DAYS) return { status: "soon", date };
  return { status: "ok", date };
}
