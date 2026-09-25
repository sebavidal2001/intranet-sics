"use client";

/**
 * Un pannello a comparsa (elenco, albero) disegnato fuori dal contenitore.
 *
 * Dentro un riquadro con `overflow: hidden` — le schede del BI lo sono — un
 * pannello `absolute` veniva tagliato al bordo: si vedevano tre voci su venti.
 * Qui si disegna nel `body` con posizione fissa calcolata dal bottone, e si
 * apre verso l'alto quando sotto non c'e' spazio.
 */

import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const MARGINE = 8;

export function PannelloFluttuante({
  ancora,
  aperto,
  larghezza,
  altezzaMassima = 320,
  allineaDestra = false,
  children,
  pannelloRef,
}: {
  ancora: RefObject<HTMLElement>;
  aperto: boolean;
  /** Larghezza in px; di default quella del bottone. */
  larghezza?: number;
  altezzaMassima?: number;
  allineaDestra?: boolean;
  children: ReactNode;
  pannelloRef?: RefObject<HTMLDivElement>;
}) {
  const [stile, setStile] = useState<React.CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!aperto) return;
    const calcola = () => {
      const el = ancora.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.min(larghezza ?? r.width, window.innerWidth - 2 * MARGINE);
      const sotto = window.innerHeight - r.bottom - MARGINE;
      const sopra = r.top - MARGINE;
      const versoAlto = sotto < Math.min(altezzaMassima, 200) && sopra > sotto;
      const spazio = Math.max(120, Math.min(altezzaMassima, versoAlto ? sopra : sotto) - 4);
      let left = allineaDestra ? r.right - w : r.left;
      left = Math.max(MARGINE, Math.min(left, window.innerWidth - w - MARGINE));
      setStile({
        position: "fixed",
        left,
        width: w,
        maxHeight: spazio,
        ...(versoAlto ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        zIndex: 60,
      });
    };
    calcola();
    window.addEventListener("resize", calcola);
    // true: anche lo scorrimento dei contenitori interni sposta il bottone.
    window.addEventListener("scroll", calcola, true);
    return () => {
      window.removeEventListener("resize", calcola);
      window.removeEventListener("scroll", calcola, true);
    };
  }, [aperto, ancora, larghezza, altezzaMassima, allineaDestra]);

  if (!aperto || !stile || typeof document === "undefined") return null;
  return createPortal(
    <div ref={pannelloRef} style={stile} className="flex flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-lg">
      {children}
    </div>,
    document.body
  );
}
