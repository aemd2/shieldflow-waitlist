"use client";

// Reads ?error= and ?connected= from the URL after an OAuth callback redirect
// and shows the appropriate toast. Cleans the param from the URL so a reload
// doesn't re-fire the toast.

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

const ERROR_MESSAGES: Record<string, string> = {
  encryption_not_configured:
    "Encryption isn't configured on the server — secrets can't be stored securely yet. Set SHIELDFLOW_ENCRYPTION_KEY and try again.",
  denied:
    "Access was denied — nothing was connected.",
  state_mismatch:
    "Security check failed — please try connecting again.",
  exchange_failed:
    "Connection failed — please try again.",
  not_configured:
    "This integration isn't configured yet.",
  db:
    "A database error occurred — please try again.",
};

const CONNECTED_MESSAGES: Record<string, string> = {
  github: "GitHub connected",
  google: "Google Workspace connected",
  slack: "Slack connected",
};

export function IntegrationsUrlToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    const error = searchParams.get("error");
    const connected = searchParams.get("connected");

    if (error) {
      toast("error", ERROR_MESSAGES[error] ?? `Connection error: ${error}`);
    } else if (connected) {
      toast("success", CONNECTED_MESSAGES[connected] ?? `${connected} connected`);
    }

    // Clean the param from the URL so a reload doesn't re-fire.
    if (error || connected) {
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      url.searchParams.delete("connected");
      router.replace(url.pathname + (url.search || ""), { scroll: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
