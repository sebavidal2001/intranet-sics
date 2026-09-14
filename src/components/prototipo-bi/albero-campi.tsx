"use client";

/**
 * L'ALBERO DEI CAMPI.
 *
 * Prende il posto della sequenza di tendine — tipologia, metrica, raggruppa —
 * che chiedeva di compilare un modulo prima di vedere qualcosa. Qui si spunta
 * e appare.
 *
 * L'ispirazione è il pannello campi di Power BI, che è l'unico strumento del
 * genere che queste persone hanno già visto. Ma con due differenze che sono la
 * ragione per cui questo dovrebbe funzionare dove quello non è stato adottato:
 *
 * 1. **Etichette di mestiere.** Non `Fact_ordinato` e `Dim_clienti_agenti`:
 *    quelli sono i nomi di chi ha costruito il modello. Qui si legge
 *    «Ordinato» e «Clienti e agenti».
 * 2. **Nessuna misura da creare.** In Power BI una misura si scrive in DAX, e
 *    sbagliare un'aggregazione è facilissimo. Qui le misure esistono già,
 *    certificate, e si spuntano: non c'è un'aggregazione da scrivere, quindi
 *    non c'è un modo di sbagliarla.
 *
 * Due sezioni, non una, e la distinzione è dichiarata a parole: «che cosa vuoi
 * misurare» e «come vuoi vederlo suddiviso». È l'unica cosa che l'utente deve
 * capire, e lasciarla implicita nella struttura non basta.
 *
 * Il componente è **puro rispetto alla dashboard**: non chiama API, non sa cosa
 * sia una pagina, non salva. Riceve una selezione e ne comunica una nuova.
 */

import { useId, useState } from "react";
import { ChevronRight, GripVertical, ArrowUp, ArrowDown, X } from "lucide-react";
import {
  GRUPPI_DIMENSIONI,
  VOCI_CALENDARIO,
  motivoDimensioneNonAmmessa,
} from "@/lib/prototipo-bi/gruppi-campi";
import { ammetteConfrontoBudget, motivoBudgetNonDisponibile } from "@/lib/prototipo-bi/analisi-composita";
import type { ChiaveTipologia } from "@/lib/prototipo-bi/tassonomia";
import type {
  ChiaveMetrica,
  Dimensione,
  Granularita,
  RuoloSerie,
  SerieAnalisi,
  SpecQuery,
} from "@/lib/prototipo-bi/tipi";

// ─────────────────────────────────────────────────────────────────────────────
// Il contratto
// ─────────────────────────────────────────────────────────────────────────────

export interface SelezioneCampi {
  /** Le misure spuntate, in ordine di spunta. La prima è la principale. */
  misure: ChiaveMetrica[];
  /** Le dimensioni spuntate, in ordine. Al massimo due. */
  suddivisioni: Dimensione[];
  /** Granularità temporale, se spuntata nel Calendario. */
  granularita?: Granularita;
}

export const SELEZIONE_VUOTA: SelezioneCampi = { misure: [], suddivisioni: [] };

interface VoceMetrica {
  chiave: ChiaveMetrica;
  etichetta: string;
  descrizione: string;
  unita: string;
}

interface VoceTipologia {
  chiave: ChiaveTipologia;
  etichetta: string;
  descrizione: string;
  metriche: ChiaveMetrica[];
}

export interface VocabolarioAlbero {
  tipologie: VoceTipologia[];
  metriche: VoceMetrica[];
  dimensioni: { chiave: Dimensione; etichetta: string }[];
  dimensioniPerMetrica: Record<ChiaveMetrica, Dimensione[]>;
}

/**
 * Oltre le due dimensioni non esiste un grafico che le rappresenti.
 *
 * Il limite si dichiara prima invece di accettare la terza e ripiegare su una
 * tabella: chi ha spuntato tre cose e ne vede due disegnate pensa a un guasto.
 */
const MASSIME_SUDDIVISIONI = 2;

/**
 * Il ruolo che una misura prende quando non è la principale.
 *
 * Budget e BEP non sono confronti come gli altri: il resto del sistema li
 * disegna già come bersaglio e come soglia, e chiamarli «confronto» li
 * farebbe diventare una seconda linea indistinguibile.
 */
function ruoloPerMisura(metrica: ChiaveMetrica, primaSpuntata: boolean): RuoloSerie {
  if (primaSpuntata) return "principale";
  if (metrica === "budget") return "obiettivo";
  if (metrica === "bep") return "soglia";
  return "confronto";
}

/**
 * La selezione diventa ciò che il motore sa già eseguire.
 *
 * Senza misure non esiste una domanda, e restituire una spec vuota
 * significherebbe far partire una query che non vuol dire niente.
 */
export function specDaSelezione(
  selezione: SelezioneCampi,
  nomi?: Partial<Record<ChiaveMetrica, string>>
): { spec: SpecQuery; serie: SerieAnalisi[] | null } | null {
  const [principale, ...altre] = selezione.misure;
  if (!principale) return null;

  const base: SpecQuery = {
    metrica: principale,
    ...(selezione.suddivisioni.length > 0 ? { raggruppa: [...selezione.suddivisioni] } : {}),
    ...(selezione.granularita ? { granularita: selezione.granularita } : {}),
  };

  if (altre.length === 0) return { spec: base, serie: null };

  const serie: SerieAnalisi[] = selezione.misure.map((metrica, indice) => ({
    ruolo: ruoloPerMisura(metrica, indice === 0),
    nome: nomi?.[metrica] ?? metrica,
    spec: { ...base, metrica },
  }));
  return { spec: base, serie };
}

// ─────────────────────────────────────────────────────────────────────────────
// Regole di disponibilità
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le dimensioni ammesse da TUTTE le misure spuntate.
 *
 * L'intersezione, non l'unione: una dimensione che vale per la prima misura ma
 * non per la seconda produrrebbe una serie piena e una vuota affiancate, che
 * sembra un crollo e non lo è.
 */
export function dimensioniAmmesse(
  misure: ChiaveMetrica[],
  perMetrica: Record<ChiaveMetrica, Dimensione[]>
): Dimensione[] {
  if (misure.length === 0) return [];
  return misure.reduce<Dimensione[]>(
    (comuni, metrica) => comuni.filter((d) => (perMetrica[metrica] ?? []).includes(d)),
    [...(perMetrica[misure[0]] ?? [])]
  );
}

/**
 * Perché una misura non si può spuntare, dato ciò che è già selezionato.
 *
 * Restituisce `null` quando si può. Budget e BEP hanno un motivo tutto loro:
 * la serie di budget esiste solo per business unit e agente, e su qualunque
 * altro raggruppamento il motore restituisce in silenzio il totale su una riga
 * sola — un confronto che sembra legittimo e non significa niente.
 */
export function motivoMisuraNonSelezionabile(
  metrica: ChiaveMetrica,
  selezione: SelezioneCampi,
  perMetrica: Record<ChiaveMetrica, Dimensione[]>
): string | null {
  if (selezione.misure.includes(metrica)) return null;

  if (metrica === "budget" || metrica === "bep") {
    const finta: SpecQuery = { metrica, raggruppa: [...selezione.suddivisioni] };
    if (!ammetteConfrontoBudget(finta)) return motivoBudgetNonDisponibile(finta);
  }

  const ammesse = perMetrica[metrica] ?? [];
  const fuori = selezione.suddivisioni.filter((d) => !ammesse.includes(d));
  if (fuori.length > 0) {
    return `Questa misura non si può suddividere per ${fuori.join(" e ")}.`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interfaccia
// ─────────────────────────────────────────────────────────────────────────────

function Gruppo({
  etichetta,
  descrizione,
  apertoDiDefault,
  children,
}: {
  etichetta: string;
  descrizione: string;
  apertoDiDefault: boolean;
  children: React.ReactNode;
}) {
  const [aperto, setAperto] = useState(apertoDiDefault);
  const idContenuto = useId();
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setAperto((prima) => !prima)}
        aria-expanded={aperto}
        aria-controls={idContenuto}
        className="flex min-h-11 w-full items-center gap-2 px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${aperto ? "rotate-90" : ""}`}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="block truncate font-tenorite text-sm font-semibold">{etichetta}</span>
          {!aperto && <span className="block truncate text-xs text-text-muted">{descrizione}</span>}
        </span>
      </button>
      <div id={idContenuto} hidden={!aperto} className="pb-2 pl-8 pr-2">
        {children}
      </div>
    </div>
  );
}

function Casella({
  etichetta,
  spuntata,
  motivoBloccata,
  onCambia,
}: {
  etichetta: string;
  spuntata: boolean;
  motivoBloccata: string | null;
  onCambia: (spuntata: boolean) => void;
}) {
  const bloccata = motivoBloccata !== null && !spuntata;
  return (
    <label
      className={`flex min-h-10 items-center gap-2 rounded px-1 ${
        bloccata ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-bg-page"
      }`}
    >
      <input
        type="checkbox"
        checked={spuntata}
        disabled={bloccata}
        onChange={(evento) => onCambia(evento.target.checked)}
        className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
      />
      <span className="min-w-0 text-sm">
        <span className="block truncate">{etichetta}</span>
        {/*
          Il motivo va scritto, non affidato a un `title`: da tablet il
          passaggio del mouse non esiste e una casella grigia senza spiegazione
          sembra un guasto.
        */}
        {bloccata && <span className="block text-xs text-text-muted">{motivoBloccata}</span>}
      </span>
    </label>
  );
}

export function AlberoCampi({
  vocabolario,
  selezione,
  onCambia,
}: {
  vocabolario: VocabolarioAlbero;
  selezione: SelezioneCampi;
  onCambia: (selezione: SelezioneCampi) => void;
}) {
  const [trascinata, setTrascinata] = useState<number | null>(null);

  const etichettaMetrica = (chiave: ChiaveMetrica) =>
    vocabolario.metriche.find((m) => m.chiave === chiave)?.etichetta ?? chiave;
  const etichettaDimensione = (chiave: Dimensione) =>
    vocabolario.dimensioni.find((d) => d.chiave === chiave)?.etichetta ?? chiave;

  const ammesse = dimensioniAmmesse(selezione.misure, vocabolario.dimensioniPerMetrica);
  const pieno = selezione.suddivisioni.length >= MASSIME_SUDDIVISIONI;

  function cambiaMisura(metrica: ChiaveMetrica, spuntata: boolean) {
    const misure = spuntata
      ? [...selezione.misure, metrica]
      : selezione.misure.filter((m) => m !== metrica);
    // Togliendo una misura, le suddivisioni che solo lei ammetteva vanno via
    // con lei: lasciarle darebbe una spec che il motore non sa eseguire.
    const restano = dimensioniAmmesse(misure, vocabolario.dimensioniPerMetrica);
    onCambia({
      ...selezione,
      misure,
      suddivisioni: selezione.suddivisioni.filter((d) => misure.length === 0 || restano.includes(d)),
    });
  }

  function cambiaSuddivisione(dimensione: Dimensione, spuntata: boolean) {
    const suddivisioni = spuntata
      ? [...selezione.suddivisioni, dimensione]
      : selezione.suddivisioni.filter((d) => d !== dimensione);
    // Aggiungendo una suddivisione, una misura già spuntata può diventare
    // incompatibile (è il caso di budget fuori da BU e agente): va tolta,
    // altrimenti resterebbe a produrre una riga sola che sembra un dato.
    const misure = suddivisioni.length > selezione.suddivisioni.length
      ? selezione.misure.filter((metrica, indice) => {
          if (indice === 0) return true;
          const ammesseQui = vocabolario.dimensioniPerMetrica[metrica] ?? [];
          if (!suddivisioni.every((d) => ammesseQui.includes(d))) return false;
          if (metrica === "budget" || metrica === "bep") {
            return ammetteConfrontoBudget({ metrica, raggruppa: suddivisioni });
          }
          return true;
        })
      : selezione.misure;
    onCambia({ ...selezione, misure, suddivisioni });
  }

  function spostaSuddivisione(da: number, a: number) {
    if (a < 0 || a >= selezione.suddivisioni.length) return;
    const suddivisioni = [...selezione.suddivisioni];
    const [tolta] = suddivisioni.splice(da, 1);
    suddivisioni.splice(a, 0, tolta);
    onCambia({ ...selezione, suddivisioni });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="albero-misure" className="rounded-xl border border-border bg-bg">
        <header className="border-b border-border px-3 py-2">
          <h3 id="albero-misure" className="font-tenorite text-sm font-bold uppercase tracking-wide">
            Che cosa vuoi misurare
          </h3>
          <p className="mt-0.5 text-xs text-text-muted">
            Spuntane una e il grafico compare. Spuntane due e finiscono nello stesso riquadro.
          </p>
        </header>
        <div>
          {vocabolario.tipologie.map((tipologia, indice) => (
            <Gruppo
              key={tipologia.chiave}
              etichetta={tipologia.etichetta}
              descrizione={tipologia.descrizione}
              // Riaprendo un riquadro salvato, un gruppo chiuso nasconderebbe
              // proprio i campi gia' scelti: chi lo apre penserebbe di averli
              // persi.
              apertoDiDefault={
                indice === 0 || tipologia.metriche.some((m) => selezione.misure.includes(m))
              }
            >
              {tipologia.metriche.map((chiave) => (
                <Casella
                  key={chiave}
                  etichetta={etichettaMetrica(chiave)}
                  spuntata={selezione.misure.includes(chiave)}
                  motivoBloccata={motivoMisuraNonSelezionabile(
                    chiave,
                    selezione,
                    vocabolario.dimensioniPerMetrica
                  )}
                  onCambia={(spuntata) => cambiaMisura(chiave, spuntata)}
                />
              ))}
            </Gruppo>
          ))}
        </div>
      </section>

      <section aria-labelledby="albero-suddivisioni" className="rounded-xl border border-border bg-bg">
        <header className="border-b border-border px-3 py-2">
          <h3 id="albero-suddivisioni" className="font-tenorite text-sm font-bold uppercase tracking-wide">
            Come vuoi vederlo suddiviso
          </h3>
          <p className="mt-0.5 text-xs text-text-muted">
            Facoltativo, al massimo due. Senza suddivisioni vedi il totale.
          </p>
        </header>

        {selezione.suddivisioni.length > 0 && (
          <ol className="border-b border-border px-3 py-2" aria-label="Suddivisioni scelte, in ordine">
            {selezione.suddivisioni.map((dimensione, indice) => (
              <li
                key={dimensione}
                draggable
                onDragStart={() => setTrascinata(indice)}
                onDragOver={(evento) => evento.preventDefault()}
                onDrop={() => {
                  if (trascinata !== null) spostaSuddivisione(trascinata, indice);
                  setTrascinata(null);
                }}
                className="flex min-h-10 items-center gap-2 rounded bg-bg-page px-2 py-1"
              >
                <GripVertical className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="mr-1 text-xs font-semibold text-primary">{indice + 1}.</span>
                  {etichettaDimensione(dimensione)}
                </span>
                {/*
                  Il trascinamento non basta mai da solo: chi ha un trackpad,
                  chi ha la mano poco ferma e chi naviga da tastiera resterebbe
                  fuori, e su questo pubblico non è un caso limite.
                */}
                <button
                  type="button"
                  aria-label={`Sposta ${etichettaDimensione(dimensione)} più in alto`}
                  disabled={indice === 0}
                  onClick={() => spostaSuddivisione(indice, indice - 1)}
                  className="rounded p-2 text-text-muted hover:text-primary disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Sposta ${etichettaDimensione(dimensione)} più in basso`}
                  disabled={indice === selezione.suddivisioni.length - 1}
                  onClick={() => spostaSuddivisione(indice, indice + 1)}
                  className="rounded p-2 text-text-muted hover:text-primary disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Togli ${etichettaDimensione(dimensione)}`}
                  onClick={() => cambiaSuddivisione(dimensione, false)}
                  className="rounded p-2 text-text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
            <li className="pt-1 text-xs text-text-muted">
              La prima comanda l’asse, la seconda il colore.
            </li>
          </ol>
        )}

        <div>
          {GRUPPI_DIMENSIONI.map((gruppo, indice) => {
            // Solo le dimensioni che il vocabolario dichiara davvero: se una
            // sparisce dal modello, la casella non deve restare qui a promettere
            // un raggruppamento che il motore non sa fare.
            const visibili = gruppo.dimensioni.filter((d) =>
              vocabolario.dimensioni.some((voce) => voce.chiave === d)
            );
            if (visibili.length === 0) return null;
            return (
              <Gruppo
                key={gruppo.chiave}
                etichetta={gruppo.etichetta}
                descrizione={gruppo.descrizione}
                apertoDiDefault={
                  indice === 0 || gruppo.dimensioni.some((d) => selezione.suddivisioni.includes(d))
                }
              >
                {visibili.map((dimensione) => {
                  const spuntata = selezione.suddivisioni.includes(dimensione);
                  const motivo = selezione.misure.length === 0
                    ? "Scegli prima una misura"
                    : !ammesse.includes(dimensione)
                      ? motivoDimensioneNonAmmessa(dimensione)
                      : pieno
                        ? "Al massimo due: togline una"
                        : null;
                  return (
                    <Casella
                      key={dimensione}
                      etichetta={etichettaDimensione(dimensione)}
                      spuntata={spuntata}
                      motivoBloccata={motivo}
                      onCambia={(valore) => cambiaSuddivisione(dimensione, valore)}
                    />
                  );
                })}
              </Gruppo>
            );
          })}

          <Gruppo
            etichetta="Calendario"
            descrizione="Per vedere l’andamento nel tempo."
            apertoDiDefault={selezione.granularita !== undefined}
          >
            {/*
              A scelta singola, e non per gusto: giorno, settimana, mese e anno
              sono la stessa cosa a granularità diverse. Spuntare «mese» e
              «anno» insieme non significa niente.
            */}
            {VOCI_CALENDARIO.map((voce) => (
              <Casella
                key={voce.chiave}
                etichetta={voce.etichetta}
                spuntata={selezione.granularita === voce.chiave}
                motivoBloccata={selezione.misure.length === 0 ? "Scegli prima una misura" : null}
                onCambia={(spuntata) =>
                  onCambia({
                    ...selezione,
                    granularita: spuntata ? voce.chiave : undefined,
                  })
                }
              />
            ))}
          </Gruppo>
        </div>
      </section>
    </div>
  );
}
