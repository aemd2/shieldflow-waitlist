/**
 * "Scene zero" for the recordings: the state the workspace must be in before a
 * take. Clips 1 and 2 change it on camera (a measure gets completed, NIS2 gets
 * added), so every take restores it first — otherwise a second take would show
 * nothing moving, because progress in this product only ever advances.
 *
 *   npx tsx scripts/recording/scene.ts save      (once, after seeding)
 *   npx tsx scripts/recording/scene.ts restore   (the recorder does this itself)
 *
 * The snapshot lives in recordings/ (git-ignored): it holds this workspace's row
 * ids, which have no business in a public repo.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

const SNAP = path.resolve(process.cwd(), "..", "recordings", ".scene.json");

/** Anything the clips create by name, removed on restore. */
export const CLIP_QUESTIONNAIRE = "Munich customer — supplier assessment";

type Scene = {
  companyId: string;
  frameworks: string[];
  controls: { control_id: string; status: string }[];
  measures: { measure_id: string; status: string; notes: string | null }[];
  /** Row ids that existed at save time. Anything newer was made by a clip. */
  accessReviews?: string[];
  policies?: string[];
  copilotMessages?: string[];
  evidence?: string[];
};

async function admin(): Promise<SupabaseClient> {
  const { createAdminSupabase } = await import("@/lib/supabase/admin");
  return createAdminSupabase();
}

export async function recordingCompanyId(db: SupabaseClient): Promise<string> {
  const email = process.env.RECORDING_EMAIL;
  if (!email) throw new Error("Set RECORDING_EMAIL in .env.local");
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const user = users?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No user for ${email}`);
  const { data } = await db
    .from("company_members").select("company_id").eq("user_id", user.id).eq("role", "owner").single();
  return data!.company_id as string;
}

export async function saveScene() {
  const db = await admin();
  const companyId = await recordingCompanyId(db);
  const [fw, cs, ms, ar, po, cm, ev] = await Promise.all([
    db.from("company_frameworks").select("framework_id").eq("company_id", companyId),
    db.from("control_status").select("control_id, status").eq("company_id", companyId),
    db.from("measure_status").select("measure_id, status, notes").eq("company_id", companyId),
    db.from("access_reviews").select("id").eq("company_id", companyId),
    db.from("policies").select("id").eq("company_id", companyId),
    db.from("copilot_messages").select("id").eq("company_id", companyId),
    db.from("evidence").select("id").eq("company_id", companyId),
  ]);
  const ids = (r: { data: { id: unknown }[] | null }) => (r.data ?? []).map((x) => x.id as string);
  const scene: Scene = {
    companyId,
    frameworks: (fw.data ?? []).map((r) => r.framework_id as string),
    controls: (cs.data ?? []) as Scene["controls"],
    measures: (ms.data ?? []) as Scene["measures"],
    accessReviews: ids(ar),
    policies: ids(po),
    copilotMessages: ids(cm),
    evidence: ids(ev),
  };
  mkdirSync(path.dirname(SNAP), { recursive: true });
  writeFileSync(SNAP, JSON.stringify(scene));
  console.log(`scene saved: ${scene.frameworks.length} frameworks, ${scene.controls.length} controls, ${scene.measures.length} measures`);
}

export async function restoreScene() {
  if (!existsSync(SNAP)) throw new Error("No scene saved — run `scene.ts save` first");
  const scene = JSON.parse(readFileSync(SNAP, "utf8")) as Scene;
  const db = await admin();
  const { companyId } = scene;

  // Access reviews a clip completed: the review, the evidence CSV it filed, and
  // the cadence check it turned green. First, so the check is back to its old
  // verdict before statuses are restored below.
  const { data: reviewsNow } = await db.from("access_reviews").select("id, evidence_id").eq("company_id", companyId);
  // A snapshot from before these lists existed has no record of them: touch nothing.
  const newReviews = scene.accessReviews
    ? (reviewsNow ?? []).filter((r) => !scene.accessReviews!.includes(r.id as string))
    : [];
  if (newReviews.length) {
    const evidenceIds = newReviews.map((r) => r.evidence_id as string | null).filter((x): x is string => !!x);
    await db.from("access_reviews").delete().in("id", newReviews.map((r) => r.id as string));
    if (evidenceIds.length) {
      const { data: files } = await db.from("evidence").select("storage_path").in("id", evidenceIds);
      await db.storage.from("evidence").remove((files ?? []).map((f) => f.storage_path as string));
      await db.from("evidence").delete().in("id", evidenceIds);
    }
    const { recordInternalChecks } = await import("@/lib/checks");
    await recordInternalChecks(db, companyId, { admin: true });
  }

  // Policies generated and chats started on camera.
  const dropNew = async (table: string, keep: string[] | undefined) => {
    if (!keep) return;
    const { data } = await db.from(table).select("id").eq("company_id", companyId);
    const extra = (data ?? []).map((r) => r.id as string).filter((id) => !keep.includes(id));
    if (extra.length) await db.from(table).delete().in("id", extra);
  };
  await dropNew("policies", scene.policies);
  await dropNew("copilot_messages", scene.copilotMessages);

  // Files uploaded on camera (clip 11 attaches one to a measure): row and object.
  if (scene.evidence) {
    const { data: evNow } = await db.from("evidence").select("id, storage_path").eq("company_id", companyId);
    const extra = (evNow ?? []).filter((e) => !scene.evidence!.includes(e.id as string));
    if (extra.length) {
      await db.storage.from("evidence").remove(extra.map((e) => e.storage_path as string));
      await db.from("evidence").delete().in("id", extra.map((e) => e.id as string));
    }
  }

  // Frameworks added on camera (NIS2), and their requirements.
  const { data: fwNow } = await db.from("company_frameworks").select("framework_id").eq("company_id", companyId);
  const extraFw = (fwNow ?? []).map((r) => r.framework_id as string).filter((id) => !scene.frameworks.includes(id));
  if (extraFw.length) {
    const { data: extraControls } = await db.from("controls").select("id").in("framework_id", extraFw);
    const ids = (extraControls ?? []).map((c) => c.id as string);
    if (ids.length) await db.from("control_status").delete().eq("company_id", companyId).in("control_id", ids);
    await db.from("company_frameworks").delete().eq("company_id", companyId).in("framework_id", extraFw);
  }

  // Requirement statuses back to exactly what they were.
  await db.from("control_status").upsert(
    scene.controls.map((c) => ({ company_id: companyId, control_id: c.control_id, status: c.status })),
    { onConflict: "company_id,control_id" },
  );

  // Measures: drop any completed on camera, reset the rest.
  const { data: msNow } = await db.from("measure_status").select("measure_id").eq("company_id", companyId);
  const keep = new Set(scene.measures.map((m) => m.measure_id));
  const extraMs = (msNow ?? []).map((r) => r.measure_id as string).filter((id) => !keep.has(id));
  if (extraMs.length) await db.from("measure_status").delete().eq("company_id", companyId).in("measure_id", extraMs);
  if (scene.measures.length) {
    await db.from("measure_status").upsert(
      scene.measures.map((m) => ({ company_id: companyId, measure_id: m.measure_id, status: m.status, notes: m.notes })),
      { onConflict: "company_id,measure_id" },
    );
  }

  // Anything a clip created.
  await db.from("questionnaires").delete().eq("company_id", companyId).eq("name", CLIP_QUESTIONNAIRE);
}

if (require.main === module) {
  const cmd = process.argv[2];
  (cmd === "save" ? saveScene() : cmd === "restore" ? restoreScene().then(() => console.log("scene restored")) : Promise.reject(new Error("save | restore")))
    .catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
