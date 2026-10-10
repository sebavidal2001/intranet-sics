"use client";

/**
 * Il tipo di grafico, in una fila di anteprime.
 *
 * Come il pannello «Visualizzazioni» di Power BI: i tipi possibili stanno tutti
 * in vista, uno clic li cambia, e il grafico si ridisegna senza altra scelta.
 * Mostra solo quelli che la forma del dato regge (`graficiPossibili`): la fila
 * si accorcia da sola, ed e' il motivo per cui sotto il grafico resta scritto
 * cosa serve per sbloccarne altri.
 */

import { BarChart3, Table2 } from "lucide-react";
import { NOMI_GRAFICI, type TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import { AnteprimaGrafico } from "./scelta-grafico";

export function TipoGraficoCompatto({
  valore,
  opzioni,
  onChange,
}: {
  valore: TipoGrafico;
  opzioni: TipoGrafico[];
  onChange: (tipo: TipoGrafico) => void;
}) {
  return (
    <section aria-label="Tipo di grafico">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="font-tenorite text-[11px] font-bold uppercase tracking-wide">Visualizzazione</h3>
        <span className="truncate text-xs text-text-muted">{NOMI_GRAFICI[valore]}</span>
      </div>
      <div role="group" aria-label="Visualizzazione" className="flex flex-wrap gap-1">
        {opzioni.map((tipo) => (
          <button
            key={tipo}
            type="button"
            title={NOMI_GRAFICI[tipo]}
            aria-label={`Visualizzazione: ${NOMI_GRAFICI[tipo]}`}
            aria-pressed={tipo === valore}
            onClick={() => onChange(tipo)}
            className={`flex h-8 w-11 items-center justify-center rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
              tipo === valore
                ? "border-primary bg-primary/10"
                : "border-border bg-bg-page hover:border-primary/60"
            }`}
          >
            <AnteprimaGrafico tipo={tipo} className="h-5 w-8 !border-0 !bg-transparent" />
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Grafico o tabella: la prima scelta, prima ancora dei campi.
 *
 * Una tabella non e' un grafico che ripiega: ha pozzetti suoi (nessun asse ne'
 * legenda, tutti i campi che si vogliono) e per questo si sceglie all'inizio,
 * come in Power BI quando si sceglie la visualizzazione «Tabella». Resta
 * disponibile anche quando ancora non c'e' nessun dato.
 */
export function ModoVisualizzazione({
  modalita,
  onCambia,
}: {
  modalita: "grafico" | "tabella";
  onCambia: (modalita: "grafico" | "tabella") => void;
}) {
  const voci = [
    { chiave: "grafico", etichetta: "Grafico", Icona: BarChart3 },
    { chiave: "tabella", etichetta: "Tabella", Icona: Table2 },
  ] as const;
  return (
    <div role="group" aria-label="Come vuoi vedere i dati" className="grid shrink-0 grid-cols-2 gap-1 rounded-lg bg-bg-page p-0.5">
      {voci.map(({ chiave, etichetta, Icona }) => (
        <button
          key={chiave}
          type="button"
          aria-pressed={modalita === chiave}
          onClick={() => onCambia(chiave)}
          className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
            modalita === chiave ? "bg-bg text-primary shadow-sm" : "text-text-muted hover:text-text"
          }`}
        >
          <Icona className="h-3.5 w-3.5" aria-hidden />
          {etichetta}
        </button>
      ))}
    </div>
  );
}
