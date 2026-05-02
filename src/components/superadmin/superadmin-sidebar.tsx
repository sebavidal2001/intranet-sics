"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  Users,
  LayoutGrid,
  FileText,
  Shield,
  LogOut,
  Home,
} from "lucide-react";

const navItems = [
  { href: "/superadmin", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/superadmin/utenti", icon: Users, label: "Utenti" },
  { href: "/superadmin/portali", icon: LayoutGrid, label: "Portali & permessi" },
  { href: "/superadmin/homepage", icon: FileText, label: "Homepage" },
  { href: "/superadmin/ruoli-config", icon: Shield, label: "Ruoli & Reparti" },
];

export function SuperadminSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  return (
    <aside className="w-60 shrink-0 bg-bg border-r border-border flex flex-col min-h-screen">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border">
        <Image
          src="/logo/sics-logo.png"
          alt="SICS"
          width={110}
          height={33}
          className="object-contain"
          style={{ filter: "brightness(0) saturate(100%) invert(49%) sepia(73%) saturate(4135%) hue-rotate(163deg) brightness(95%) contrast(101%)" }}
        />
        <p className="text-xs text-text-muted mt-1.5 font-tenorite">Superadmin</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const active =
            item.href === "/superadmin"
              ? pathname === "/superadmin"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors font-tenorite ${
                active
                  ? "bg-primary-light text-primary"
                  : "text-text-muted hover:text-text hover:bg-bg-page"
              }`}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-border space-y-0.5">
        <Link
          href="/"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-text-muted hover:text-text hover:bg-bg-page transition-colors font-tenorite"
        >
          <Home className="w-4 h-4" />
          Torna alla home
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-danger hover:bg-danger/5 transition-colors font-tenorite"
        >
          <LogOut className="w-4 h-4" />
          Esci
        </button>
      </div>
    </aside>
  );
}
