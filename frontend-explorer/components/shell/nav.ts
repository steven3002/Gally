import {
  Activity,
  Briefcase,
  Compass,
  Layers,
  Scale,
  Settings,
  Shield,
} from "@/components/ui/icons";

export interface NavItem {
  label: string;
  href: string;
  icon: (p: { className?: string }) => React.ReactNode;
  match?: string; // prefix used to mark nested routes active
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Discover",
    items: [
      { label: "Explore", href: "/", icon: Compass },
      { label: "Assets", href: "/assets", icon: Layers, match: "/assets" },
      { label: "Validators", href: "/validators", icon: Shield, match: "/validators" },
      { label: "Disputes", href: "/disputes", icon: Scale, match: "/disputes" },
      { label: "Governance", href: "/governance", icon: Settings, match: "/governance" },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Portfolio", href: "/portfolio", icon: Briefcase, match: "/portfolio" },
      { label: "Activity", href: "/activity", icon: Activity, match: "/activity" },
    ],
  },
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || (item.match ? pathname.startsWith(item.match) : false);
}
