import { z } from "zod";

// Strips ASCII control characters (NUL..US plus DEL) - these break prompts,
// storage keys, and DB text rendering, and are never legitimate user input.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export const onboardingSchema = z.object({
  companyName: z
    .string()
    .transform((s) => s.replace(CONTROL_CHARS, "").trim())
    .pipe(
      z
        .string()
        .min(2, "Company name is too short")
        .max(120)
        .regex(/[\p{L}\p{N}]{2,}/u, "Company name needs at least two letters or digits"),
    ),
  frameworkId: z.string().uuid("Pick a framework"),
});

/** True only for a real calendar date (rejects 2024-02-30) in a sane range. */
function isRealDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  if (y < 2000 || y > 2100) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const controlMetaSchema = z.object({
  controlId: z.string().uuid(),
  owner_email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .max(254)
    .optional()
    .or(z.literal("")),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine(isRealDate, "That date doesn't exist - pick a date between 2000 and 2100")
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const oktaSchema = z.object({
  domain: z.string().trim().min(3).max(255),
  token: z.string().trim().min(20, "That token looks too short.").max(200),
});

export const gitlabTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20)
    .max(300)
    .regex(/^(glpat-|gloas-)?[A-Za-z0-9_-]+$/, "Paste a GitLab personal access token."),
});

export const jiraSchema = z.object({
  site: z.string().trim().min(3).max(255),
  email: z.string().trim().toLowerCase().email("Enter the email for the API token.").max(254),
  token: z.string().trim().min(10, "That token looks too short.").max(300),
});

export const linearTokenSchema = z.object({
  token: z.string().trim().min(20, "That key looks too short.").max(200),
});

export const cloudflareTokenSchema = z.object({
  token: z.string().trim().min(20, "That token looks too short.").max(200),
});

export const gcpSchema = z.object({
  serviceAccountJson: z.string().trim().min(50, "Paste the full service-account JSON.").max(8000),
});

export const awsCredentialsSchema = z.object({
  accessKeyId: z
    .string()
    .trim()
    .regex(
      /^(AKIA|ASIA)[A-Z0-9]{16}$/,
      "That doesn't look like an AWS access key ID (it starts with AKIA…).",
    ),
  secretAccessKey: z
    .string()
    .trim()
    .min(40, "The AWS secret access key looks too short.")
    .max(128),
});

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address")
    .max(254),
  role: z.enum(["admin", "member", "auditor"]),
  // Optional time-box (days) for read-only auditor access. 0/undefined = no expiry.
  expiresInDays: z.coerce.number().int().min(0).max(365).optional(),
});

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export const RISK_STATUSES = ["open", "mitigating", "accepted", "closed"] as const;

export const riskSchema = z.object({
  title: z.string().trim().min(2, "Risk title is too short").max(160),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  category: z.string().trim().max(80).optional().or(z.literal("")),
  // likelihood/impact are the INHERENT (pre-mitigation) assessment.
  likelihood: z.enum(RISK_LEVELS),
  impact: z.enum(RISK_LEVELS),
  // residual_* are optional (post-mitigation). "" = not yet assessed.
  residual_likelihood: z.enum(RISK_LEVELS).optional().or(z.literal("")),
  residual_impact: z.enum(RISK_LEVELS).optional().or(z.literal("")),
  status: z.enum(RISK_STATUSES),
  owner_email: z.string().trim().email("Enter a valid email").max(254).optional().or(z.literal("")),
  treatment: z.string().trim().max(2000).optional().or(z.literal("")),
  // Controls that mitigate this risk (the link that grounds residual exposure).
  controlIds: z.array(z.string().uuid()).max(200).optional().default([]),
});

export const TRAINING_STATUSES = ["assigned", "in_progress", "completed"] as const;

export const trainingSchema = z.object({
  person_name: z.string().trim().min(2, "Name is too short").max(120),
  person_email: z.string().trim().email("Enter a valid email").max(254).optional().or(z.literal("")),
  course: z.string().trim().min(2, "Course name is too short").max(160),
  status: z.enum(TRAINING_STATUSES),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine(isRealDate, "That date doesn't exist - pick a date between 2000 and 2100")
    .optional()
    .or(z.literal("")),
});

export const POLICY_TYPES = [
  "Information Security Policy",
  "Access Control Policy",
  "Incident Response Policy",
  "Data Retention & Disposal Policy",
  "Acceptable Use Policy",
  "Business Continuity Policy",
  "Vendor / Third-Party Risk Policy",
  "Change Management Policy",
] as const;

export const policyGenerateSchema = z.object({
  policyType: z.enum(POLICY_TYPES),
  frameworkId: z.string().uuid().optional().nullable(),
});

export const policySaveSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  body: z.string().max(100_000),
  status: z.enum(["draft", "final"]),
});

export const policyCreateSchema = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().min(1, "Policy body is empty").max(100_000),
  frameworkId: z.string().uuid().nullable(),
});

export const VENDOR_RISKS = ["low", "medium", "high", "critical"] as const;
export const VENDOR_STATUSES = ["active", "under_review", "offboarded"] as const;
export const VENDOR_SOC2_STATUSES = ["none", "requested", "on_file"] as const;
export const VENDOR_DATA_SENSITIVITY = ["none", "internal", "pii", "phi"] as const;

export const vendorSchema = z.object({
  name: z.string().trim().min(2, "Vendor name is too short").max(120),
  website: z
    .string()
    .trim()
    .url("Enter a full URL (https://...)")
    .regex(/^https?:\/\//i, "Only http(s) URLs")
    .max(300)
    .optional()
    .or(z.literal("")),
  category: z.string().trim().max(80).optional().or(z.literal("")),
  risk_level: z.enum(VENDOR_RISKS),
  status: z.enum(VENDOR_STATUSES),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  contact_email: z.string().trim().email("Enter a valid email").max(254).optional().or(z.literal("")),
  review_cadence_months: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(1).max(60).optional(),
  ),
  soc2_status: z.enum(VENDOR_SOC2_STATUSES),
  soc2_expires_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine(isRealDate, "That date doesn't exist - pick a date between 2000 and 2100")
    .optional()
    .or(z.literal("")),
  data_sensitivity: z.enum(VENDOR_DATA_SENSITIVITY),
});

// Trust Center slug: lowercase kebab, no leading/trailing dash. Reserved words
// blocked so nobody claims /trust/admin or /trust/api as their page.
const RESERVED_SLUGS = ["admin", "api", "app", "www", "shieldflow", "trust", "login", "signup"];
export const trustSettingsSchema = z.object({
  enabled: z.boolean(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and dashes")
    .min(3, "Slug is too short")
    .max(60)
    .refine((s) => !RESERVED_SLUGS.includes(s), "That name is reserved — pick another"),
});

// GitHub fine-grained PATs start with github_pat_; classic tokens with ghp_.
// Shape-check before the live GET /user validation so obvious garbage never
// leaves the server.
export const githubTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, "That doesn't look like a GitHub token")
    .max(300)
    .regex(/^(github_pat_|ghp_)[A-Za-z0-9_]+$/, "Paste a GitHub personal access token (github_pat_... or ghp_...)"),
});

// Slack webhook URL shape — the strict host/path SSRF check lives in
// lib/slack.ts isValidSlackWebhook and runs on top of this.
export const slackWebhookSchema = z.object({
  webhookUrl: z
    .string()
    .trim()
    .url("Paste the full webhook URL")
    .max(400),
});

export const copilotSchema = z.object({
  message: z.string().trim().min(1, "Type a question").max(2000),
});

// Evidence upload constraints (mirrored from the Storage bucket config).
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024; // 10MB
export const ALLOWED_EVIDENCE_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
] as const;

// Server-side mirror of the client pre-checks: a tampered client can call the
// recordEvidence action directly, so size/mime/lengths must be re-validated here.
export const evidenceRecordSchema = z.object({
  controlId: z.string().uuid(),
  storagePath: z.string().min(3).max(500),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_EVIDENCE_MIME),
  sizeBytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
  note: z.string().trim().max(500).optional(),
});

/** Strip path separators / control chars so a filename is safe as a storage key segment. */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\]/g, "_")
    .replace(/[^\w.\- ]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 120) || "file";
}

/**
 * Make a user-controlled value safe to interpolate into an AI prompt: collapse
 * newlines (so it can't fake new system instructions on its own line), strip
 * control chars, and cap the length. The system prompt stays authoritative,
 * but there's no reason to hand untrusted data extra structure.
 */
export function sanitizeForPrompt(value: string, maxLen = 120): string {
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

// Public marketing waitlist signup — used by the /api/waitlist route behind the
// landing page. No auth/session; insert runs through the service-role client.
export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "200+"] as const;

export const waitlistSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  companyName: z.string().trim().max(120).optional().or(z.literal("")),
  companySize: z.enum(COMPANY_SIZES).optional(),
  painPoint: z.string().trim().max(1000).optional().or(z.literal("")),
  source: z.string().trim().max(120).optional().or(z.literal("")),
  // Honeypot — must be empty.
  website: z.string().max(0).optional(),
});

export type WaitlistPayload = z.infer<typeof waitlistSchema>;

// ---------- Security questionnaires ----------
export const QUESTIONNAIRE_ITEM_STATUSES = ["draft", "needs_review", "approved"] as const;

export const questionnaireCreateSchema = z.object({
  name: z.string().trim().min(2, "Give the questionnaire a name").max(160),
  questions: z
    .array(z.string().trim().min(3).max(2000))
    .min(1, "Add at least one question")
    .max(200, "That's a lot of questions — split it into two."),
});

export const questionnaireItemSchema = z.object({
  id: z.string().uuid(),
  answer: z.string().trim().max(5000).optional().or(z.literal("")),
  status: z.enum(QUESTIONNAIRE_ITEM_STATUSES),
});

// ---------- Access reviews ----------
export const ACCESS_DECISIONS = ["pending", "keep", "revoke", "out_of_scope"] as const;

const accessReviewSubjectSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  access: z.string().trim().max(300).optional().or(z.literal("")),
});

const accessReviewSystemInputSchema = z.object({
  name: z.string().trim().min(1, "Give the system a name").max(120),
  // Matches integrations.IntegrationProvider when this system's roster was
  // pulled from a connected integration; omitted for manual/CSV/pasted systems.
  provider: z.string().trim().max(40).optional().or(z.literal("")),
  items: z
    .array(accessReviewSubjectSchema)
    .min(1, "Add at least one person or account for this system")
    .max(500, "That's a lot for one system — split it into two reviews."),
});

export const accessReviewCreateSchema = z.object({
  name: z.string().trim().min(2, "Give the review a name").max(160),
  reviewer_email: z.string().trim().email("Enter a valid email").max(254).optional().or(z.literal("")),
  systems: z
    .array(accessReviewSystemInputSchema)
    .min(1, "Add at least one system to review")
    .max(20, "That's a lot of systems for one review — split it up."),
});

export const accessReviewDecisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(ACCESS_DECISIONS),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

// Roster CSV upload template — intentionally narrow (2 columns), not a general importer.
export const ROSTER_CSV_TEMPLATE = "subject,access\nalice@acme.com,Admin\nbob@acme.com,Member\n";

// ---------- Trust Center depth ----------
export const TRUST_REQUEST_STATUSES = ["new", "approved", "declined"] as const;

export const subprocessorSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(120),
  purpose: z.string().trim().max(200).optional().or(z.literal("")),
  location: z.string().trim().max(120).optional().or(z.literal("")),
  url: z.string().trim().url("Enter a full URL (https://...)").max(300).optional().or(z.literal("")),
});

// ---------- SSO (Phase A) ----------
export const ssoDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter a domain like acme.com")
    .max(253),
});

// ---------- Personnel roster ----------
export const PERSONNEL_STATUSES = ["active", "offboarded"] as const;

export const personnelSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254).optional().or(z.literal("")),
  role_title: z.string().trim().max(120).optional().or(z.literal("")),
  started_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine(isRealDate, "That date doesn't exist - pick a date between 2000 and 2100")
    .optional()
    .or(z.literal("")),
});

// Public access-request form (anonymous; submitted through the rate-limited route).
export const trustAccessRequestSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,60}$/, "Invalid page"),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  name: z.string().trim().max(160).optional().or(z.literal("")),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  website: z.string().max(0).optional(), // honeypot — must be empty
});

// ---------- Notifications ----------
// Categories double as the `type` column on notifications + notification_prefs.
// Keep in sync with the check constraint in migration 0017_notifications.sql.
export const NOTIFICATION_CATEGORIES = [
  "control",
  "integration",
  "policy",
  "vendor",
  "risk",
  "team",
  "system",
  "task",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Human labels for the preferences UI. */
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  control: "Controls",
  integration: "Integrations",
  policy: "Policies",
  vendor: "Vendors",
  risk: "Risks",
  team: "Team",
  system: "System",
  task: "Tasks",
};

// ---------- Tasks ----------
export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export const TASK_RECURRENCE = ["none", "weekly", "monthly", "quarterly", "annually"] as const;
export const TASK_LINK_TYPES = ["control", "risk", "vendor", "policy"] as const;

export const taskSchema = z.object({
  title: z.string().trim().min(2, "Task title is too short").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  assignee_email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email")
    .max(254)
    .optional()
    .or(z.literal("")),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine(isRealDate, "That date doesn't exist - pick a date between 2000 and 2100")
    .optional()
    .or(z.literal("")),
  recurrence: z.enum(TASK_RECURRENCE),
  linked_type: z.enum(TASK_LINK_TYPES).optional().or(z.literal("")),
  linked_id: z.string().uuid().optional().or(z.literal("")),
});

/** One category's delivery preference (validated server-side in the prefs action). */
export const notificationPrefSchema = z.object({
  type: z.enum(NOTIFICATION_CATEGORIES),
  email_enabled: z.boolean(),
  in_app_enabled: z.boolean(),
});
