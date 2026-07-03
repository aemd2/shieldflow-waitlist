"use client";

import { MessageSquare } from "lucide-react";
import { useCopilotPanel } from "./CopilotPanelProvider";

export function CopilotTriggerButton() {
  const { toggle } = useCopilotPanel();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Open Co-Pilot"
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <MessageSquare className="h-5 w-5" />
    </button>
  );
}
