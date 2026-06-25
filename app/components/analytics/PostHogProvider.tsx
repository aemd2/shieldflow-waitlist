"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Lightweight PostHog wiring: initializes only when NEXT_PUBLIC_POSTHOG_KEY is
// set, captures pageviews on route changes, and is a complete no-op otherwise.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    import("posthog-js").then(({ default: posthog }) => {
      if (!posthog.__loaded) {
        posthog.init(key, {
          api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
          capture_pageview: false, // we capture manually on route change below
          persistence: "localStorage",
        });
      }
    });
  }, []);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    import("posthog-js").then(({ default: posthog }) => {
      if (posthog.__loaded) posthog.capture("$pageview");
    });
  }, [pathname]);

  return <>{children}</>;
}
