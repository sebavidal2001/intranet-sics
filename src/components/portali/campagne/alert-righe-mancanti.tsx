"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { descriviAnomalia, formattaDataIt } from "@/lib/portali/campagne/anomalie-testi";
import type { Anomalia } from "@/lib/portali/campagne/tipi";
import { Copia } from "./copia";

const CHIAVE = "campagne.alert-righe-mancanti";

/**
 * Il popup: «nell'ordine X manca la riga DOCUMENTAZIONE». Dice cosa inserire
 * (articolo e descrizione, pronti da copiare), in quale ordine, di che data e per
 * quale cliente. Compare quando si apre la home e si richiude con «Ho capito».
 *
 * Si ricorda cosa e' gia' stato visto nella sessione del browser: se al prossimo
 * controllo compare un caso NUOVO, il popup torna; se sono sempre gli stessi, no.
 */
export function AlertRigheMancanti({ anomalie }: { anomalie: Anomalia[] }) {
  const [aperto, setAperto] = useState(false);
  const firma = anomalie.map((a) => a.id).sort().join(",");

  useEffect(() => {
    let visto: string | null = null;
    try {
      visto = window.sessionStorage.getItem(CHIAVE);
    } catch {
      // Storage non disponibile: il popup si mostra e basta.
    }
    setAperto(anomalie.length > 0 && visto !== firma);
  }, [anomalie.length, firma]);

  function chiudi() {
    try {
      window.sessionStorage.setItem(CHIAVE, firma);
    } catch {
      // Niente da fare: si richiude e basta.
    }
    setAperto(false);
  }

  if (!aperto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="alert-titolo">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-6 w-6 shrink-0 text-danger" aria-hidden />
            <div>
              <h2 id="alert-titolo" className="font-tenorite text-lg font-bold text-text">
                {anomalie.length === 1 ? "Manca una riga DOCUMENTAZIONE" : `Mancano ${anomalie.length} righe DOCUMENTAZIONE`}
              </h2>
              <p className="mt-0.5 text-sm text-text-muted">Inserisci in Impresa, in ciascun ordine, la riga indicata.</p>
            </div>
          </div>
          <button type="button" onClick={chiudi} aria-label="Chiudi" className="rounded p-1 text-text-muted hover:bg-bg-page">
            <X className="h-5 w-5" />
          </button>
        </header>

        <ul className="divide-y divide-border px-5">
          {anomalie.map((a) => {
            const d = descriviAnomalia(a);
            return (
              <li key={a.id} className="py-4">
                <p className="text-sm font-semibold text-text">{a.ragione_sociale ?? a.codice_cliente}</p>
                <p className="mt-0.5 text-sm text-text-muted">
                  Ordine {a.ordine_numero}/{a.ordine_anno}
                  {typeof a.dettaglio.data_ordine === "string" ? ` del ${formattaDataIt(a.dettaglio.data_ordine)}` : ""} · campagna{" "}
                  {String(a.dettaglio.campagna_codice ?? "")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.da_copiare.map((c) => (
                    <Copia key={c.etichetta} etichetta={c.etichetta} valore={c.valore} />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
          <Link href="/campagne/anomalie" className="text-sm font-medium text-primary hover:underline" onClick={chiudi}>
            Vai alle anomalie
          </Link>
          <Button onClick={chiudi}>Ho capito</Button>
        </footer>
      </div>
    </div>
  );
}
