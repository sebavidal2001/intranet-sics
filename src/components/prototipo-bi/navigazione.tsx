"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sunrise,
  LayoutDashboard,
  Settings2,
  MessageSquareText,
  ShoppingCart,
  LayoutGrid,
  Library,
} from "lucide-react";

// L'editor resta un'azione, mentre la libreria è una destinazione: separare i
// due concetti evita di nascondere di nuovo gli oggetti già salvati.
const VOCI = [
  { href: "/bi", etichetta: "Briefing", icona: Sunrise },
  { href: "/bi/cruscotto", etichetta: "Cruscotto", icona: LayoutDashboard },
  { href: "/bi/dashboard", etichetta: "Dashboard", icona: LayoutGrid },
  { href: "/bi/analisi", etichetta: "Analisi", icona: Library },
  { href: "/bi/articoli", etichetta: "Articoli & Acquisti", icona: ShoppingCart },
  { href: "/bi/analista", etichetta: "Analista", icona: MessageSquareText },
  { href: "/bi/configurazione", etichetta: "Budget & BEP", icona: Settings2 },
];

export function NavigazionePrototipo() {
  const percorso = usePathname();

  return (
    <nav className="border-b border-border bg-bg/80 backdrop-blur-sm sticky top-0 z-20">
      <div className="max-w-[1600px] mx-auto px-4 flex items-center gap-1 overflow-x-auto">
        {VOCI.map((v) => {
          // Le sottopagine (/bi/dashboard/<id>) devono tenere accesa la voce
          // del loro ramo, altrimenti aprendo una dashboard la barra non
          // segnala piu' dove ci si trova.
          const attivo =
            percorso === v.href ||
            (v.href !== "/bi" && percorso.startsWith(`${v.href}/`)) ||
            (v.href === "/bi/analisi" && percorso.startsWith("/bi/esplora"));
          const Icona = v.icona;
          return (
            <Link
              key={v.href}
              href={v.href}
              className={`flex items-center gap-2 px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${
                attivo
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-text-muted hover:text-text"
              }`}
            >
              <Icona className="w-4 h-4" aria-hidden />
              {v.etichetta}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
