"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { FormSection } from "@/components/ui/FormSection";
import { Input } from "@/components/ui/Input";
import { Typeahead } from "@/components/ui/Typeahead";
import { createAccessReview, type RosterProviderInfo } from "@/app/actions/access-reviews";
import { SystemPicker, type DraftSystem } from "./SystemPicker";
import { SystemRosterEditor, type DraftRosterRow, type PersonSuggestion } from "./SystemRosterEditor";

const NETWORK = "Network problem — check your connection and try again.";

function keyFor(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultReviewName(systemNames: string[]): string {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const scope = systemNames.length > 0 ? `${systemNames.join(" + ")} — ` : "";
  return `${scope}Q${quarter} ${now.getFullYear()} access review`;
}

export function AccessReviewCreateForm({
  rosterProviders,
  currentUserEmail,
  personnelSuggestions = [],
  onDone,
  onCreated,
}: {
  rosterProviders: RosterProviderInfo[];
  currentUserEmail: string;
  personnelSuggestions?: PersonSuggestion[];
  onDone: () => void;
  onCreated: (id: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [systems, setSystems] = useState<DraftSystem[]>([]);
  const [rosters, setRosters] = useState<Record<string, DraftRosterRow[]>>({});
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [reviewer, setReviewer] = useState(currentUserEmail);

  const displayName = useMemo(
    () => (nameTouched ? name : defaultReviewName(systems.map((s) => s.name))),
    [nameTouched, name, systems],
  );

  function toggleProvider(p: RosterProviderInfo) {
    setSystems((prev) => {
      const existing = prev.find((s) => s.provider === p.provider);
      if (existing) {
        setRosters((r) => {
          const { [existing.key]: _drop, ...rest } = r;
          return rest;
        });
        return prev.filter((s) => s.provider !== p.provider);
      }
      const key = keyFor();
      setRosters((r) => ({ ...r, [key]: [] }));
      return [...prev, { key, name: p.label, provider: p.provider }];
    });
  }

  function addCustom(customName: string) {
    const key = keyFor();
    setRosters((r) => ({ ...r, [key]: [] }));
    setSystems((prev) => [...prev, { key, name: customName, provider: null }]);
  }

  function removeSystem(key: string) {
    setSystems((prev) => prev.filter((s) => s.key !== key));
    setRosters((r) => {
      const { [key]: _drop, ...rest } = r;
      return rest;
    });
  }

  function submit() {
    const finalName = displayName.trim();
    if (finalName.length < 2) return toast("error", "Give the review a name.");
    if (systems.length === 0) return toast("error", "Pick or add at least one system.");
    const emptySystem = systems.find((s) => (rosters[s.key] ?? []).length === 0);
    if (emptySystem) return toast("error", `Add at least one account for ${emptySystem.name}.`);

    const payload = {
      name: finalName,
      reviewer_email: reviewer,
      systems: systems.map((s) => ({
        name: s.name,
        provider: s.provider ?? "",
        items: rosters[s.key] ?? [],
      })),
    };
    start(async () => {
      const res = await createAccessReview(payload).catch(() => ({ error: NETWORK }));
      if (res?.error) return toast("error", res.error);
      toast("success", "Access review created");
      onDone();
      if ("id" in res && res.id) onCreated(res.id);
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4">
      <h2 className="text-sm font-semibold text-foreground">New access review</h2>

      <FormSection label="In-scope systems" hint="Pick the connected systems this review covers, or add one that isn't integrated yet.">
        <SystemPicker
          rosterProviders={rosterProviders}
          systems={systems}
          onToggleProvider={toggleProvider}
          onAddCustom={addCustom}
          onRemove={removeSystem}
        />
      </FormSection>

      {systems.length > 0 && (
        <FormSection label="Accounts per system" hint="Pull the roster automatically, upload a filled-in CSV template, or paste a list.">
          <div className="space-y-3">
            {systems.map((s) => (
              <SystemRosterEditor
                key={s.key}
                systemName={s.name}
                provider={s.provider}
                rows={rosters[s.key] ?? []}
                onRowsChange={(rows) => setRosters((r) => ({ ...r, [s.key]: rows }))}
                suggestions={personnelSuggestions}
              />
            ))}
          </div>
        </FormSection>
      )}

      <FormSection label="Review details">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            <Input
              value={displayName}
              maxLength={160}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
            />
          </Field>
          <Field label="Reviewer">
            <Typeahead
              type="email"
              value={reviewer}
              onChange={setReviewer}
              onSelect={(o) => setReviewer(o.value)}
              options={[
                ...(currentUserEmail ? [{ value: currentUserEmail, label: `${currentUserEmail} (you)` }] : []),
                ...personnelSuggestions
                  .filter((p) => p.email !== currentUserEmail)
                  .map((p) => ({ value: p.email, label: p.name, sublabel: p.email })),
              ]}
              maxLength={254}
              placeholder="Start typing a name or email"
            />
          </Field>
        </div>
      </FormSection>

      <div className="flex gap-2">
        <Button onClick={submit} loading={pending}>Create review</Button>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
