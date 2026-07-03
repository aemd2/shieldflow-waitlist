export { FeedLayout } from "./FeedLayout";
export { ManagerLayout } from "./ManagerLayout";
export {
  WorkspaceLayout,
  SidebarListPanel,
  SidebarListButton,
  WorkspaceDetailEmpty,
} from "./WorkspaceLayout";
export { StackLayout } from "./StackLayout";
export { OverviewLayout } from "./OverviewLayout";
export { SectionsLayout } from "./SectionsLayout";

/** Named page layout variants — pick one per route for a consistent shell. */
export type PageLayoutVariant =
  | "feed" // Activity, Evidence, Notifications
  | "manager" // Tasks, Vendors, Risks, Training, Personnel
  | "workspace" // Policies, Questionnaires, Access reviews
  | "stack" // Settings, Billing, Getting started
  | "overview" // Dashboard
  | "sections"; // Integrations
