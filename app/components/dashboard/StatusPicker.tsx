"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateControlStatus } from "@/app/actions/controls";
import { Button } from "@/components/ui/Button";
import type { ControlStatus } from "@/lib/score";

const OPTIONS: { value: ControlStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "complete", label: "Complete" },
];

export function StatusPicker({
  controlId,
  current,
}: {
  controlId: string;
  current: ControlStatus;
}) {
  const router = useRouter();
  const [value, setValue] = useState<ControlStatus>(current);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(next: ControlStatus) {
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await updateControlStatus(controlId, next);
      if (result?.error) {
        setError(result.error);
        setValue(current);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            disabled={pending}
            onClick={() => onChange(opt.value)}
            variant={value === opt.value ? "accent" : "outline"}
          >
            {opt.label}
          </Button>
        ))}
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
