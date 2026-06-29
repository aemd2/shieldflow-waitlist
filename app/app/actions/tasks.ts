"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getCompanyTeam,
  assertCanWrite,
  type Company,
  type TaskRecurrence,
} from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { taskSchema } from "@/lib/validation";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

async function companyOrError(): Promise<
  | { company: Company; supabase: Awaited<ReturnType<typeof createServerSupabase>>; userId: string }
  | { error: string }
> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  try {
    const company = await getCompanyForUser(supabase, user.id);
    if (!company) return { error: "No company found." };
    const denied = await assertCanWrite(supabase, company.id, user.id);
    if (denied) return { error: denied };
    return { company, supabase, userId: user.id };
  } catch {
    return { error: DB_ERROR };
  }
}

function toRow(d: z.infer<typeof taskSchema>) {
  return {
    title: d.title,
    description: d.description || null,
    assignee_email: d.assignee_email || null,
    priority: d.priority,
    status: d.status,
    due_date: d.due_date || null,
    recurrence: d.recurrence,
  };
}

/** Advance a due date by one recurrence interval (from the due date, or today). */
function advanceDue(due: string | null, rec: TaskRecurrence): string | null {
  if (rec === "none") return null;
  const base = due ? new Date(`${due}T00:00:00Z`) : new Date();
  const d = new Date(base);
  if (rec === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (rec === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (rec === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else if (rec === "annually") d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** Notify a newly-assigned teammate (best-effort — never breaks the action). */
async function notifyAssignee(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  actorId: string,
  task: { title: string; assignee_email: string | null; due_date: string | null },
) {
  if (!task.assignee_email) return;
  try {
    const team = await getCompanyTeam(supabase, companyId);
    const member = team.members.find(
      (m) => m.email.toLowerCase() === task.assignee_email!.toLowerCase(),
    );
    if (member && member.user_id !== actorId) {
      await notify(supabase, companyId, [member.user_id], {
        type: "task",
        title: `Task assigned: ${task.title}`,
        body: task.due_date ? `Due ${task.due_date}.` : "No due date set.",
        link: "/tasks",
      });
    }
  } catch {
    // best-effort
  }
}

export async function createTask(input: unknown) {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid task data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const row = toRow(parsed.data);
  const { error } = await res.supabase
    .from("tasks")
    .insert({ company_id: res.company.id, created_by: res.userId, ...row });
  if (error) return { error: "Could not add the task. Please try again." };

  await logEvent(res.supabase, res.company.id, "task.created", {
    type: "task",
    label: parsed.data.title,
    metadata: { priority: parsed.data.priority, due_date: row.due_date },
  });
  await notifyAssignee(res.supabase, res.company.id, res.userId, row);

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateTask(id: string, input: unknown) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid task." };
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid task data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: prev } = await res.supabase
    .from("tasks")
    .select("assignee_email")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();
  const prevAssignee = (prev?.assignee_email as string | null) ?? null;

  const row = toRow(parsed.data);
  const { error } = await res.supabase
    .from("tasks")
    .update(row)
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not save the task. Please try again." };

  await logEvent(res.supabase, res.company.id, "task.updated", {
    type: "task",
    id,
    label: parsed.data.title,
    metadata: { status: parsed.data.status, priority: parsed.data.priority },
  });

  // Only ping the assignee if it actually changed to a (different) teammate.
  if (row.assignee_email && row.assignee_email.toLowerCase() !== (prevAssignee ?? "").toLowerCase()) {
    await notifyAssignee(res.supabase, res.company.id, res.userId, row);
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function completeTask(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid task." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: task } = await res.supabase
    .from("tasks")
    .select("title, description, assignee_email, priority, due_date, recurrence")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();
  if (!task) return { error: "Task not found." };

  const { error } = await res.supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not complete the task. Please try again." };

  await logEvent(res.supabase, res.company.id, "task.completed", {
    type: "task",
    id,
    label: task.title as string,
  });

  // A recurring task spawns its next instance on completion.
  const recurrence = (task.recurrence as TaskRecurrence) ?? "none";
  if (recurrence !== "none") {
    const nextDue = advanceDue((task.due_date as string | null) ?? null, recurrence);
    const next = {
      company_id: res.company.id,
      created_by: res.userId,
      title: task.title as string,
      description: (task.description as string | null) ?? null,
      assignee_email: (task.assignee_email as string | null) ?? null,
      priority: task.priority as string,
      status: "todo",
      due_date: nextDue,
      recurrence,
    };
    const { error: spawnErr } = await res.supabase.from("tasks").insert(next);
    if (!spawnErr) {
      await notifyAssignee(res.supabase, res.company.id, res.userId, {
        title: next.title,
        assignee_email: next.assignee_email,
        due_date: next.due_date,
      });
    }
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteTask(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid task." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: existing } = await res.supabase
    .from("tasks")
    .select("title")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await res.supabase
    .from("tasks")
    .delete()
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete the task." };

  await logEvent(res.supabase, res.company.id, "task.deleted", {
    type: "task",
    id,
    label: (existing?.title as string | undefined) ?? undefined,
  });

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { ok: true };
}
