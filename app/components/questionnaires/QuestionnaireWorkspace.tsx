"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, Download, Trash2, Save } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import {
  WorkspaceLayout,
  SidebarListPanel,
  SidebarListButton,
  WorkspaceDetailEmpty,
} from "@/components/ui/layouts";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  createQuestionnaire,
  saveQuestionnaireItem,
  deleteQuestionnaire,
} from "@/app/actions/questionnaires";
import type {
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireItemStatus,
} from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

const STATUS: Record<QuestionnaireItemStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Draft", variant: "neutral" },
  needs_review: { label: "Needs review", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
};

function exportCsv(name: string, items: QuestionnaireItem[]) {
  const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["Question", "Answer", "Status"],
    ...items.map((it) => [it.question, it.answer ?? "", it.status]),
  ];
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\w.-]+/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function QuestionnaireWorkspace({
  questionnaires,
  items,
  aiEnabled,
  canWrite = true,
}: {
  questionnaires: Questionnaire[];
  items: QuestionnaireItem[];
  aiEnabled: boolean;
  canWrite?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [drafting, setDrafting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [questionsText, setQuestionsText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(questionnaires[0]?.id ?? null);

  const selected = questionnaires.find((q) => q.id === selectedId) ?? null;
  const itemsFor = (qId: string) =>
    items.filter((it) => it.questionnaire_id === qId).sort((a, b) => a.position - b.position);

  function create() {
    const questions = questionsText.split("\n").map((q) => q.trim()).filter(Boolean);
    if (name.trim().length < 2) return toast("error", "Give the questionnaire a name.");
    if (questions.length === 0) return toast("error", "Paste at least one question (one per line).");
    start(async () => {
      const res = await createQuestionnaire({ name, questions }).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      toast("success", "Questionnaire created");
      setName("");
      setQuestionsText("");
      setCreating(false);
      if ("id" in res && res.id) setSelectedId(res.id);
      router.refresh();
    });
  }

  function draftWithAI() {
    if (!selected) return;
    setDrafting(true);
    (async () => {
      try {
        const res = await fetch("/api/questionnaire", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionnaireId: selected.id }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = "/login?reason=expired";
            return;
          }
          toast("error", data.error ?? "Drafting failed.");
          return;
        }
        toast("success", `Drafted ${data.drafted} answer${data.drafted === 1 ? "" : "s"}`);
        router.refresh();
      } catch {
        toast("error", NETWORK);
      } finally {
        setDrafting(false);
      }
    })();
  }

  function removeQuestionnaire(id: string) {
    start(async () => {
      const ok = await confirm({
        title: "Delete questionnaire",
        message: "This removes the questionnaire and its questions. This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const res = await deleteQuestionnaire(id).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      toast("success", "Deleted");
      if (selectedId === id) setSelectedId(null);
      router.refresh();
    });
  }

  const selItems = selected ? itemsFor(selected.id) : [];
  const answered = selItems.filter((it) => it.answer && it.answer.trim()).length;
  const needsReview = selItems.filter((it) => it.status === "needs_review").length;

  return (
    <WorkspaceLayout
      sidebar={
        <>
          {canWrite && (
            <Button variant="accent" fullWidth onClick={() => setCreating((v) => !v)} leftIcon={<Plus className="h-4 w-4" />}>
              New questionnaire
            </Button>
          )}

          {creating && canWrite && (
            <div className="card space-y-3">
              <Field label="Name" required>
                <Input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Corp security review" />
              </Field>
              <Field label="Questions" hint="One per line.">
                <Textarea rows={6} value={questionsText} onChange={(e) => setQuestionsText(e.target.value)} placeholder={"Do you encrypt data at rest?\nDo you enforce MFA?\n..."} />
              </Field>
              <Button onClick={create} loading={pending} fullWidth>Create</Button>
            </div>
          )}

          <SidebarListPanel title={`Questionnaires (${questionnaires.length})`} isEmpty={questionnaires.length === 0}>
            {questionnaires.map((q) => {
              const its = itemsFor(q.id);
              const ans = its.filter((it) => it.answer && it.answer.trim()).length;
              return (
                <SidebarListButton key={q.id} selected={selectedId === q.id} onClick={() => setSelectedId(q.id)}>
                  <span className="min-w-0 truncate">{q.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ans}/{its.length}</span>
                </SidebarListButton>
              );
            })}
          </SidebarListPanel>
        </>
      }
    >
      {selected ? (
          <div className="space-y-4">
            <div className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{selected.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {answered}/{selItems.length} answered
                  {needsReview > 0 && <> · <span className="text-warning">{needsReview} need review</span></>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canWrite && (
                  <Button onClick={draftWithAI} loading={drafting} disabled={!aiEnabled} leftIcon={<Sparkles className="h-4 w-4" />}>
                    Draft with AI
                  </Button>
                )}
                <Button variant="outline" onClick={() => exportCsv(selected.name, selItems)} leftIcon={<Download className="h-4 w-4" />}>
                  Export CSV
                </Button>
                {canWrite && (
                  <button onClick={() => removeQuestionnaire(selected.id)} disabled={pending} className="rounded-md p-2 text-destructive hover:bg-destructive/10" title="Delete questionnaire">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {!aiEnabled && (
              <Alert variant="warning">
                Add a <code>GROQ_API_KEY</code> to enable AI drafting. You can still answer manually.
              </Alert>
            )}

            <div className="space-y-3">
              {selItems.map((it) => (
                <QItemRow key={it.id} item={it} canWrite={canWrite} />
              ))}
            </div>
          </div>
        ) : (
          <WorkspaceDetailEmpty>
            Select a questionnaire, or create one from a pasted list of questions.
          </WorkspaceDetailEmpty>
        )}
    </WorkspaceLayout>
  );
}

function QItemRow({ item, canWrite }: { item: QuestionnaireItem; canWrite: boolean }) {
  const toast = useToast();
  const [answer, setAnswer] = useState(item.answer ?? "");
  const [status, setStatus] = useState<QuestionnaireItemStatus>(item.status);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await saveQuestionnaireItem({ id: item.id, answer, status }).catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else toast("success", "Saved");
    });
  }

  return (
    <div className="card space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{item.question}</p>
        <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>
      </div>
      {canWrite ? (
        <>
          <Textarea rows={3} maxLength={5000} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer (or click Draft with AI above)…" />
          <div className="flex items-center justify-between">
            <Select value={status} onChange={(e) => setStatus(e.target.value as QuestionnaireItemStatus)} className="w-auto py-1.5">
              <option value="draft">Draft</option>
              <option value="needs_review">Needs review</option>
              <option value="approved">Approved</option>
            </Select>
            <Button onClick={save} loading={pending} leftIcon={<Save className="h-4 w-4" />}>Save</Button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{answer || "—"}</p>
      )}
    </div>
  );
}
