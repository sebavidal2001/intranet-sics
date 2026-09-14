"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sunrise,
  Settings2,
  MessageSquareText,
  ShoppingCart,
  LayoutGrid,
} from "lucide-react";

/**
 * Cinque destinazioni, non sette.
 *
 * Cruscotto, Dashboard, Analisi ed Esplora erano quattro voci per una cosa
 * sola: guardare i dati organizzati in pagine. Chi apriva "Analisi" trovava un
 * elenco che non spiegava a cosa servisse, e chi apriva "Cruscotto" e
 * "Dashboard" vedeva due versioni della stessa schermata senza capire quale
 * fosse quella buona.
 *
 * Ora esiste **Dashboard**, e da lì si raggiunge tutto il resto: il Cruscotto
 * completo, la sua copia modificabile, le analisi salvate. Le route restano
 * dove sono — chi ha un collegamento salvato non lo perde — ma smettono di
 * occupare un posto nella barra e di chiedere all'utente una scelta che non è
 * in grado di fare al primo colpo.
 */
const VOCI = [
  { href: "/bi", etichetta: "Briefing", icona: Sunrise },
  { href: "/bi/dashboard", etichetta: "Dashboard", icona: LayoutGrid },
  { href: "/bi/articoli", etichetta: "Articoli & Acquisti", icona: ShoppingCart },
  { href: "/bi/analista", etichetta: "Analista", icona: MessageSquareText },
  { href: "/bi/configurazione", etichetta: "Budget & BEP", icona: Settings2 },
];

/**
 * Le pagine che ora vivono sotto Dashboard ma conservano il proprio indirizzo:
 * la voce deve restare accesa, altrimenti aprendo il Cruscotto la barra
 * sembra dire che ci si trova da nessuna parte.
 */
const RAMI_DASHBOARD = ["/bi/dashboard", "/bi/cruscotto", "/bi/analisi", "/bi/esplora"];

export function NavigazionePrototipo() {
  const percorso = usePathname();

  return (
    <nav className="border-b border-border bg-bg/80 backdrop-blur-sm sticky top-0 z-20">
      <div className="max-w-[1600px] mx-auto px-4 flex items-center gap-1 overflow-x-auto">
        {VOCI.map((v) => {
          const rami = v.href === "/bi/dashboard" ? RAMI_DASHBOARD : [v.href];
          const attivo = rami.some(
            (ramo) => percorso === ramo || (ramo !== "/bi" && percorso.startsWith(`${ramo}/`))
          );
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
