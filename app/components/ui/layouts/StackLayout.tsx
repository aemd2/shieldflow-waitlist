/**
 * Vertically stacked sections — Settings, Billing, Getting started.
 */
export function StackLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}
