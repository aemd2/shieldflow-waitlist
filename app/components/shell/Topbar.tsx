import { signOut } from "@/app/actions/auth";
import { MobileNav } from "./MobileNav";

export function Topbar({
  email,
  companyName,
  readOnly,
}: {
  email: string;
  companyName?: string;
  readOnly?: boolean;
}) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3 print:hidden">
      <div className="flex min-w-0 items-center gap-2">
        {companyName && <MobileNav companyName={companyName} />}
        <div className="truncate text-sm text-muted-foreground">{email}</div>
        {readOnly && (
          <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
            Read-only · Auditor
          </span>
        )}
      </div>
      <form action={signOut}>
        <button type="submit" className="btn-outline text-xs">Sign out</button>
      </form>
    </header>
  );
}
