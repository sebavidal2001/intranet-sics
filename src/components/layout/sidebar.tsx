"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FileText,
  BarChart3,
  Settings,
  Target,
  TrendingUp,
  ClipboardList,
  FileBarChart2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Ruolo } from "@/lib/types";

interface SidebarProps {
  ruolo: Ruolo;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Ruolo[];
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: ["amministratore" as Ruolo, "responsabile", "collaboratore"],
  },
  {
    label: "Valutazioni",
    href: "/valutazioni",
    icon: ClipboardList,
    roles: ["responsabile", "collaboratore"],
  },
  {
    label: "Analisi Personale",
    href: "/analisi",
    icon: TrendingUp,
    roles: ["collaboratore", "responsabile"],
  },
  {
    label: "Analisi Reparto",
    href: "/analisi/reparto",
    icon: BarChart3,
    roles: ["responsabile"],
  },
  {
    label: "Analisi Admin",
    href: "/analisi/admin",
    icon: Target,
    roles: ["amministratore" as Ruolo],
  },
  {
    label: "Report Builder",
    href: "/admin/report",
    icon: FileBarChart2,
    roles: ["amministratore" as Ruolo],
  },
  {
    label: "Report",
    href: "/report",
    icon: FileBarChart2,
    roles: ["responsabile", "responsabile_intermedio", "collaboratore"],
  },
  {
    label: "Mansionari",
    href: "/mansionari",
    icon: FileText,
    roles: ["amministratore" as Ruolo],
  },
  {
    label: "Utenti",
    href: "/admin/utenti",
    icon: Users,
    roles: ["amministratore" as Ruolo],
  },
  {
    label: "Configurazione",
    href: "/admin/config",
    icon: Settings,
    roles: ["amministratore" as Ruolo],
  },
];

export function Sidebar({ ruolo }: SidebarProps) {
  const pathname = usePathname();

  const filteredItems = navItems.filter((item) =>
    item.roles.includes(ruolo)
  );

  return (
    <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 border-r border-border bg-bg">
      <nav className="flex flex-col gap-1 p-4">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-card",
                isActive
                  ? "bg-primary-light text-primary"
                  : "text-text-muted hover:bg-secondary-light hover:text-text"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
