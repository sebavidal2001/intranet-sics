"use client";

/**
 * Le pagine del BI si aggiornano da sole quando arriva un caricamento nuovo.
 *
 * Prima non lo facevano: una scheda aperta — il Cruscotto in presentazione su
 * uno schermo, o la pagina lasciata aperta da ieri — mostrava per giorni i
 * dati del momento in cui era stata aperta, con l'avviso «ultimo caricamento N
 * ore fa» che cresceva. Il server aveva i dati nuovi; la pagina non li chiedeva.
 *
 * Il controllo costa una riga: `GET /api/bi/snapshot` risponde dallo snapshot
 * in memoria, che a sua volta verifica il run corrente al piu' ogni dieci
 * minuti. Si controlla ogni dieci minuti e ogni volta che la pagina torna
 * visibile; mai quando e' nascosta.
 */

import { useEffect, useRef } from "react";

const OGNI_MS = 10 * 60 * 1000;
/** Due controlli ravvicinati (focus + visibilita') non servono. */
const DISTANZA_MINIMA_MS = 60 * 1000;

/**
 * @param runRicevutoIl il caricamento che la pagina sta mostrando. `undefined`
 *   se la pagina non lo sa (le dashboard): allora il primo controllo fissa il
 *   riferimento e solo i successivi possono scatenare l'aggiornamento.
 */
export function useAutoAggiornamento(
  runRicevutoIl: string | null | undefined,
  quandoNuovi: () => void
): void {
  // Il callback cambia a ogni render: lo si legge da un ref per non
  // ricreare timer e ascoltatori ogni volta.
  const callback = useRef(quandoNuovi);
  callback.current = quandoNuovi;
  const noto = useRef(runRicevutoIl);
  noto.current = runRicevutoIl ?? noto.current;

  useEffect(() => {
    let fermo = false;
    let ultimoControllo = noto.current === undefined ? 0 : Date.now();

    const controlla = async () => {
      if (fermo || document.visibilityState === "hidden") return;
      if (Date.now() - ultimoControllo < DISTANZA_MINIMA_MS) return;
      ultimoControllo = Date.now();
      try {
        const r = await fetch("/api/bi/snapshot", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { runRicevutoIl?: string | null };
        if (fermo || !j.runRicevutoIl) return;
        if (noto.current === undefined) {
          noto.current = j.runRicevutoIl;
          return;
        }
        if (j.runRicevutoIl !== noto.current) {
          noto.current = j.runRicevutoIl;
          callback.current();
        }
      } catch {
        // Rete assente: si riprova al prossimo giro, non si disturba.
      }
    };

    const timer = window.setInterval(() => void controlla(), OGNI_MS);
    if (noto.current === undefined) void controlla();
    const suVisibile = () => {
      if (document.visibilityState === "visible") void controlla();
    };
    document.addEventListener("visibilitychange", suVisibile);
    window.addEventListener("focus", suVisibile);
    return () => {
      fermo = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", suVisibile);
      window.removeEventListener("focus", suVisibile);
    };
  }, [runRicevutoIl]);
}
