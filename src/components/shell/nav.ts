import {
  ClipboardCheck,
  Columns3,
  Compass,
  Gavel,
  LayoutDashboard,
  Library,
  Lightbulb,
  Radar,
  Route,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: RegExp;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, match: /^\/$/ },
      { href: "/hackathons", label: "Explore Hackathons", icon: Compass, match: /^\/hackathons\/?$|^\/hackathons\/new/ },
    ],
  },
  {
    label: "Research",
    items: [
      { href: "/hackathons/active", label: "Hackathon Intelligence", icon: ScrollText, match: /^\/hackathons\/(?!new)[^/]+/ },
      { href: "/radar", label: "Opportunity Radar", icon: Radar },
      { href: "/sources", label: "Research Sources", icon: Library },
    ],
  },
  {
    label: "Ideas",
    items: [
      { href: "/ideas", label: "My Ideas", icon: Lightbulb },
      { href: "/judge", label: "Judge's Room", icon: Gavel },
      { href: "/compare", label: "Idea Comparison", icon: Columns3 },
    ],
  },
  {
    label: "Execution",
    items: [
      { href: "/plan", label: "Build Strategy", icon: Route },
      { href: "/evidence", label: "Evidence Board", icon: ClipboardCheck },
    ],
  },
  { label: "", items: [{ href: "/settings", label: "Settings", icon: Settings }] },
];

export function isActive(item: NavItem, pathname: string) {
  if (item.match) return item.match.test(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
