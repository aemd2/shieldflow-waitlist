import {
  Rocket,
  LayoutDashboard,
  FileText,
  FileBarChart,
  MessageSquare,
  FolderArchive,
  Building2,
  Plug,
  CreditCard,
  Settings,
  ShieldAlert,
  GraduationCap,
  History,
  ListChecks,
  ClipboardList,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

// Single source of truth for the app navigation — used by both the desktop
// Sidebar and the mobile slide-out drawer so they never drift apart.
export const NAV: NavItem[] = [
  { href: "/getting-started", label: "Getting started", icon: Rocket },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/evidence", label: "Evidence", icon: FolderArchive },
  { href: "/policies", label: "Policies", icon: FileText },
  { href: "/questionnaires", label: "Questionnaires", icon: ClipboardList },
  { href: "/copilot", label: "Co-Pilot", icon: MessageSquare },
  { href: "/vendors", label: "Vendors", icon: Building2 },
  { href: "/risks", label: "Risk Register", icon: ShieldAlert },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/training", label: "Training", icon: GraduationCap },
  { href: "/personnel", label: "Personnel", icon: Users },
  { href: "/access-reviews", label: "Access reviews", icon: UserCheck },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  { href: "/activity", label: "Activity", icon: History },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];
