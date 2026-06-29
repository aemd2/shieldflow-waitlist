import type { SupabaseClient } from "@supabase/supabase-js";
import type { ControlStatus } from "@/lib/score";

export interface Company {
  id: string;
  name: string;
  owner_user_id: string;
}

export interface Framework {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

export type Criticality = "core" | "important" | "operational";

export interface Control {
  id: string;
  framework_id: string;
  code: string;
  title: string;
  description: string | null;
  category: string | null;
  criticality: Criticality;
}

export interface ControlWithStatus extends Control {
  status: ControlStatus;
  owner_email: string | null;
  due_date: string | null;
  notes: string | null;
  evidenceCount: number;
}

export interface Evidence {
  id: string;
  company_id: string;
  control_id: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  note: string | null;
  uploaded_by: string | null;
  created_at: string;
  /** Set by listEvidence: "manual" = user-uploaded (control_id matches), "integration"
   * = auto-collected report linked to this control via a control_checks row. */
  source?: "manual" | "integration";
}

export interface Policy {
  id: string;
  company_id: string;
  framework_id: string | null;
  title: string;
  body: string;
  status: "draft" | "final";
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Approval + acknowledgement lifecycle (migration 0020).
  approved_by: string | null;
  approved_at: string | null;
  version: number;
  published_at: string | null;
  review_cadence_months: number | null;
}

export interface CopilotMessage {
  id: string;
  company_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export async function getCompanyForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<Company | null> {
  // Resolve via membership, not ownership, so invited teammates see their
  // company too. Owners are members of their own company, so they still match.
  // One company per user is enforced (the accept_invite RPC blocks a second),
  // so the first row is authoritative.
  const { data, error } = await supabase
    .from("company_members")
    .select("companies(id, name, owner_user_id)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  // supabase-js types embedded relations as an array; the FK is to-one so it
  // holds at most one company.
  const rows = (data ?? []) as unknown as Array<{ companies: Company | Company[] | null }>;
  const c = rows[0]?.companies;
  return (Array.isArray(c) ? c[0] ?? null : c) ?? null;
}

export type CallerRole = "owner" | "admin" | "member" | "auditor";

export interface CallerAccess {
  role: CallerRole;
  expired: boolean;
  canWrite: boolean;
}

export const READ_ONLY_MESSAGE =
  "Your access is read-only. Ask a workspace admin if you need to make changes.";

/** The caller's role + write capability in a company (null if not a member / expired out). */
export async function getCallerAccess(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
): Promise<CallerAccess | null> {
  const { data } = await supabase
    .from("company_members")
    .select("role, expires_at")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const role = (data as { role: CallerRole }).role;
  const exp = (data as { expires_at: string | null }).expires_at;
  const expired = exp ? new Date(exp).getTime() <= Date.now() : false;
  return { role, expired, canWrite: !expired && role !== "auditor" };
}

/**
 * Returns a friendly read-only error string if the caller may not write, else
 * null. App-layer companion to the RLS can_write_company() gate — gives auditors
 * a clear message instead of a silent zero-row failure.
 */
export async function assertCanWrite(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
): Promise<string | null> {
  const access = await getCallerAccess(supabase, companyId, userId);
  if (!access || !access.canWrite) return READ_ONLY_MESSAGE;
  return null;
}

export interface TeamMember {
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: string;
  token: string;
  created_at: string;
}

export interface CompanyTeam {
  members: TeamMember[];
  invites: PendingInvite[];
}

/** Roster (members + pending invites) via the get_company_team RPC. */
export async function getCompanyTeam(
  supabase: SupabaseClient,
  companyId: string,
): Promise<CompanyTeam> {
  const { data, error } = await supabase.rpc("get_company_team", { p_company_id: companyId });
  if (error) throw error;
  const team = (data ?? {}) as Partial<CompanyTeam>;
  return { members: team.members ?? [], invites: team.invites ?? [] };
}

export async function listFrameworks(supabase: SupabaseClient): Promise<Framework[]> {
  const { data, error } = await supabase
    .from("frameworks")
    .select("id, slug, name, description")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

const CONTROL_SELECT =
  "status, owner_email, due_date, notes, controls(id, framework_id, code, title, description, category, criticality)";

function mapControlRow(row: any, evidenceCount: number): ControlWithStatus {
  return {
    ...(row.controls as Control),
    status: row.status as ControlStatus,
    owner_email: row.owner_email ?? null,
    due_date: row.due_date ?? null,
    notes: row.notes ?? null,
    evidenceCount,
  };
}

/**
 * Map of control_id -> evidence count for a company. Counts both manually
 * uploaded evidence (evidence.control_id) and the auto-collected integration
 * reports linked to a control through its automated checks
 * (control_checks.evidence_id) — one CSV can back several checks, so those are
 * de-duplicated per control.
 */
async function evidenceCounts(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Record<string, number>> {
  const [{ data: manual, error }, { data: checkRows }] = await Promise.all([
    supabase
      .from("evidence")
      .select("control_id")
      .eq("company_id", companyId)
      .not("control_id", "is", null),
    supabase
      .from("control_checks")
      .select("control_id, evidence_id")
      .eq("company_id", companyId)
      .not("evidence_id", "is", null),
  ]);
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of manual ?? []) {
    const cid = (row as any).control_id as string;
    counts[cid] = (counts[cid] ?? 0) + 1;
  }

  const seen: Record<string, Set<string>> = {};
  for (const row of checkRows ?? []) {
    const cid = (row as any).control_id as string;
    (seen[cid] ??= new Set<string>()).add((row as any).evidence_id as string);
  }
  for (const [cid, set] of Object.entries(seen)) {
    counts[cid] = (counts[cid] ?? 0) + set.size;
  }
  return counts;
}

export async function getControlsWithStatus(
  supabase: SupabaseClient,
  companyId: string,
): Promise<ControlWithStatus[]> {
  const [{ data, error }, counts] = await Promise.all([
    supabase.from("control_status").select(CONTROL_SELECT).eq("company_id", companyId),
    evidenceCounts(supabase, companyId),
  ]);
  if (error) throw error;

  return (data ?? [])
    .map((row: any) => mapControlRow(row, counts[(row.controls as Control).id] ?? 0))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export async function getControlWithStatus(
  supabase: SupabaseClient,
  companyId: string,
  controlId: string,
): Promise<ControlWithStatus | null> {
  const { data, error } = await supabase
    .from("control_status")
    .select(CONTROL_SELECT)
    .eq("company_id", companyId)
    .eq("control_id", controlId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const [{ count }, { data: checkRows }] = await Promise.all([
    supabase
      .from("evidence")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("control_id", controlId),
    supabase
      .from("control_checks")
      .select("evidence_id")
      .eq("company_id", companyId)
      .eq("control_id", controlId)
      .not("evidence_id", "is", null),
  ]);
  // Distinct integration reports backing this control's checks count as evidence too.
  const integrationCount = new Set((checkRows ?? []).map((r: any) => r.evidence_id as string)).size;

  return mapControlRow(data, (count ?? 0) + integrationCount);
}

export async function setControlStatus(
  supabase: SupabaseClient,
  companyId: string,
  controlId: string,
  status: ControlStatus,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("control_status")
    .update({ status, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("company_id", companyId)
    .eq("control_id", controlId);
  if (error) throw error;
}

export async function setControlMeta(
  supabase: SupabaseClient,
  companyId: string,
  controlId: string,
  meta: { owner_email: string | null; due_date: string | null; notes: string | null },
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("control_status")
    .update({ ...meta, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("company_id", companyId)
    .eq("control_id", controlId);
  if (error) throw error;
}

export async function addFrameworkToCompany(
  supabase: SupabaseClient,
  companyId: string,
  frameworkId: string,
): Promise<void> {
  const { error } = await supabase.rpc("add_framework_to_company", {
    p_company_id: companyId,
    p_framework_id: frameworkId,
  });
  if (error) throw error;
}

export async function listSelectedFrameworkIds(
  supabase: SupabaseClient,
  companyId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("company_frameworks")
    .select("framework_id")
    .eq("company_id", companyId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.framework_id as string);
}

// ---------- Evidence ----------

export async function listEvidence(
  supabase: SupabaseClient,
  companyId: string,
  controlId: string,
): Promise<Evidence[]> {
  // Manually uploaded evidence attached directly to this control.
  const { data, error } = await supabase
    .from("evidence")
    .select("*")
    .eq("company_id", companyId)
    .eq("control_id", controlId)
    .order("created_at", { ascending: false })
    .limit(200); // sanity cap — keeps a runaway control page renderable
  if (error) throw error;

  // Auto-collected integration reports linked to this control through its
  // automated checks. The CSV is filed with control_id=null, so the link lives in
  // control_checks.evidence_id; one report can back several checks → dedupe.
  const { data: checkRows } = await supabase
    .from("control_checks")
    .select("evidence_id")
    .eq("company_id", companyId)
    .eq("control_id", controlId)
    .not("evidence_id", "is", null);
  const ids = [...new Set((checkRows ?? []).map((r: any) => r.evidence_id as string))];

  let integration: Evidence[] = [];
  if (ids.length > 0) {
    const { data: ev } = await supabase
      .from("evidence")
      .select("*")
      .eq("company_id", companyId)
      .in("id", ids);
    integration = (ev ?? []) as Evidence[];
  }

  const manualList = ((data ?? []) as Evidence[]).map((e) => ({ ...e, source: "manual" as const }));
  const integrationList = integration.map((e) => ({ ...e, source: "integration" as const }));
  return [...manualList, ...integrationList].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
}

export async function listAllEvidence(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Evidence[]> {
  const { data, error } = await supabase
    .from("evidence")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(500); // newest 500 — the vault stays fast even for heavy uploaders
  if (error) throw error;
  return (data ?? []) as Evidence[];
}

// ---------- Policies ----------

export async function listPolicies(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Policy[]> {
  const { data, error } = await supabase
    .from("policies")
    .select("*")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Policy[];
}

export interface PolicyAck {
  policy_id: string;
  version: number;
  user_id: string;
}

/** Every acknowledgement row for a company (the policies page derives per-policy
 * "N of M acknowledged" + whether the current user has acknowledged). */
export async function listPolicyAcknowledgements(
  supabase: SupabaseClient,
  companyId: string,
): Promise<PolicyAck[]> {
  const { data, error } = await supabase
    .from("policy_acknowledgements")
    .select("policy_id, version, user_id")
    .eq("company_id", companyId);
  if (error) throw error;
  return (data ?? []) as PolicyAck[];
}

/** Number of people on the team — the denominator for policy acknowledgement. */
export async function getCompanyMemberCount(
  supabase: SupabaseClient,
  companyId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("company_members")
    .select("user_id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if (error) return 0;
  return count ?? 0;
}

export async function getPolicy(
  supabase: SupabaseClient,
  companyId: string,
  policyId: string,
): Promise<Policy | null> {
  const { data, error } = await supabase
    .from("policies")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", policyId)
    .maybeSingle();
  if (error) throw error;
  return (data as Policy) ?? null;
}

// ---------- Vendors ----------

export type VendorRisk = "low" | "medium" | "high" | "critical";
export type VendorStatus = "active" | "under_review" | "offboarded";

export type VendorSoc2Status = "none" | "requested" | "on_file";
export type VendorDataSensitivity = "none" | "internal" | "pii" | "phi";

export interface Vendor {
  id: string;
  company_id: string;
  name: string;
  website: string | null;
  category: string | null;
  risk_level: VendorRisk;
  status: VendorStatus;
  notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  contact_email: string | null;
  review_cadence_months: number | null;
  soc2_status: VendorSoc2Status;
  soc2_expires_at: string | null;
  data_sensitivity: VendorDataSensitivity;
}

export async function listVendors(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Vendor[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as Vendor[];
}

// ---------- Risks ----------

export type RiskLevel = "low" | "medium" | "high";
export type RiskStatus = "open" | "mitigating" | "accepted" | "closed";

export interface Risk {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  category: string | null;
  likelihood: RiskLevel; // inherent (pre-mitigation)
  impact: RiskLevel; // inherent (pre-mitigation)
  residual_likelihood: RiskLevel | null; // post-mitigation (optional)
  residual_impact: RiskLevel | null; // post-mitigation (optional)
  status: RiskStatus;
  owner_email: string | null;
  treatment: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export async function listRisks(supabase: SupabaseClient, companyId: string): Promise<Risk[]> {
  const { data, error } = await supabase
    .from("risks")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as Risk[];
}

export interface RiskControlLink {
  risk_id: string;
  control_id: string;
}

/** All risk→control links for a company (the risk page maps these to control codes). */
export async function listRiskControlLinks(
  supabase: SupabaseClient,
  companyId: string,
): Promise<RiskControlLink[]> {
  const { data, error } = await supabase
    .from("risk_controls")
    .select("risk_id, control_id")
    .eq("company_id", companyId);
  if (error) throw error;
  return (data ?? []) as RiskControlLink[];
}

// ---------- Training ----------

export type TrainingStatus = "assigned" | "in_progress" | "completed";

export interface TrainingRecord {
  id: string;
  company_id: string;
  person_name: string;
  person_email: string | null;
  course: string;
  status: TrainingStatus;
  assigned_date: string | null;
  due_date: string | null;
  completed_date: string | null;
  created_at: string;
}

export async function listTraining(
  supabase: SupabaseClient,
  companyId: string,
): Promise<TrainingRecord[]> {
  const { data, error } = await supabase
    .from("training_records")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as TrainingRecord[];
}

// ---------- Subscriptions ----------

export interface Subscription {
  company_id: string;
  plan: "starter" | "growth";
  status: string;
  current_period_end: string | null;
}

export async function getSubscription(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("company_id, plan, status, current_period_end")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return (data as Subscription) ?? null;
}

// ---------- Integrations ----------

export type IntegrationProvider =
  | "google_workspace"
  | "github"
  | "slack"
  | "aws"
  | "okta"
  | "jira"
  | "gitlab"
  | "linear"
  | "cloudflare"
  | "gcp";

export interface Integration {
  id: string;
  company_id: string;
  provider: IntegrationProvider;
  status: "connected" | "error" | "disconnected";
  token_expires_at: string | null;
  last_synced_at: string | null;
  // Arbitrary JSON blob — e.g. { login: "octocat" } for GitHub OAuth.
  metadata: Record<string, unknown> | null;
}

/**
 * All integration rows for the catalog page in one query. Deliberately selects
 * only non-secret columns — tokens/webhook URLs must never reach page props.
 */
export async function listIntegrations(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Integration[]> {
  const { data, error } = await supabase
    .from("integrations")
    .select("id, company_id, provider, status, token_expires_at, last_synced_at, metadata")
    .eq("company_id", companyId);
  if (error) throw error;
  return (data as Integration[]) ?? [];
}

export async function getIntegration(
  supabase: SupabaseClient,
  companyId: string,
  provider: string,
): Promise<Integration | null> {
  const { data, error } = await supabase
    .from("integrations")
    .select("id, company_id, provider, status, token_expires_at, last_synced_at, metadata")
    .eq("company_id", companyId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;
  return (data as Integration) ?? null;
}

// ---------- Control checks (continuous monitoring) ----------

export interface ControlCheck {
  id: string;
  company_id: string;
  control_id: string;
  check_key: string;
  provider: string;
  result: "pass" | "fail" | "inconclusive";
  detail: string | null;
  evidence_id: string | null;
  evaluated_at: string;
}

/** All automated check results for a company (dashboard summary + alerts). */
export async function getControlChecks(
  supabase: SupabaseClient,
  companyId: string,
): Promise<ControlCheck[]> {
  const { data, error } = await supabase
    .from("control_checks")
    .select("*")
    .eq("company_id", companyId);
  if (error) throw error;
  return (data ?? []) as ControlCheck[];
}

/** Automated check results for one control (control detail page). */
export async function getChecksForControl(
  supabase: SupabaseClient,
  companyId: string,
  controlId: string,
): Promise<ControlCheck[]> {
  const { data, error } = await supabase
    .from("control_checks")
    .select("*")
    .eq("company_id", companyId)
    .eq("control_id", controlId)
    .order("check_key");
  if (error) throw error;
  return (data ?? []) as ControlCheck[];
}

// ---------- Co-pilot ----------

export async function listCopilotMessages(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
  limit = 50,
): Promise<CopilotMessage[]> {
  const { data, error } = await supabase
    .from("copilot_messages")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as CopilotMessage[]).reverse();
}

// ---------- Audit log / activity trail ----------

export interface AuditEvent {
  id: string;
  company_id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Newest-first activity for a company. Optionally narrowed to one target_type
 * (the /activity filter chips). RLS scopes this to the caller's company; the
 * 200 cap keeps the feed fast for heavy workspaces.
 */
export async function listAuditEvents(
  supabase: SupabaseClient,
  companyId: string,
  opts: { targetType?: string; limit?: number } = {},
): Promise<AuditEvent[]> {
  let query = supabase
    .from("audit_events")
    .select("*")
    .eq("company_id", companyId);

  if (opts.targetType) query = query.eq("target_type", opts.targetType);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (error) throw error;
  return (data ?? []) as AuditEvent[];
}

// ---------- Notifications ----------

export interface Notification {
  id: string;
  company_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPref {
  type: string;
  email_enabled: boolean;
  in_app_enabled: boolean;
}

/** Newest-first notifications for the caller in a company. RLS already restricts
 * rows to the signed-in user; the company filter keeps it scoped to this workspace. */
export async function listNotifications(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
  limit = 50,
): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Notification[];
}

/** Unread count for the bell badge. Best-effort: returns 0 on any error so the
 * shell never crashes over a notification read. */
export async function countUnreadNotifications(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}

/** The caller's per-category delivery preferences (missing row = opted in). */
export async function listNotificationPrefs(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<NotificationPref[]> {
  const { data, error } = await supabase
    .from("notification_prefs")
    .select("type, email_enabled, in_app_enabled")
    .eq("user_id", userId)
    .eq("company_id", companyId);
  if (error) throw error;
  return (data ?? []) as NotificationPref[];
}

// ---------- Security questionnaires ----------

export type QuestionnaireItemStatus = "draft" | "needs_review" | "approved";

export interface Questionnaire {
  id: string;
  company_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
}

export interface QuestionnaireItem {
  id: string;
  questionnaire_id: string;
  company_id: string;
  position: number;
  question: string;
  answer: string | null;
  status: QuestionnaireItemStatus;
  created_at: string;
}

export async function listQuestionnaires(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Questionnaire[]> {
  const { data, error } = await supabase
    .from("questionnaires")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as Questionnaire[];
}

/** All items across a company's questionnaires (the workspace groups by questionnaire). */
export async function listQuestionnaireItems(
  supabase: SupabaseClient,
  companyId: string,
): Promise<QuestionnaireItem[]> {
  const { data, error } = await supabase
    .from("questionnaire_items")
    .select("*")
    .eq("company_id", companyId)
    .order("position", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as QuestionnaireItem[];
}

// ---------- Access reviews ----------

export type AccessReviewStatus = "open" | "completed";
export type AccessDecision = "pending" | "keep" | "revoke";

export interface AccessReview {
  id: string;
  company_id: string;
  name: string;
  source: string | null;
  reviewer_email: string | null;
  status: AccessReviewStatus;
  started_at: string;
  completed_at: string | null;
  evidence_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AccessReviewItem {
  id: string;
  review_id: string;
  company_id: string;
  subject: string;
  access: string | null;
  decision: AccessDecision;
  note: string | null;
  decided_at: string | null;
}

export async function listAccessReviews(
  supabase: SupabaseClient,
  companyId: string,
): Promise<AccessReview[]> {
  const { data, error } = await supabase
    .from("access_reviews")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as AccessReview[];
}

export async function listAccessReviewItems(
  supabase: SupabaseClient,
  companyId: string,
): Promise<AccessReviewItem[]> {
  const { data, error } = await supabase
    .from("access_review_items")
    .select("*")
    .eq("company_id", companyId)
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as AccessReviewItem[];
}

// ---------- Trust Center depth ----------

export interface Subprocessor {
  id: string;
  company_id: string;
  name: string;
  purpose: string | null;
  location: string | null;
  url: string | null;
  created_at: string;
}

export type TrustRequestStatus = "new" | "approved" | "declined";

export interface TrustAccessRequest {
  id: string;
  company_id: string;
  email: string;
  name: string | null;
  requester_company: string | null;
  message: string | null;
  status: TrustRequestStatus;
  created_at: string;
}

export async function listSubprocessors(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Subprocessor[]> {
  const { data, error } = await supabase
    .from("subprocessors")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Subprocessor[];
}

export async function listTrustAccessRequests(
  supabase: SupabaseClient,
  companyId: string,
): Promise<TrustAccessRequest[]> {
  const { data, error } = await supabase
    .from("trust_access_requests")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as TrustAccessRequest[];
}

// ---------- Personnel roster ----------

export type PersonnelStatus = "active" | "offboarded";

export interface Person {
  id: string;
  company_id: string;
  name: string;
  email: string | null;
  role_title: string | null;
  status: PersonnelStatus;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export async function listPersonnel(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Person[]> {
  const { data, error } = await supabase
    .from("personnel")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as Person[];
}

// ---------- SSO domains ----------

export interface SsoDomain {
  id: string;
  company_id: string;
  domain: string;
  verified: boolean;
  created_at: string;
}

export async function listSsoDomains(
  supabase: SupabaseClient,
  companyId: string,
): Promise<SsoDomain[]> {
  const { data, error } = await supabase
    .from("company_sso_domains")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SsoDomain[];
}

// ---------- Tasks ----------

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";
export type TaskRecurrence = "none" | "weekly" | "monthly" | "quarterly" | "annually";

export interface Task {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  assignee_email: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  recurrence: TaskRecurrence;
  linked_type: string | null;
  linked_id: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

/** Company tasks, soonest due first (no due date last), newest as tiebreaker. The
 * UI separates done from active. */
export async function listTasks(supabase: SupabaseClient, companyId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("company_id", companyId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Task[];
}
