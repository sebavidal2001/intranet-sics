"use client";

/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Pannello di dettaglio: dall'aggregato al documento, dal documento alla riga.
 *
 * È la risposta alla domanda che segue sempre un numero strano — «cosa ha
 * chiesto quel cliente?» — senza dover riaprire il gestionale.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Clock, FileText, Loader2, Package, X } from "lucide-react";
import { euro, numero } from "./primitivi";
import type { ChiaveDataset, Dimensione } from "@/lib/prototipo-bi/tipi";

interface DocumentoSintesi {
  numero: string;
  data: string;
  cliente: string;
  agente: string;
  bu: string;
  creatore?: string;
  righe: number;
  importo: number;
  valoreTotale?: number;
  convertito?: number;
  giorniAperto?: number | null;
  giorniRisposta?: number | null;
  conversionePct?: number;
}

interface RigaDettaglio {
  articolo: string;
  descrizione: string;
  quantita: number;
  importo: number;
  valoreTotale?: number;
  convertito?: number;
  categoria: string;
  bu: string;
  causale?: string;
  evasa?: boolean;
}

export interface RichiestaPannello {
  dataset: ChiaveDataset;
  titolo: string;
  filtri: { campo: Dimensione; op: "eq"; valore: string }[];
  periodo?: { dal?: string; al?: string; anno?: number };
}

const NOMI_DATASET: Record<string, string> = {
  preventivi_aperti: "Preventivi",
  ordinato: "Ordini",
  fatturato: "Fatture",
  consegnato: "Consegne",
  portafoglio: "Portafoglio",
};

function badgeEta(giorni: number | null | undefined) {
  if (giorni === null || giorni === undefined) return null;
  const stile =
    giorni > 365
      ? "bg-danger/15 text-danger"
      : giorni > 90
        ? "bg-warning/15 text-warning"
        : "bg-success/15 text-success";
  const testo = giorni > 365 ? `${Math.floor(giorni / 365)}+ anni` : `${giorni} gg`;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${stile}`}>{testo}</span>
  );
}

export function PannelloDettaglio({
  richiesta,
  onChiudi,
}: {
  richiesta: RichiestaPannello | null;
  onChiudi: () => void;
}) {
  const [documenti, setDocumenti] = useState<DocumentoSintesi[]>([]);
  const [totale, setTotale] = useState(0);
  const [righe, setRighe] = useState<RigaDettaglio[] | null>(null);
  const [selezionato, setSelezionato] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [avvisi, setAvvisi] = useState<string[]>([]);
  const [ordina, setOrdina] = useState<"importo" | "data" | "eta">("importo");

  const carica = useCallback(
    async (documento?: string) => {
      if (!richiesta) return;
      setCaricamento(true);
      setErrore(null);
      try {
        const r = await fetch("/api/bi/dettaglio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataset: richiesta.dataset,
            filtri: richiesta.filtri,
            periodo: richiesta.periodo,
            documento,
            limite: 100,
            ordina,
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Errore");
        setDocumenti(j.documenti ?? []);
        setTotale(j.totaleDocumenti ?? 0);
        setRighe(j.righe ?? null);
        setSelezionato(j.documentoSelezionato ?? null);
        setAvvisi(j.avvisi ?? []);
      } catch (e) {
        setErrore(e instanceof Error ? e.message : "Errore");
      } finally {
        setCaricamento(false);
      }
    },
    [richiesta, ordina]
  );

  useEffect(() => {
    if (richiesta) void carica();
    else {
      setDocumenti([]);
      setRighe(null);
      setSelezionato(null);
    }
  }, [richiesta, carica]);

  useEffect(() => {
    const onTasto = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selezionato) void carica();
      else onChiudi();
    };
    window.addEventListener("keydown", onTasto);
    return () => window.removeEventListener("keydown", onTasto);
  }, [selezionato, carica, onChiudi]);

  const doc = documenti.find((d) => d.numero === selezionato);
  const preventivi = richiesta?.dataset === "preventivi_aperti";

  return (
    <AnimatePresence>
      {richiesta && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onChiudi}
            className="fixed inset-0 bg-black/40 z-40"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-3xl bg-bg border-l border-border z-50 flex flex-col"
          >
            <header className="border-b border-border px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  {selezionato && (
                    <button
                      onClick={() => void carica()}
                      className="inline-flex items-center gap-1 hover:text-primary"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
                      elenco
                    </button>
                  )}
                  <span>{NOMI_DATASET[richiesta.dataset] ?? richiesta.dataset}</span>
                </div>
                <h2 className="font-tenorite font-semibold truncate">
                  {selezionato ? `Documento ${selezionato}` : richiesta.titolo}
                </h2>
                {!selezionato && (
                  <p className="text-xs text-text-muted">
                    {totale.toLocaleString("it-IT")} documenti
                    {totale > documenti.length && ` · mostrati i primi ${documenti.length}`}
                  </p>
                )}
                {doc && (
                  <p className="text-xs text-text-muted truncate">
                    {doc.cliente} · {doc.data} · {doc.agente}
                  </p>
                )}
              </div>
              <button
                onClick={onChiudi}
                className="p-1.5 rounded text-text-muted hover:text-text hover:bg-bg-page shrink-0"
                aria-label="Chiudi"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </header>

            {!selezionato && (
              <div className="px-4 py-2 border-b border-border flex items-center gap-2 text-xs">
                <span className="text-text-muted">Ordina per</span>
                {(
                  [
                    ["importo", "importo"],
                    ["data", "data"],
                    ...(preventivi ? [["eta", "anzianità"] as const] : []),
                  ] as [typeof ordina, string][]
                ).map(([k, etichetta]) => (
                  <button
                    key={k}
                    onClick={() => setOrdina(k)}
                    className={`px-2 py-1 rounded transition-colors ${
                      ordina === k
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    {etichetta}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {caricamento && (
                <div className="p-8 flex items-center justify-center text-text-muted">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden /> Caricamento…
                </div>
              )}

              {errore && (
                <div className="m-4 p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
                  {errore}
                </div>
              )}

              {avvisi.length > 0 && (
                <div className="m-4 p-3 rounded-lg bg-warning/10 border border-warning/30 text-xs space-y-1">
                  {avvisi.map((a, i) => (
                    <div key={i}>{a}</div>
                  ))}
                </div>
              )}

              {/* ── Righe del documento ─────────────────────────────────── */}
              {!caricamento && righe && (
                <div className="p-4">
                  {doc && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 p-3 rounded-lg bg-bg-page text-sm">
                      <div>
                        <div className="text-[11px] text-text-muted">Righe</div>
                        <div className="font-tenorite font-bold">{doc.righe}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-text-muted">
                          {preventivi ? "Valore" : "Importo"}
                        </div>
                        <div className="font-tenorite font-bold">
                          {euro(doc.valoreTotale ?? doc.importo, false)}
                        </div>
                      </div>
                      {preventivi && (
                        <>
                          <div>
                            <div className="text-[11px] text-text-muted">Convertito</div>
                            <div className="font-tenorite font-bold">
                              {doc.conversionePct?.toFixed(0) ?? 0}%
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-text-muted">Aperto da</div>
                            <div className="font-tenorite font-bold">
                              {doc.giorniAperto !== null && doc.giorniAperto !== undefined
                                ? `${doc.giorniAperto} gg`
                                : "chiuso"}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase text-text-muted border-b border-border">
                        <th className="py-2 pr-2 font-tenorite">Articolo</th>
                        <th className="py-2 px-2 text-right font-tenorite">Q.tà</th>
                        <th className="py-2 px-2 text-right font-tenorite">
                          {preventivi ? "Valore" : "Importo"}
                        </th>
                        {preventivi && (
                          <th className="py-2 pl-2 text-right font-tenorite">Inevaso</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {righe.map((r, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0 align-top">
                          <td className="py-2 pr-2">
                            <div className="flex items-start gap-2">
                              <Package
                                className="w-3.5 h-3.5 mt-0.5 text-text-muted shrink-0"
                                aria-hidden
                              />
                              <div className="min-w-0">
                                <div className="text-xs text-text-muted">{r.articolo}</div>
                                {/* La descrizione del gestionale può contenere
                                    ritorni a capo codificati: si ripuliscono. */}
                                <div className="text-[13px] leading-snug">
                                  {r.descrizione.replace(/\\x0d\\x0a|\r|\n/g, " ").trim() || "—"}
                                </div>
                                <div className="text-[11px] text-text-muted mt-0.5">
                                  {r.bu}
                                  {r.categoria && r.categoria !== "-" && ` · ${r.categoria}`}
                                  {r.evasa !== undefined && (
                                    <span
                                      className={`ml-2 ${r.evasa ? "text-success" : "text-warning"}`}
                                    >
                                      {r.evasa ? "evasa" : "aperta"}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                            {numero(r.quantita)}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap font-medium">
                            {euro(r.valoreTotale ?? r.importo, false)}
                          </td>
                          {preventivi && (
                            <td className="py-2 pl-2 text-right tabular-nums whitespace-nowrap text-text-muted">
                              {euro(r.importo, false)}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Elenco documenti ────────────────────────────────────── */}
              {!caricamento && !righe && (
                <div className="divide-y divide-border">
                  {documenti.length === 0 && (
                    <p className="p-8 text-center text-sm text-text-muted">
                      Nessun documento con i filtri attivi.
                    </p>
                  )}
                  {documenti.map((d) => (
                    <button
                      key={d.numero}
                      onClick={() => void carica(d.numero)}
                      className="w-full text-left px-4 py-3 hover:bg-bg-page transition-colors flex items-start gap-3"
                    >
                      <FileText className="w-4 h-4 text-text-muted mt-0.5 shrink-0" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-medium">n. {d.numero}</span>
                          <span className="text-xs text-text-muted">{d.data}</span>
                          {preventivi && badgeEta(d.giorniAperto)}
                        </div>
                        <div className="text-sm truncate">{d.cliente}</div>
                        <div className="text-[11px] text-text-muted">
                          {d.righe} righe · {d.bu} · {d.agente}
                          {d.creatore && ` · ${d.creatore}`}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-medium tabular-nums">
                          {euro(d.valoreTotale ?? d.importo)}
                        </div>
                        {preventivi && d.conversionePct !== undefined && (
                          <div className="text-[11px] text-text-muted tabular-nums">
                            {d.conversionePct.toFixed(0)}% convertito
                          </div>
                        )}
                        {preventivi && d.giorniRisposta !== null && (
                          <div className="text-[11px] text-text-muted inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" aria-hidden />
                            {d.giorniRisposta === 0 ? "in giornata" : `${d.giorniRisposta} gg`}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <footer className="border-t border-border px-4 py-2 text-[11px] text-text-muted">
              Esc {selezionato ? "torna all'elenco" : "chiude il pannello"} · i dati provengono
              dallo stesso snapshot dei grafici
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
