"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles, Undo2 } from "lucide-react";
import { GraficoDaAnalisi } from "@/components/prototipo-bi/grafico-da-risultato";
import { formatta } from "@/components/prototipo-bi/crea-misura";
import { Scheda } from "@/components/prototipo-bi/primitivi";
import { eseguiAnalisiComposita } from "@/lib/prototipo-bi/analisi-composita";
import type { EsitoModificaAi } from "@/lib/prototipo-bi/modifica-riquadro-ai";
import type { StatoRiquadro } from "@/lib/prototipo-bi/modifica-riquadro";
import { NOMI_GRAFICI, graficiPossibili, scegliGrafico, type TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type { AspettoGrafico, Periodo, SerieAnalisiEseguita } from "@/lib/prototipo-bi/tipi";

/**
 * «Modifica a parole».
 *
 * Chi non e' pratico del programma scrive cosa cambiare («aggiungi il confronto
 * con l'anno scorso, togli il budget, filtra su Boni»). L'assistente risponde
 * con operazioni da un vocabolario chiuso; qui si vede COSA CAMBIA in parole e
 * il riquadro PRIMA e DOPO, calcolati con le stesse query di sempre (quindi sul
 * perimetro di chi guarda). Si applica solo se si conferma, e si puo' annullare.
 *
 * Il componente non calcola niente da se': il dopo e' il motore, e se il dopo
 * non si riesce a calcolare la modifica non si puo' applicare.
 */

function messaggioDa(corpo: unknown, ripiego: string): string {
  if (typeof corpo === "object" && corpo !== null) {
    const { error, suggerimento } = corpo as { error?: unknown; suggerimento?: unknown };
    if (typeof error === "string") {
      return typeof suggerimento === "string" && suggerimento ? `${error} ${suggerimento}` : error;
    }
  }
  return ripiego;
}

type Fase = "scrivi" | "attesa" | "proposta";

export function ModificaAParole({
  stato,
  risultatiPrima,
  graficoPrima,
  aspetto,
  periodoEreditato,
  onApplica,
  puoAnnullare,
  onAnnulla,
}: {
  /** Il riquadro com'e' ora, con la serie principale per prima. */
  stato: StatoRiquadro;
  /** Le serie gia' calcolate del riquadro attuale: il «prima». */
  risultatiPrima: SerieAnalisiEseguita[];
  graficoPrima: TipoGrafico | undefined;
  aspetto: AspettoGrafico | null;
  periodoEreditato?: Periodo;
  onApplica: (nuovo: StatoRiquadro) => void;
  puoAnnullare: boolean;
  onAnnulla: () => void;
}) {
  const [fase, setFase] = useState<Fase>("scrivi");
  const [testo, setTesto] = useState("");
  const [risposta, setRisposta] = useState("");
  const [esito, setEsito] = useState<EsitoModificaAi | null>(null);
  const [errore, setErrore] = useState("");
  const [dopo, setDopo] = useState<SerieAnalisiEseguita[] | null>(null);
  const [erroreDopo, setErroreDopo] = useState("");
  const [calcolo, setCalcolo] = useState(false);
  const [applicata, setApplicata] = useState(false);
  const richiestaCorrente = useRef("");
  // Chiave stabile: un oggetto nuovo a ogni render del padre rilancerebbe il calcolo.
  const chiavePeriodo = JSON.stringify(periodoEreditato ?? null);

  const chiarimento = esito?.tipo === "chiarimento" ? esito.chiarimento : null;
  const occupato = fase === "attesa";

  async function proponi(richiesta: string) {
    setFase("attesa");
    setErrore("");
    setApplicata(false);
    richiestaCorrente.current = richiesta;
    try {
      const res = await fetch("/api/bi/riquadro/modifica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testo: richiesta, stato }),
      });
      const corpo: unknown = await res.json();
      if (!res.ok) throw new Error(messaggioDa(corpo, "Non riesco a preparare la modifica."));
      const e = corpo as EsitoModificaAi;
      setEsito(e);
      setDopo(null);
      setErroreDopo("");
      setFase(e.tipo === "modifica" ? "proposta" : "scrivi");
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Non riesco a preparare la modifica.");
      setEsito(null);
      setFase("scrivi");
    }
  }

  // Il «dopo»: lo stesso motore, sul nuovo stato.
  const nuovo = esito?.tipo === "modifica" ? esito.stato : undefined;
  useEffect(() => {
    if (!nuovo) return;
    const controller = new AbortController();
    setCalcolo(true);
    setErroreDopo("");
    eseguiAnalisiComposita(
      { spec: nuovo.serie[0].spec, serie: nuovo.serie },
      { periodo: (JSON.parse(chiavePeriodo) as Periodo | null) ?? undefined },
      { signal: controller.signal }
    )
      .then((risultato) => setDopo(risultato.serie))
      .catch((causa: unknown) => {
        if (causa instanceof DOMException && causa.name === "AbortError") return;
        setDopo(null);
        setErroreDopo(causa instanceof Error ? causa.message : "Non riesco a calcolare il riquadro modificato.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCalcolo(false);
      });
    return () => controller.abort();
  }, [nuovo, chiavePeriodo]);

  function scarta() {
    setEsito(null);
    setDopo(null);
    setErroreDopo("");
    setFase("scrivi");
  }

  function applica() {
    if (!nuovo) return;
    onApplica(nuovo);
    setApplicata(true);
    setTesto("");
    setRisposta("");
    scarta();
  }

  // Il tipo di grafico del «dopo», con la stessa regola dell'editor.
  const risultatoDopo = dopo ? (dopo.length > 1 ? dopo : dopo[0]?.risultato) : null;
  const possibili = risultatoDopo ? graficiPossibili(risultatoDopo) : [];
  const richiesto = nuovo?.grafico;
  const tipoDopo: TipoGrafico | undefined =
    richiesto && possibili.includes(richiesto) ? richiesto : risultatoDopo ? scegliGrafico(risultatoDopo).tipo : undefined;
  const graficoNonAdatto = Boolean(richiesto && risultatoDopo && !possibili.includes(richiesto));

  const totalePrima = risultatiPrima.find((s) => s.ruolo === "principale")?.risultato;
  const totaleDopo = dopo?.find((s) => s.ruolo === "principale")?.risultato;

  return (
    <section aria-label="Modifica a parole" className="mb-6">
      <Scheda
        titolo="Modifica a parole"
        sottotitolo="Scrivi cosa cambiare: vedi il prima e il dopo, e confermi solo se ti va bene"
        azione={
          puoAnnullare ? (
            <button
              type="button"
              onClick={onAnnulla}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-bg-page px-3 text-sm font-medium text-text focus:outline-none focus:ring-2 focus:ring-primary"
              title="Riporta il riquadro com'era prima dell'ultima modifica a parole"
            >
              <Undo2 className="h-4 w-4" aria-hidden />
              Annulla l’ultima modifica
            </button>
          ) : null
        }
      >
        {fase !== "proposta" && (
          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Cosa vuoi cambiare?
              <textarea
                value={testo}
                onChange={(e) => setTesto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !occupato && testo.trim().length >= 5 && !chiarimento) {
                    e.preventDefault();
                    void proponi(testo.trim());
                  }
                }}
                rows={2}
                maxLength={500}
                disabled={occupato}
                placeholder="Per esempio: aggiungi il confronto con l’anno scorso, togli il budget, filtra su Boni"
                className="mt-1 w-full rounded-lg border border-border bg-bg-page p-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            {applicata && (
              <p role="status" className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
                Modifica applicata. Il riquadro non è ancora salvato: puoi annullarla o salvare.
              </p>
            )}

            {esito?.tipo === "chiarimento" && chiarimento && (
              <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3" role="status">
                <p className="text-sm">{chiarimento}</p>
                <label className="block text-xs text-text-muted">
                  La tua risposta
                  <input
                    value={risposta}
                    onChange={(e) => setRisposta(e.target.value)}
                    disabled={occupato}
                    className="mt-1 w-full rounded-lg border border-border bg-bg p-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
              </div>
            )}

            {esito?.tipo === "non_possibile" && (
              <p role="status" className="rounded-lg border border-border bg-bg-page p-3 text-sm">
                {esito.motivo}
              </p>
            )}

            {esito?.tipo === "invariato" && (
              <div role="status" className="space-y-1 rounded-lg border border-border bg-bg-page p-3 text-sm">
                <p>Il riquadro è già così: non c’è niente da cambiare.</p>
                {esito.spiegazione && <p className="text-xs text-text-muted">{esito.spiegazione}</p>}
                {esito.ignorati?.map((i) => (
                  <p key={i} className="text-xs text-text-muted">{i}</p>
                ))}
              </div>
            )}

            {errore && (
              <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
                {errore}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                disabled={occupato || (chiarimento ? risposta.trim().length < 2 : testo.trim().length < 5)}
                onClick={() => void proponi(chiarimento ? `${richiestaCorrente.current} — ${risposta.trim()}` : testo.trim())}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-bg focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              >
                {occupato ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                {occupato ? "Sto pensando…" : chiarimento ? "Rispondi" : "Proponi la modifica"}
              </button>
            </div>
          </div>
        )}

        {fase === "proposta" && esito?.tipo === "modifica" && nuovo && (
          <div className="space-y-4">
            <div>
              <h3 className="font-tenorite text-sm font-bold uppercase tracking-wide">Cosa cambia</h3>
              <ul className="mt-2 space-y-1 text-sm" aria-label="Modifiche proposte">
                {esito.riepilogo?.map((riga) => (
                  <li key={riga} className="rounded-lg bg-bg-page px-3 py-2">{riga}</li>
                ))}
              </ul>
              {esito.spiegazione && <p className="mt-2 text-xs text-text-muted">{esito.spiegazione}</p>}
              {esito.ignorati && esito.ignorati.length > 0 && (
                <ul className="mt-2 space-y-1" aria-label="Cose non applicate">
                  {esito.ignorati.map((i) => (
                    <li key={i} className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs">{i}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <figure aria-label="Prima" className="min-w-0 rounded-lg border border-border p-3">
                <figcaption className="mb-2 flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-text-muted">Prima</span>
                  {totalePrima && <span className="font-tenorite text-base font-semibold tabular-nums">{formatta(totalePrima.totale, totalePrima.unita)}</span>}
                </figcaption>
                {graficoPrima && risultatiPrima.length > 0 ? (
                  <GraficoDaAnalisi serie={risultatiPrima} aspetto={aspetto} tipo={graficoPrima} altezza={220} />
                ) : (
                  <p className="text-xs text-text-muted">Il riquadro attuale non è ancora calcolato.</p>
                )}
              </figure>

              <figure aria-label="Dopo" aria-busy={calcolo} className="min-w-0 rounded-lg border border-primary/40 p-3">
                <figcaption className="mb-2 flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-primary">Dopo</span>
                  {totaleDopo && <span className="font-tenorite text-base font-semibold tabular-nums text-primary">{formatta(totaleDopo.totale, totaleDopo.unita)}</span>}
                </figcaption>
                {erroreDopo ? (
                  <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
                    {erroreDopo}
                  </p>
                ) : dopo && tipoDopo ? (
                  <GraficoDaAnalisi serie={dopo} aspetto={aspetto} tipo={tipoDopo} altezza={220} />
                ) : (
                  <p role="status" className="text-xs text-text-muted">Calcolo il riquadro modificato…</p>
                )}
                {graficoNonAdatto && richiesto && tipoDopo && (
                  <p className="mt-2 text-xs text-warning">
                    Il grafico «{NOMI_GRAFICI[richiesto]}» non si adatta ai nuovi dati: resta «{NOMI_GRAFICI[tipoDopo]}».
                  </p>
                )}
                {totaleDopo && totaleDopo.avvisi.length > 0 && (
                  <ul className="mt-2 space-y-1" aria-label="Avvertenze del risultato">
                    {totaleDopo.avvisi.map((a) => (
                      <li key={a} className="text-xs text-warning">{a}</li>
                    ))}
                  </ul>
                )}
              </figure>
            </div>

            <p className="text-xs text-text-muted">
              {`Preparata da ${esito.modelli.join(" e poi ")} · costo ${esito.consumo.costoUsd.toLocaleString("it-IT", { maximumFractionDigits: 4 })} $.`}
            </p>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={scarta}
                className="min-h-10 rounded-lg border border-border bg-bg-page px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                Scarta
              </button>
              <button
                type="button"
                disabled={calcolo || !dopo || Boolean(erroreDopo)}
                onClick={applica}
                className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-bg focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              >
                Applica la modifica
              </button>
            </div>
          </div>
        )}
      </Scheda>
    </section>
  );
}
