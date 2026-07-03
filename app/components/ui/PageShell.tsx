import { AppPage, type AppPageWidth } from "./AppPage";
import { PageHeader } from "./PageHeader";
import {
  FeedLayout,
  StackLayout,
  OverviewLayout,
  SectionsLayout,
  type PageLayoutVariant,
} from "./layouts";

export type { PageLayoutVariant };

/**
 * One entry point per page: header + named layout variant + content.
 * Pick the variant that matches sibling pages (feed = Activity/Evidence, etc.).
 */
export function PageShell({
  layout = "stack",
  width = "full",
  title,
  subtitle,
  actions,
  banner,
  alert,
  toolbar,
  footer,
  headerClassName,
  className,
  children,
}: {
  layout?: PageLayoutVariant;
  width?: AppPageWidth;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  banner?: React.ReactNode;
  alert?: React.ReactNode;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  headerClassName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const body = wrapLayout(layout, toolbar, footer, children);

  return (
    <AppPage width={width} className={className}>
      {banner}
      <div className={headerClassName}>
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
      </div>
      {alert}
      {body}
    </AppPage>
  );
}

function wrapLayout(
  layout: PageLayoutVariant,
  toolbar: React.ReactNode,
  footer: React.ReactNode,
  children: React.ReactNode,
) {
  switch (layout) {
    case "feed":
      return (
        <FeedLayout toolbar={toolbar} footer={footer}>
          {children}
        </FeedLayout>
      );
    case "manager":
      // Toolbar + form + list live inside each manager component.
      return children;
    case "workspace":
      // Workspace grids live inside feature components (WorkspaceLayout).
      return children;
    case "overview":
      return <OverviewLayout>{children}</OverviewLayout>;
    case "sections":
      return <SectionsLayout>{children}</SectionsLayout>;
    case "stack":
    default:
      return <StackLayout>{children}</StackLayout>;
  }
}
