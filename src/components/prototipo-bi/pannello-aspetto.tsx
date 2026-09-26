"use client";

/**
 * «Aspetto del grafico»: colori, legenda, assi e totali di un riquadro.
 *
 * Sta in una sezione a parte, chiusa di default, perché è tutto facoltativo:
 * chi costruisce un riquadro deve poter arrivare al risultato senza passare di
 * qui. Ogni voce parte da «Automatico», che vuol dire «come dicono le
 * impostazioni generali dei grafici» — e ci si può sempre tornare.
 *
 * Niente di quello che si sceglie qui entra nella domanda: cambiare un colore
 * non rilancia il calcolo.
 */

import { useState } from "react";
import { ChevronDown, Palette, RotateCcw } from "lucide-react";
import { COLORI_BU, COLORI_SICS, coloreFissato } from "@/lib/prototipo-bi/aspetto";
import type {
  AggregazioneTotale,
  AspettoAsse,
  AspettoGrafico,
  PosizioneLegenda,
} from "@/lib/prototipo-bi/tipi";
import { NOMI_AGGREGAZIONE } from "./tabella-analitica";
import { useImpostazioni } from "./impostazioni";

const CLASSE_CAMPO =
  "min-h-9 w-full rounded-lg border border-border bg-bg-page px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary";

const TINTE_SICS = Object.values(COLORI_SICS);

type TreStati = "auto" | "si" | "no";

function daBooleano(valore: boolean | undefined): TreStati {
  return valore === undefined ? "auto" : valore ? "si" : "no";
}

function aBooleano(valore: TreStati): boolean | undefined {
  return valore === "auto" ? undefined : valore === "si";
}

/** Toglie le chiavi rimaste vuote: un aspetto vuoto si salva come `null`. */
function compatta(aspetto: AspettoGrafico): AspettoGrafico | null {
  const copia: AspettoGrafico = { ...aspetto };
  (Object.keys(copia) as (keyof AspettoGrafico)[]).forEach((chiave) => {
    const v = copia[chiave];
    if (v === undefined || (typeof v === "object" && v !== null && Object.keys(v).length === 0)) {
      delete copia[chiave];
    }
  });
  return Object.keys(copia).length > 0 ? copia : null;
}

function senzaVuoti<T extends object>(oggetto: T): T | undefined {
  const pulito = Object.fromEntries(
    Object.entries(oggetto).filter(([, v]) => v !== undefined && v !== "")
  ) as T;
  return Object.keys(pulito).length > 0 ? pulito : undefined;
}

/** Ordinamenti offerti: le chiavi delle colonne vere dipendono dalla tabella. */
const ORDINAMENTI: { valore: string; etichetta: string; ordinaPer?: string; verso?: "asc" | "desc" }[] = [
  { valore: "auto", etichetta: "Automatico" },
  { valore: "voce_asc", etichetta: "Per voce, dalla A (o in ordine di tempo)", ordinaPer: "voce", verso: "asc" },
  { valore: "voce_desc", etichetta: "Per voce, dalla Z (dal più recente)", ordinaPer: "voce", verso: "desc" },
  { valore: "valore_desc", etichetta: "Per valore, dal più grande", ordinaPer: "valore", verso: "desc" },
  { valore: "valore_asc", etichetta: "Per valore, dal più piccolo", ordinaPer: "valore", verso: "asc" },
];

function RigaColore({
  nome,
  effettivo,
  scelto,
  onCambia,
}: {
  nome: string;
  effettivo: string;
  scelto: string | undefined;
  onCambia: (colore: string | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="h-4 w-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: effettivo }} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm" title={nome}>
        {nome}
      </span>
      <div className="flex items-center gap-1" role="group" aria-label={`Colore di ${nome}`}>
        <button
          type="button"
          aria-label={`${nome}: automatico`}
          aria-pressed={scelto === undefined}
          title="Automatico"
          onClick={() => onCambia(undefined)}
          className={`h-6 w-6 rounded-full border text-[10px] font-semibold leading-none focus:outline-none focus:ring-2 focus:ring-primary ${
            scelto === undefined ? "border-primary text-primary" : "border-border text-text-muted"
          }`}
        >
          A
        </button>
        {TINTE_SICS.map((tinta) => (
          <button
            key={tinta}
            type="button"
            aria-label={`${nome}: ${tinta}`}
            aria-pressed={scelto?.toLowerCase() === tinta.toLowerCase()}
            title={tinta}
            onClick={() => onCambia(tinta.toLowerCase())}
            style={{ backgroundColor: tinta }}
            className={`h-6 w-6 rounded-full border-2 focus:outline-none focus:ring-2 focus:ring-primary ${
              scelto?.toLowerCase() === tinta.toLowerCase() ? "border-text scale-110" : "border-transparent"
            }`}
          />
        ))}
        <input
          type="color"
          aria-label={`${nome}: colore libero`}
          title="Scegli un colore qualsiasi"
          value={(scelto ?? effettivo).toLowerCase()}
          onChange={(e) => onCambia(e.target.value.toLowerCase())}
          className="h-6 w-6 cursor-pointer rounded-full border border-border bg-transparent p-0"
        />
      </div>
    </div>
  );
}

function CampiAsse({
  titolo,
  asse,
  conEstremi,
  onCambia,
}: {
  titolo: string;
  asse: AspettoAsse | undefined;
  conEstremi: boolean;
  onCambia: (asse: AspettoAsse | undefined) => void;
}) {
  const aggiorna = (parziale: Partial<AspettoAsse>) => onCambia(senzaVuoti({ ...asse, ...parziale }));
  const numero = (testo: string) => (testo.trim() === "" ? undefined : Number(testo));
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium">{titolo}</legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={asse?.visibile !== false}
          onChange={(e) => aggiorna({ visibile: e.target.checked ? undefined : false })}
          className="h-4 w-4 accent-primary"
        />
        Visibile
      </label>
      <label className="mt-2 block text-xs text-text-muted">
        Titolo
        <input
          value={asse?.titolo ?? ""}
          placeholder="Nessuno"
          maxLength={80}
          onChange={(e) => aggiorna({ titolo: e.target.value || undefined })}
          className={`${CLASSE_CAMPO} mt-1`}
        />
      </label>
      {conEstremi && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-xs text-text-muted">
            Minimo
            <input
              type="number"
              value={asse?.minimo ?? ""}
              placeholder="Auto"
              onChange={(e) => aggiorna({ minimo: numero(e.target.value) })}
              className={`${CLASSE_CAMPO} mt-1`}
            />
          </label>
          <label className="text-xs text-text-muted">
            Massimo
            <input
              type="number"
              value={asse?.massimo ?? ""}
              placeholder="Auto"
              onChange={(e) => aggiorna({ massimo: numero(e.target.value) })}
              className={`${CLASSE_CAMPO} mt-1`}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}

export function PannelloAspetto({
  aspetto,
  onCambia,
  nomiSerie,
  categorie,
}: {
  aspetto: AspettoGrafico | null;
  onCambia: (aspetto: AspettoGrafico | null) => void;
  /** Le misure del riquadro, nell'ordine in cui prendono i colori della palette. */
  nomiSerie: string[];
  /** Le voci della prima suddivisione (business unit, agenti…), se ce n'è una. */
  categorie: string[];
}) {
  const { palette } = useImpostazioni();
  const [aperto, setAperto] = useState(aspetto !== null);
  const corrente = aspetto ?? {};

  function aggiorna(parziale: Partial<AspettoGrafico>) {
    onCambia(compatta({ ...corrente, ...parziale }));
  }

  function cambiaColore(nome: string, colore: string | undefined) {
    const colori = { ...(corrente.colori ?? {}) };
    if (colore === undefined) delete colori[nome];
    else colori[nome] = colore;
    aggiorna({ colori: Object.keys(colori).length > 0 ? colori : undefined });
  }

  // Le serie prendono la palette per posizione; le categorie anche, salvo le
  // business unit che hanno il loro colore fisso.
  const vociColore = [
    ...nomiSerie.map((nome, i) => ({ nome, gruppo: "Misure", indice: i })),
    ...categorie
      .filter((nome) => !nomiSerie.includes(nome))
      .map((nome, i) => ({ nome, gruppo: "Voci", indice: i })),
  ];
  const ordinamento =
    ORDINAMENTI.find(
      (voce) => voce.ordinaPer === corrente.tabella?.ordinaPer && voce.verso === corrente.tabella?.verso
    )?.valore ?? "auto";

  return (
    <section className="rounded-xl border border-border bg-bg" aria-labelledby="titolo-aspetto">
      <button
        type="button"
        onClick={() => setAperto((a) => !a)}
        aria-expanded={aperto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" aria-hidden />
          <span>
            <span id="titolo-aspetto" className="block font-tenorite text-base font-semibold">
              Aspetto del grafico
            </span>
            <span className="block text-xs text-text-muted">
              Facoltativo: colori, legenda, assi e totali della tabella
              {aspetto ? " · personalizzato" : ""}
            </span>
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${aperto ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {aperto && (
        <div className="space-y-4 border-t border-border px-4 py-4">
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Colori</h3>
            <p className="mb-2 text-xs text-text-muted">
              «A» segue la palette; le business unit hanno già il colore aziendale e qui si può cambiare solo per questo riquadro.
            </p>
            {vociColore.length === 0 ? (
              <p className="text-sm text-text-muted">Nessuna serie da colorare.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto pr-1">
                {vociColore.map((voce) => (
                  <RigaColore
                    key={`${voce.gruppo}-${voce.nome}`}
                    nome={voce.nome}
                    scelto={corrente.colori?.[voce.nome]}
                    effettivo={
                      coloreFissato(voce.nome, aspetto) ??
                      COLORI_BU[voce.nome] ??
                      palette.serie[voce.indice % palette.serie.length]
                    }
                    onCambia={(colore) => cambiaColore(voce.nome, colore)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-text-muted">
              Legenda
              <select
                aria-label="Legenda"
                value={corrente.legenda ?? "auto"}
                onChange={(e) =>
                  aggiorna({ legenda: e.target.value === "auto" ? undefined : (e.target.value as PosizioneLegenda) })
                }
                className={`${CLASSE_CAMPO} mt-1`}
              >
                <option value="auto">Automatica</option>
                <option value="sotto">Sotto</option>
                <option value="sopra">Sopra</option>
                <option value="destra">A destra</option>
                <option value="nascosta">Nascosta</option>
              </select>
            </label>
            <label className="text-xs text-text-muted">
              Griglia
              <select
                aria-label="Griglia"
                value={daBooleano(corrente.griglia)}
                onChange={(e) => aggiorna({ griglia: aBooleano(e.target.value as TreStati) })}
                className={`${CLASSE_CAMPO} mt-1`}
              >
                <option value="auto">Automatica</option>
                <option value="si">Sì</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="text-xs text-text-muted">
              Valori sulle barre
              <select
                aria-label="Valori sulle barre"
                value={daBooleano(corrente.etichetteValori)}
                onChange={(e) => aggiorna({ etichetteValori: aBooleano(e.target.value as TreStati) })}
                className={`${CLASSE_CAMPO} mt-1`}
              >
                <option value="auto">Automatico</option>
                <option value="si">Mostra</option>
                <option value="no">Nascondi</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <CampiAsse
              titolo="Asse orizzontale (categorie o tempo)"
              asse={corrente.asseX}
              conEstremi={false}
              onCambia={(asseX) => aggiorna({ asseX })}
            />
            <CampiAsse
              titolo="Asse dei valori"
              asse={corrente.asseY}
              conEstremi
              onCambia={(asseY) => aggiorna({ asseY })}
            />
          </div>

          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium">Tabella</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-text-muted">
                Riga dei totali
                <select
                  aria-label="Riga dei totali della tabella"
                  value={corrente.tabella?.totale ?? "automatico"}
                  onChange={(e) => {
                    const totale = e.target.value as AggregazioneTotale;
                    aggiorna({
                      tabella: senzaVuoti({
                        ...corrente.tabella,
                        totale: totale === "automatico" ? undefined : totale,
                      }),
                    });
                  }}
                  className={`${CLASSE_CAMPO} mt-1`}
                >
                  {(Object.keys(NOMI_AGGREGAZIONE) as AggregazioneTotale[]).map((chiave) => (
                    <option key={chiave} value={chiave}>
                      {NOMI_AGGREGAZIONE[chiave]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-text-muted">
                Ordinamento iniziale
                <select
                  aria-label="Ordinamento iniziale della tabella"
                  value={ordinamento}
                  onChange={(e) => {
                    const scelta = ORDINAMENTI.find((voce) => voce.valore === e.target.value);
                    aggiorna({
                      tabella: senzaVuoti({
                        ...corrente.tabella,
                        ordinaPer: scelta?.ordinaPer,
                        verso: scelta?.verso,
                      }),
                    });
                  }}
                  className={`${CLASSE_CAMPO} mt-1`}
                >
                  {ORDINAMENTI.map((voce) => (
                    <option key={voce.valore} value={voce.valore}>
                      {voce.etichetta}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-xs text-text-muted">
              Valgono quando il riquadro è mostrato come tabella. Da lì si può comunque riordinare cliccando le intestazioni.
            </p>
          </fieldset>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => onCambia(null)}
              disabled={!aspetto}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-muted hover:text-text disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Torna tutto automatico
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
