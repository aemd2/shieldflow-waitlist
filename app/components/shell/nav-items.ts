import {
  Rocket,
  LayoutDashboard,
  FileText,
  FileBarChart,
  FolderArchive,
  Building2,
  Plug,
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

export type NavItem = { href: string; label: string; icon: LucideIcon; ownerAdminOnly?: boolean };
export type NavRole = "owner" | "admin" | "member" | "auditor";
export type NavSection = { label: string | null; items: NavItem[] };

// Single source of truth for the app navigation — used by both the desktop
// Sidebar and the mobile slide-out drawer so they never drift apart.
//
// Grouped into labelled sections (the pattern Sprinto and Vanta's 2026 nav use:
// ~5 categories instead of a flat wall) so 17 items read as a handful of
// scannable clusters, not one undifferentiated list.
const SECTIONS: NavSection[] = [
  {
    // Daily-driver items — unlabelled, always at the top. Co-Pilot isn't a
    // page anymore — it opens as a docked panel from the topbar icon instead.
    label: null,
    items: [
      { href: "/getting-started", label: "Getting started", icon: Rocket },
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/tasks", label: "Tasks", icon: ListChecks },
    ],
  },
  {
    label: "Compliance",
    items: [
      { href: "/evidence", label: "Evidence", icon: FolderArchive },
      { href: "/policies", label: "Policies", icon: FileText },
      { href: "/questionnaires", label: "Questionnaires", icon: ClipboardList },
      { href: "/reports", label: "Reports", icon: FileBarChart },
    ],
  },
  {
    label: "Risk",
    items: [
      { href: "/risks", label: "Risk Register", icon: ShieldAlert },
      { href: "/vendors", label: "Vendors", icon: Building2 },
      { href: "/access-reviews", label: "Access reviews", icon: UserCheck },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/personnel", label: "Personnel", icon: Users },
      { href: "/training", label: "Training", icon: GraduationCap },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/activity", label: "Activity", icon: History },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

// Filter the nav for a role + sprint state. Billing has no nav slot — it lives
// at Settings → Billing (owner/admin only, enforced server-side there and by
// the /billing route). "Getting started" drops out once the 14-Day Sprint is
// complete — it's an onboarding offer, not a permanent fixture; the guide
// page itself stays reachable by URL, just not pinned in the nav anymore.
export function visibleNavSections(role: NavRole | null, sprintReady = false): NavSection[] {
  const isOwnerAdmin = role === "owner" || role === "admin";
  return SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.href === "/getting-started" && sprintReady) return false;
      return !item.ownerAdminOnly || isOwnerAdmin;
    }),
  })).filter((section) => section.items.length > 0);
}
