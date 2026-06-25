"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateControlMeta } from "@/app/actions/control-meta";
import { useToast } from "@/components/ui/Toast";

export function ControlMetaForm({
  controlId,
  ownerEmail,
  dueDate,
  notes,
}: {
  controlId: string;
  ownerEmail: string | null;
  dueDate: string | null;
  notes: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [owner, setOwner] = useState(ownerEmail ?? "");
  const [due, setDue] = useState(dueDate ?? "");
  const [note, setNote] = useState(notes ?? "");
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await updateControlMeta({
        controlId,
        owner_email: owner.trim(),
        due_date: due,
        notes: note.trim(),
      });
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "Saved");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Owner (email)</label>
          <input
            type="email"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="owner@company.com"
            className="input"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Due date</label>
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="input"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Notes</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Implementation notes, links, owner context..."
          className="input resize-y"
        />
      </div>
      <button onClick={save} disabled={pending} className="btn-outline">
        {pending ? "Saving..." : "Save details"}
      </button>
    </div>
  );
}
