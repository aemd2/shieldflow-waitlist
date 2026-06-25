"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-secondary px-4 text-center">
      <div className="text-2xl font-semibold text-foreground">Something went wrong</div>
      <p className="max-w-md text-sm text-muted-foreground">
        An unexpected error occurred. You can try again — if it keeps happening, please refresh.
      </p>
      <button onClick={reset} className="btn-primary">Try again</button>
    </div>
  );
}
