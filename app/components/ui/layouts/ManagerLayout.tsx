/**
 * CRUD list pages — Tasks, Vendors, Risks, Training, Personnel.
 * Primary action aligned top-right; form + list below.
 */
export function ManagerLayout({
  toolbar,
  children,
}: {
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {toolbar ? <div className="flex justify-end">{toolbar}</div> : null}
      {children}
    </div>
  );
}
