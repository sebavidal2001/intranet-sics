"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { TubelightNavBar } from "@/components/ui/tubelight-navbar"
import { Home, Settings, User, LogOut, ChevronDown, Shield, BarChart2 } from "lucide-react"
import { CambioPasswordModal } from "@/components/auth/cambio-password-modal"

interface NavbarProfile {
  id: string
  nome: string
  cognome: string
  ruolo: string
  ruoli_aggiuntivi: string[]
  reparto: string | null
  is_valutazioni_admin: boolean
}

export function IntranetNavbar({ profile }: { profile: NavbarProfile | null }) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [cambioPwdOpen, setCambioPwdOpen] = useState(false)

  const isSuperadmin = profile?.ruolo === "superadmin"
  const isValutazioniAdmin = profile?.is_valutazioni_admin ?? false
  const canAccessAnalisi = isValutazioniAdmin

  const navItems = [
    { name: "Home", url: "/", icon: Home },
    ...(isSuperadmin ? [{ name: "Superadmin", url: "/superadmin", icon: Shield }] : []),
    ...(canAccessAnalisi ? [{ name: "Analisi", url: "/analisi", icon: BarChart2 }] : []),
  ]

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = "/auth/login"
  }

  const displayName = profile ? `${profile.nome} ${profile.cognome}` : "Utente"
  const RUOLO_MAP: Record<string, string> = {
    superadmin: "Superadmin",
    amministratore: "Amministratore",
    admin: "Amministratore",
    responsabile: "Responsabile",
    responsabile_intermedio: "Responsabile Intermedio",
    collaboratore: "Collaboratore",
  }
  const ruoloLabel = profile?.ruolo ? (RUOLO_MAP[profile.ruolo] ?? profile.ruolo) : ""

  return (
    <header
      className="sticky top-0 z-50"
      style={{ backgroundColor: "#00A1BE" }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* Logo */}
          <Link href="/" className="shrink-0">
            <Image
              src="/logo/sics-logo.png"
              alt="SICS"
              width={110}
              height={33}
              sizes="(max-width: 640px) 90px, 110px"
              className="object-contain"
              priority
            />
          </Link>

          {/* Tubelight nav — centro */}
          <div className="flex-1 flex justify-center">
            <TubelightNavBar items={navItems} />
          </div>

          {/* User menu — destra */}
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors duration-150"
            >
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
              <span className="hidden sm:block font-tenorite text-sm text-white">
                {displayName}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-white/70 transition-transform duration-150 ${menuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-52 bg-bg rounded-xl shadow-card border border-border py-1.5 z-50">
                  <div className="px-3 py-2 border-b border-border mb-1">
                    <p className="font-tenorite text-sm text-text">{displayName}</p>
                    <p className="text-xs text-text-muted capitalize">{ruoloLabel}</p>
                  </div>
                  <button
                    onClick={() => { setMenuOpen(false); setCambioPwdOpen(true) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:text-text hover:bg-bg-page transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Cambia password
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger/5 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Esci
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {cambioPwdOpen && (
        <CambioPasswordModal
          forzato={false}
          onClose={() => setCambioPwdOpen(false)}
          onSuccess={async () => {
            // Password cambiata: chiudiamo la sessione e si rientra dal login
            const supabase = createClient()
            await supabase.auth.signOut()
            window.location.href = "/auth/login"
          }}
        />
      )}
    </header>
  )
}
