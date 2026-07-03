"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { CopilotPanel } from "./CopilotPanel";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface CopilotPanelContext {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const Ctx = createContext<CopilotPanelContext | null>(null);

export function useCopilotPanel() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCopilotPanel must be used within CopilotPanelProvider");
  return ctx;
}

/**
 * Mounts the Co-Pilot chat once at the app-shell level so it survives page
 * navigation (in-flight streams and draft input aren't lost when the panel
 * closes) — the Sidebar nav item and the Topbar trigger both toggle the same
 * instance via useCopilotPanel().
 */
export function CopilotPanelProvider({
  initialMessages,
  aiEnabled,
  children,
}: {
  initialMessages: Msg[];
  aiEnabled: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  const ctx: CopilotPanelContext = {
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((v) => !v),
  };

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <CopilotPanel open={isOpen} onClose={ctx.close} initialMessages={initialMessages} aiEnabled={aiEnabled} />
    </Ctx.Provider>
  );
}
