"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Archive,
  PlusCircle,
  LayoutDashboard,
  Settings,
} from "lucide-react"
import type { LivelloAccesso } from "@/lib/auth/portale"
import { hasMinLivello } from "@/lib/auth/portale"

interface SidebarProfile {
  nome: string
  cognome: string
  ruolo: string
  reparto: string | null
}

interface PreventivatoreSidebarProps {
  livello: LivelloAccesso
  profile: SidebarProfile | null
}

const NAV_ITEMS = [
  { name: "Dashboard", url: "/preventivatore/dashboard", icon: LayoutDashboard },
  { name: "Nuovo preventivo", url: "/preventivatore/nuovo", icon: PlusCircle },
  { name: "Archivio", url: "/preventivatore/archivio", icon: Archive },
]

const ADMIN_ITEMS = [
  { name: "Impostazioni", url: "/preventivatore/impostazioni", icon: Settings },
]

export function PreventivatoreSidebar({ livello, profile }: PreventivatoreSidebarProps) {
  const pathname = usePathname()
  const isAdmin = hasMinLivello(livello, "admin")

  const allItems = isAdmin ? [...NAV_ITEMS, ...ADMIN_ITEMS] : NAV_ITEMS

  return (
    <aside
      className="w-[220px] shrink-0 flex flex-col min-h-full"
      style={{ background: "#0f1720", borderRight: "1px solid rgba(255,255,255,0.07)" }}
    >
      {/* Logo header */}
      <div
        className="px-5 py-5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0"
            style={{ background: "rgba(0,161,190,0.16)" }}
          >
            <Image
              src="/logo/sics-logo.png"
              alt="SICS"
              width={70}
              height={22}
              className="absolute left-0 top-1/2 max-w-none -translate-y-1/2 object-contain"
              priority
            />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.40)" }}>
              SICS Portale
            </p>
            <h2 className="text-sm font-tenorite font-bold text-white leading-tight">
              Preventivatore
            </h2>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {allItems.map((item) => {
          const isActive =
            pathname === item.url ||
            (item.url !== "/preventivatore" && pathname.startsWith(item.url))
          const Icon = item.icon

          return (
            <Link
              key={item.url}
              href={item.url}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 group"
              style={{
                color: isActive ? "#ffffff" : "rgba(255,255,255,0.50)",
                backgroundColor: isActive ? "rgba(0,161,190,0.18)" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.06)"
                  ;(e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.80)"
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"
                  ;(e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.50)"
                }
              }}
            >
              {/* Active indicator bar */}
              <span
                className="absolute left-3 w-0.5 h-4 rounded-full transition-opacity duration-150"
                style={{
                  opacity: isActive ? 1 : 0,
                  backgroundColor: "#00a1be",
                  marginLeft: "-12px",
                }}
              />
              <Icon
                className="w-4 h-4 shrink-0 transition-colors duration-150"
                style={{ color: isActive ? "#00a1be" : "inherit" }}
              />
              {item.name}
            </Link>
          )
        })}

        {/* Section divider for admin items */}
        {isAdmin && (
          <div
            className="mx-2 my-3"
            style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.07)" }}
          />
        )}
      </nav>

      {/* Profile footer */}
      <div
        className="px-4 py-4"
        style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
      >
        {profile ? (
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
              style={{ background: "linear-gradient(135deg, #00a1be 0%, #007a91 100%)" }}
            >
              {(profile.nome?.[0] ?? "").toUpperCase()}
              {(profile.cognome?.[0] ?? "").toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">
                {profile.nome} {profile.cognome}
              </p>
              <p className="text-[10px] capitalize" style={{ color: "rgba(255,255,255,0.40)" }}>
                {livello}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[10px] capitalize" style={{ color: "rgba(255,255,255,0.40)" }}>
            {livello}
          </p>
        )}
      </div>
    </aside>
  )
}
