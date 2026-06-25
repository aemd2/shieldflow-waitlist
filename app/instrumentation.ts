// Server-side Sentry init. Entirely a no-op unless NEXT_PUBLIC_SENTRY_DSN is set.
export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
  });
}

export async function onRequestError(...args: unknown[]) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  // @ts-expect-error — Sentry's captureRequestError signature matches Next's hook.
  Sentry.captureRequestError(...args);
}
