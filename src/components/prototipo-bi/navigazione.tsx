"use client";

/** ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sunrise, LayoutDashboard, Settings2, MessageSquareText, ShoppingCart } from "lucide-react";

const VOCI = [
  { href: "/prototipo-bi", etichetta: "Briefing", icona: Sunrise },
  { href: "/prototipo-bi/cruscotto", etichetta: "Cruscotto", icona: LayoutDashboard },
  { href: "/prototipo-bi/articoli", etichetta: "Articoli & Acquisti", icona: ShoppingCart },
  { href: "/prototipo-bi/analista", etichetta: "Analista", icona: MessageSquareText },
  { href: "/prototipo-bi/configurazione", etichetta: "Budget & BEP", icona: Settings2 },
];

export function NavigazionePrototipo() {
  const percorso = usePathname();

  return (
    <nav className="border-b border-border bg-bg/80 backdrop-blur-sm sticky top-0 z-20">
      <div className="max-w-[1600px] mx-auto px-4 flex items-center gap-1 overflow-x-auto">
        {VOCI.map((v) => {
          const attivo = percorso === v.href;
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
