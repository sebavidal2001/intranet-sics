"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  Calculator,
  FileText,
  PackageSearch,
  Ruler,
  Settings,
  TriangleAlert,
} from "lucide-react"
import type { LivelloAccesso } from "@/lib/auth/portale"

interface SidebarProfile {
  nome: string
  cognome: string
  ruolo: string
  reparto: string | null
}

interface VettoriSidebarProps {
  livello: LivelloAccesso
  profile: SidebarProfile | null
  /** Ruoli funzionali dell'utente: decidono cosa vede, non il livello di portale. */
  ruoli: string[]
  puoGestire: boolean
  puoRegistrareArrivi: boolean
}

type Visibilita = "tutti" | "banco" | "gestione";

/**
 * L'ordine segue la giornata dell'operatore, come l'ha descritta
 * l'amministrazione (24/09/2026): prima si simula e si sceglie il vettore, poi
 * si prepara la bolla, poi a distanza di giorni arrivano spedizioni e fatture,
 * e da li' le anomalie. Analisi e listini sono consultazione e configurazione.
 */
const VOCI: ReadonlyArray<{ name: string; url: string; icon: typeof Calculator; visibile: Visibilita }> = [
  { name: "Simulazione", url: "/vettori/simulazione", icon: Calculator, visibile: "tutti" },
  { name: "Bolle", url: "/vettori/bolle", icon: Ruler, visibile: "banco" },
  { name: "Spedizioni", url: "/vettori/spedizioni", icon: PackageSearch, visibile: "gestione" },
  { name: "Fatture", url: "/vettori/fatture", icon: FileText, visibile: "gestione" },
  { name: "Anomalie", url: "/vettori/anomalie", icon: TriangleAlert, visibile: "gestione" },
  { name: "Analisi", url: "/vettori/analisi", icon: BarChart3, visibile: "tutti" },
  { name: "Listini", url: "/vettori/listini", icon: Settings, visibile: "gestione" },
];

export function VettoriSidebar({
  livello,
  profile,
  puoGestire,
  puoRegistrareArrivi,
}: VettoriSidebarProps) {
  const pathname = usePathname()

  // Il magazzino vede le bolle e la simulazione: non ha motivo di avere
  // sotto gli occhi fatture, anomalie e listini mentre misura un collo.
  const voci = VOCI.filter(({ visibile }) =>
    visibile === "tutti" ||
    (visibile === "banco" && puoRegistrareArrivi) ||
    (visibile === "gestione" && puoGestire)
  )

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
            <p
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "rgba(255,255,255,0.40)" }}
            >
              SICS Portale
            </p>
            <h2 className="text-sm font-tenorite font-bold text-white leading-tight">
              Controllo Vettori
            </h2>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {voci.map((item) => {
          const isActive = pathname === item.url || pathname.startsWith(`${item.url}/`)
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
              <Icon
                className="w-4 h-4 shrink-0"
                style={{ color: isActive ? "#00a1be" : "inherit" }}
              />
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
                {livello}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
