"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { RosterProviderInfo } from "@/app/actions/access-reviews";

export interface DraftSystem {
  key: string; // client-only stable key, not a DB id yet
  name: string;
  provider: string | null; // set only for integration-backed systems
}

export function SystemPicker({
  rosterProviders,
  systems,
  onToggleProvider,
  onAddCustom,
  onRemove,
}: {
  rosterProviders: RosterProviderInfo[];
  systems: DraftSystem[];
  onToggleProvider: (p: RosterProviderInfo) => void;
  onAddCustom: (name: string) => void;
  onRemove: (key: string) => void;
}) {
  const [customName, setCustomName] = useState("");

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    onAddCustom(name);
    setCustomName("");
  }

  const isProviderChosen = (p: RosterProviderInfo) => systems.some((s) => s.provider === p.provider);

  return (
    <div className="space-y-3">
      {rosterProviders.length > 0 && (
        <div className="space-y-1 rounded-md border border-border p-2">
          {rosterProviders.map((p) => (
            <label key={p.provider} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isProviderChosen(p)} onChange={() => onToggleProvider(p)} />
              <span>{p.label}</span>
              <span className="text-xs text-muted-foreground">Connected — roster auto-pulls</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={customName}
          maxLength={120}
          placeholder="Add a system, e.g. GitHub, AWS, Salesforce"
          onChange={(e) => setCustomName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={addCustom} leftIcon={<Plus className="h-4 w-4" />}>
          Add
        </Button>
      </div>

      {systems.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {systems.map((s) => (
            <li
              key={s.key}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs"
            >
              {s.name}
              <button
                type="button"
                onClick={() => onRemove(s.key)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
