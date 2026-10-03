"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ClipboardList, ListChecks, Megaphone, Search, TriangleAlert, Users } from "lucide-react"
import type { LivelloAccesso } from "@/lib/auth/portale"

interface SidebarProfile {
  nome: string
  cognome: string
  ruolo: string
  reparto: string | null
}

interface CampagneSidebarProps {
  livello: LivelloAccesso
  profile: SidebarProfile | null
  /** Può lavorare su clienti e invii (back office o admin). */
  puoOperare: boolean
  /** Può gestire campagne e pubblico. */
  eAdmin: boolean
}

const VOCI_OPERATIVE = [
  { name: "Cerca cliente", url: "/campagne", icon: Search, esatta: true },
  { name: "Da preparare", url: "/campagne/da-preparare", icon: ClipboardList, esatta: false },
  { name: "Invii", url: "/campagne/invii", icon: ListChecks, esatta: false },
  { name: "Anomalie", url: "/campagne/anomalie", icon: TriangleAlert, esatta: false },
]

const VOCI_ADMIN = [
  { name: "Campagne", url: "/campagne/gestione", icon: Megaphone, esatta: false },
  { name: "Pubblico standard", url: "/campagne/pubblico", icon: Users, esatta: false },
]

export function CampagneSidebar({ livello, profile, puoOperare, eAdmin }: CampagneSidebarProps) {
  const pathname = usePathname()
  const voci = [...(puoOperare ? VOCI_OPERATIVE : []), ...(eAdmin ? VOCI_ADMIN : [])]

  return (
    <aside
      className="w-[220px] shrink-0 flex flex-col min-h-full"
      style={{ background: "#0f1720", borderRight: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="px-5 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
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
            <h2 className="text-sm font-tenorite font-bold text-white leading-tight">Campagne Marketing</h2>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {voci.map((item) => {
          const isActive = item.esatta
            ? pathname === item.url || pathname.startsWith("/campagne/clienti")
            : pathname === item.url || pathname.startsWith(`${item.url}/`)
          const Icon = item.icon
          return (
            <Link
              key={item.url}
              href={item.url}
              aria-current={isActive ? "page" : undefined}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150"
              style={{
                color: isActive ? "#ffffff" : "rgba(255,255,255,0.50)",
                backgroundColor: isActive ? "rgba(0,161,190,0.18)" : "transparent",
              }}
            >
              <Icon className="w-4 h-4 shrink-0" style={{ color: isActive ? "#00a1be" : "inherit" }} />
              {item.name}
            </Link>
          )
        })}
      </nav>

      <div className="px-4 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
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
                {eAdmin ? "admin" : "back office"}
                {livello === "superadmin" ? " · superadmin" : ""}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
