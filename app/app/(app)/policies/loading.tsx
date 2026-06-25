export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="h-64 animate-pulse rounded-lg bg-secondary" />
        <div className="h-80 animate-pulse rounded-lg bg-secondary" />
      </div>
    </div>
  );
}
