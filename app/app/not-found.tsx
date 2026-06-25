import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-secondary px-4 text-center">
      <div className="text-5xl font-bold text-foreground">404</div>
      <p className="text-muted-foreground">This page could not be found.</p>
      <Link href="/dashboard" className="btn-primary">Go to dashboard</Link>
    </div>
  );
}
