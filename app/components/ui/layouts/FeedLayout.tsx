/**
 * Chronological list pages — Activity log, Evidence vault, Notifications.
 * Optional filter toolbar on top, pagination footer below.
 */
export function FeedLayout({
  toolbar,
  footer,
  children,
}: {
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {toolbar}
      {children}
      {footer}
    </div>
  );
}
