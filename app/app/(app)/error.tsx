"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="text-xl font-semibold text-foreground">Couldn&apos;t load this page</div>
      <p className="max-w-md text-sm text-muted-foreground">
        Something went wrong fetching your data. This is often temporary.
      </p>
      <button onClick={reset} className="btn-primary">Try again</button>
    </div>
  );
}
