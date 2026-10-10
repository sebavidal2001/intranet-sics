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
 * 2. **Nessuna misura da scrivere.** In Power BI una misura si scrive in DAX, e
 *    sbagliare un'aggregazione è facilissimo. Qui le misure esistono già,
 *    certificate, e ognuna dice come si calcola: non c'è un'aggregazione da
 *    scrivere, quindi non c'è un modo di sbagliarla.
 *
 * Tre sezioni, nell'ordine in cui si ragiona (vedi `albero-modello.ts`):
 *
 *   Campi comuni — con cosa si suddivide qualunque operazione: clienti e
 *                  agenti, prodotti, tempo;
 *   Operazioni   — che cosa è successo: ordinato, fatturato, preventivi,
 *                  acquisti, visite. Ognuna con i suoi valori (somme e
 *                  conteggi) e i campi che le appartengono (il numero del
 *                  documento, il CAP delle visite);
 *   Misure       — i calcoli: valori medi, tassi, percentuali. Ognuno dice
 *                  come si calcola, e da ognuno si può partire per farne una
 *                  variante.
 *
 * Il componente è **puro rispetto alla dashboard**: non chiama API, non sa cosa
 * sia una pagina, non salva. Riceve una selezione e ne comunica una nuova.
 */

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { CalendarDays, ChevronRight, GripVertical, ArrowUp, ArrowDown, Info, Tag, Trash2, X } from "lucide-react";
import { VOCI_CALENDARIO, motivoDimensioneNonAmmessa } from "@/lib/prototipo-bi/gruppi-campi";
import {
  CARTELLE,
  GRUPPI_COMUNI,
  calcoloDellaMetrica,
  MOTIVO_DOCUMENTO_MISTO,
  eDocumento,
  MOTIVO_MISURA_ALTRA_OPERAZIONE,
  NATURE,
  famigliaDellaMetrica,
  naturaDellaVoce,
  testoPerPartireDa,
  type NaturaValore,
} from "@/lib/prototipo-bi/albero-modello";
import { ammetteConfrontoBudget, motivoBudgetNonDisponibile } from "@/lib/prototipo-bi/analisi-composita";
import {
  NOMI_VARIANTE,
  chiaveBase,
  eChiaveMisura,
  scomponiValore,
  specPerChiave,
  type ChiaveCampo,
  type ChiaveValore,
} from "@/lib/prototipo-bi/misure-vocabolario";
import type { ChiaveTipologia } from "@/lib/prototipo-bi/tassonomia";
import { TIPO_MIME_CAMPO, impostaTrascinamento, type VoceCampo } from "./pozzetti-trascinamento";
import type {
  Dimensione,
  Granularita,
  MisuraDefinita,
  RuoloSerie,
  SerieAnalisi,
  SpecQuery,
} from "@/lib/prototipo-bi/tipi";

// ─────────────────────────────────────────────────────────────────────────────
// Il contratto
// ─────────────────────────────────────────────────────────────────────────────

export interface SelezioneCampi {
  /**
   * I valori spuntati, in ordine di spunta. Il primo è il principale. Sono
   * metriche del catalogo o misure personalizzate (`misura:<id>`), ciascuna
   * col suo periodo se diverso dal corrente (`ordinato@anno_precedente`).
   */
  misure: ChiaveValore[];
  /** Le dimensioni spuntate, in ordine. Nei grafici al massimo due; nelle tabelle quante se ne vogliono. */
  suddivisioni: Dimensione[];
  /** Granularità temporale, se spuntata nel Calendario. */
  granularita?: Granularita;
}

export const SELEZIONE_VUOTA: SelezioneCampi = { misure: [], suddivisioni: [] };

interface VoceMetrica {
  chiave: ChiaveCampo;
  etichetta: string;
  descrizione: string;
  unita: string;
}

interface VoceTipologia {
  chiave: ChiaveTipologia;
  etichetta: string;
  descrizione: string;
  metriche: ChiaveCampo[];
}

export interface VocabolarioAlbero {
  tipologie: VoceTipologia[];
  metriche: VoceMetrica[];
  dimensioni: { chiave: Dimensione; etichetta: string }[];
  dimensioniPerMetrica: Record<string, Dimensione[]>;
  /**
   * Le operazioni coinvolte da ogni misura personalizzata. Per le metriche del
   * catalogo le conosce il modello (`famigliaDellaMetrica`): qui servono solo
   * quelle nate da una definizione.
   */
  famiglie?: Record<string, string[]>;
  /** Le definizioni delle misure personalizzate, per riconoscerne la natura. */
  definizioni?: Record<string, MisuraDefinita>;
}

/**
 * Oltre le due dimensioni non esiste un grafico che le rappresenti.
 *
 * Il limite si dichiara prima invece di accettare la terza e ripiegare su una
 * tabella: chi ha spuntato tre cose e ne vede due disegnate pensa a un guasto.
 * Nelle tabelle il limite non c'è: ogni campo è una colonna.
 */
export const MASSIME_SUDDIVISIONI = 2;

/**
 * Il ruolo che una misura prende quando non è la principale.
 *
 * Budget e BEP non sono confronti come gli altri: il resto del sistema li
 * disegna già come bersaglio e come soglia, e chiamarli «confronto» li
 * farebbe diventare una seconda linea indistinguibile.
 */
function ruoloPerMisura(valore: ChiaveValore, primaSpuntata: boolean): RuoloSerie {
  if (primaSpuntata) return "principale";
  const metrica = chiaveBase(valore);
  if (metrica === "budget") return "obiettivo";
  if (metrica === "bep") return "soglia";
  return "confronto";
}

/** Il nome di un valore con periodo: «Ordinato · anno precedente». */
export function nomeConPeriodo(etichetta: string, valore: string): string {
  const { variante } = scomponiValore(valore);
  return variante ? `${etichetta} · ${NOMI_VARIANTE[variante].toLocaleLowerCase("it")}` : etichetta;
}

/**
 * La selezione diventa ciò che il motore sa già eseguire.
 *
 * Senza misure non esiste una domanda, e restituire una spec vuota
 * significherebbe far partire una query che non vuol dire niente.
 */
export function specDaSelezione(
  selezione: SelezioneCampi,
  nomi?: Partial<Record<string, string>>,
  /** Le definizioni delle misure personalizzate spuntate, per chiave. */
  definizioni: Record<string, MisuraDefinita> = {}
): { spec: SpecQuery; serie: SerieAnalisi[] | null } | null {
  const [principale, ...altre] = selezione.misure;
  if (!principale) return null;

  const comune = {
    ...(selezione.suddivisioni.length > 0 ? { raggruppa: [...selezione.suddivisioni] } : {}),
    ...(selezione.granularita ? { granularita: selezione.granularita } : {}),
  };
  // Una misura senza definizione disponibile non si puo' eseguire: meglio
  // nessuna domanda che una domanda su un'altra metrica.
  const specDi = (valore: ChiaveValore): SpecQuery | null => {
    const chiave = chiaveBase(valore);
    return specPerChiave({ metrica: eChiaveMisura(chiave) ? "ordinato" : chiave, ...comune }, valore, definizioni);
  };

  const base = specDi(principale);
  if (!base) return null;
  if (altre.length === 0) return { spec: base, serie: null };

  const serie: SerieAnalisi[] = [];
  for (const [indice, valore] of selezione.misure.entries()) {
    const spec = specDi(valore);
    if (!spec) return null;
    const chiave = chiaveBase(valore);
    serie.push({
      ruolo: ruoloPerMisura(valore, indice === 0),
      nome: nomi?.[valore] ?? nomeConPeriodo(nomi?.[chiave] ?? definizioni[chiave]?.nome ?? chiave, valore),
      spec,
    });
  }
  return { spec: base, serie };
}

// ─────────────────────────────────────────────────────────────────────────────
// Regole di disponibilità
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le operazioni (dataset) a cui appartengono i valori scelti.
 *
 * Le metriche del catalogo le conosce il modello; per le misure personalizzate
 * le dichiara il vocabolario (`famiglie`), perché dipendono dagli operandi.
 */
export function famiglieDelleMisure(misure: readonly string[], famiglie: Record<string, string[]> = {}): string[] {
  const trovate = new Set<string>();
  for (const valore of misure) {
    const chiave = chiaveBase(valore);
    const proprie = famiglie[chiave] ?? (eChiaveMisura(chiave) ? [] : [famigliaDellaMetrica(chiave)]);
    for (const f of proprie) trovate.add(f);
  }
  return [...trovate];
}

/**
 * Le dimensioni ammesse da TUTTE le misure spuntate.
 *
 * L'intersezione, non l'unione: una dimensione che vale per la prima misura ma
 * non per la seconda produrrebbe una serie piena e una vuota affiancate, che
 * sembra un crollo e non lo è.
 *
 * Il numero del documento è un'eccezione che l'intersezione non vede: vale per
 * tutte le misure, ma ordine 4521 e fattura 4521 sono cose diverse. Con valori
 * di operazioni diverse si toglie, come il server già fa per le misure
 * personalizzate che mescolano dataset.
 */
export function dimensioniAmmesse(
  misure: ChiaveValore[],
  perMetrica: Record<string, Dimensione[]>,
  famiglie?: Record<string, string[]>,
  /** Le suddivisioni gia' scelte: servono solo quando non c'e' ancora nessuna misura. */
  suddivisioniScelte: readonly Dimensione[] = []
): Dimensione[] {
  // Si puo' partire dal divisore, come in una tabella pivot: senza misure sono
  // ammesse le dimensioni che almeno una misura sa affiancare a quelle gia'
  // scelte. Poi sono le misure a restringersi (`motivoMisuraNonSelezionabile`):
  // il classificatore sceglie quali valori ha senso mettergli accanto.
  if (misure.length === 0) {
    const compatibili = Object.values(perMetrica).filter((ammesse) => suddivisioniScelte.every((d) => ammesse.includes(d)));
    return [...new Set(compatibili.flat())];
  }
  const comuni = misure.reduce<Dimensione[]>(
    (restanti, valore) => restanti.filter((d) => (perMetrica[chiaveBase(valore)] ?? []).includes(d)),
    [...(perMetrica[chiaveBase(misure[0])] ?? [])]
  );
  return famiglieDelleMisure(misure, famiglie).length > 1 ? comuni.filter((d) => !eDocumento(d)) : comuni;
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
  valore: ChiaveValore,
  selezione: SelezioneCampi,
  perMetrica: Record<string, Dimensione[]>,
  famiglie?: Record<string, string[]>
): string | null {
  if (selezione.misure.includes(valore)) return null;
  const metrica = chiaveBase(valore);

  if (metrica === "budget" || metrica === "bep") {
    const finta: SpecQuery = { metrica, raggruppa: [...selezione.suddivisioni] };
    if (!ammetteConfrontoBudget(finta)) return motivoBudgetNonDisponibile(finta);
  }

  const ammesse = perMetrica[metrica] ?? [];
  const fuori = selezione.suddivisioni.filter((d) => !ammesse.includes(d));
  if (fuori.length > 0) {
    return `Questa misura non si può suddividere per ${fuori.join(" e ")}.`;
  }

  if (selezione.suddivisioni.some(eDocumento)) {
    const insieme = famiglieDelleMisure([...selezione.misure, valore], famiglie);
    if (insieme.length > 1) return MOTIVO_MISURA_ALTRA_OPERAZIONE;
  }
  return null;
}

/** Perché le misure scelte non ammettono una dimensione: il numero del documento ha un motivo suo. */
export function motivoDimensioneFuoriDalleMisure(
  dimensione: Dimensione,
  misure: readonly string[],
  famiglie?: Record<string, string[]>
): string {
  return eDocumento(dimensione) && famiglieDelleMisure(misure, famiglie).length > 1
    ? MOTIVO_DOCUMENTO_MISTO
    : motivoDimensioneNonAmmessa(dimensione);
}

/**
 * Perché una dimensione non si può spuntare, o `null` se si può.
 *
 * Una dimensione già spuntata non si blocca mai da sola: serve poterla
 * togliere. `senzaLimite` è per le tabelle, dove ogni campo è una colonna.
 */
export function motivoDimensioneNonSelezionabile(
  dimensione: Dimensione,
  selezione: SelezioneCampi,
  perMetrica: Record<string, Dimensione[]>,
  famiglie?: Record<string, string[]>,
  senzaLimite = false
): string | null {
  if (selezione.suddivisioni.includes(dimensione)) return null;
  if (!dimensioniAmmesse(selezione.misure, perMetrica, famiglie, selezione.suddivisioni).includes(dimensione)) {
    return selezione.misure.length === 0
      ? "Nessuna misura si può suddividere insieme ai campi già scelti"
      : motivoDimensioneFuoriDalleMisure(dimensione, selezione.misure, famiglie);
  }
  if (!senzaLimite && selezione.suddivisioni.length >= MASSIME_SUDDIVISIONI) return "Al massimo due: togline una";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trasformazioni della selezione (pure)
//
// Le usano sia le caselle dell'albero sia i pozzetti: due modi di fare la stessa
// cosa devono dare lo stesso risultato, e l'unico modo di garantirlo e' che
// passino dalla stessa funzione.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le misure che restano valide con queste suddivisioni.
 *
 * Una misura in piu' puo' diventare incompatibile quando si aggiunge una
 * suddivisione (e' il caso di budget e BEP fuori da business unit e agente, e
 * del numero del documento con operazioni diverse): va tolta, altrimenti
 * resterebbe a produrre una riga sola che sembra un dato, o una tabella che
 * accosta un ordine e una fattura che non c'entrano. La prima (la principale)
 * non si tocca mai. Restituisce anche quelle tolte, per poterlo dire a chi ha
 * fatto il gesto.
 */
export function riconciliaMisure(
  selezione: SelezioneCampi,
  suddivisioni: Dimensione[],
  perMetrica: Record<string, Dimensione[]>,
  famiglie?: Record<string, string[]>
): { misure: ChiaveValore[]; tolte: ChiaveValore[] } {
  const famigliaPrincipale = selezione.misure[0] ? famiglieDelleMisure([selezione.misure[0]], famiglie) : [];
  const misure = selezione.misure.filter((valore, indice) => {
    if (indice === 0) return true;
    const metrica = chiaveBase(valore);
    const ammesseQui = perMetrica[metrica] ?? [];
    if (!suddivisioni.every((d) => ammesseQui.includes(d))) return false;
    if (metrica === "budget" || metrica === "bep") {
      if (!ammetteConfrontoBudget({ metrica, raggruppa: suddivisioni })) return false;
    }
    if (suddivisioni.some(eDocumento)) {
      const sue = famiglieDelleMisure([valore], famiglie);
      if (new Set([...famigliaPrincipale, ...sue]).size > 1) return false;
    }
    return true;
  });
  return { misure, tolte: selezione.misure.filter((m) => !misure.includes(m)) };
}

/** Spunta o toglie una misura. Togliendola, le suddivisioni che solo lei ammetteva vanno via con lei. */
export function selezioneConMisura(
  selezione: SelezioneCampi,
  valore: ChiaveValore,
  spuntata: boolean,
  perMetrica: Record<string, Dimensione[]>,
  famiglie?: Record<string, string[]>
): SelezioneCampi {
  const misure = spuntata ? [...selezione.misure, valore] : selezione.misure.filter((m) => m !== valore);
  // Tolta l'ultima misura i campi scelti restano: si puo' partire dal divisore
  // (il fornitore, il cliente) e scegliere i valori dopo. Il riquadro e' vuoto
  // finche' non c'e' un valore; l'errore c'e' solo se si prova a salvare.
  if (misure.length === 0) return { ...selezione, misure: [] };
  // Togliendo una misura, le suddivisioni che solo lei ammetteva vanno via con
  // lei: lasciarle darebbe una spec che il motore non sa eseguire.
  const restano = dimensioniAmmesse(misure, perMetrica, famiglie);
  return {
    ...selezione,
    misure,
    suddivisioni: selezione.suddivisioni.filter((d) => misure.length === 0 || restano.includes(d)),
  };
}

/** Spunta o toglie una suddivisione, riconciliando le misure se se ne aggiunge una. */
export function selezioneConSuddivisione(
  selezione: SelezioneCampi,
  dimensione: Dimensione,
  spuntata: boolean,
  perMetrica: Record<string, Dimensione[]>,
  famiglie?: Record<string, string[]>
): SelezioneCampi {
  const suddivisioni = spuntata
    ? [...selezione.suddivisioni, dimensione]
    : selezione.suddivisioni.filter((d) => d !== dimensione);
  const misure =
    suddivisioni.length > selezione.suddivisioni.length
      ? riconciliaMisure(selezione, suddivisioni, perMetrica, famiglie).misure
      : selezione.misure;
  return { ...selezione, misure, suddivisioni };
}

// ─────────────────────────────────────────────────────────────────────────────
// Interfaccia
// ─────────────────────────────────────────────────────────────────────────────

/** Vero dentro il pannello laterale del builder: righe piu' basse, niente descrizioni. */
const ContestoCompatto = createContext(false);

function Gruppo({
  etichetta,
  descrizione,
  apertoDiDefault,
  forzaAperto = false,
  conteggio,
  children,
}: {
  etichetta: string;
  descrizione: string;
  apertoDiDefault: boolean;
  /** Durante una ricerca i gruppi con risultati restano aperti: chiusi, li nasconderebbero. */
  forzaAperto?: boolean;
  /** Quante voci sono gia' scelte qui dentro: si vede anche a gruppo chiuso. */
  conteggio?: number;
  children: React.ReactNode;
}) {
  const [apertoScelto, setAperto] = useState(apertoDiDefault);
  const aperto = forzaAperto || apertoScelto;
  const compatto = useContext(ContestoCompatto);
  const idContenuto = useId();
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setAperto((prima) => !prima)}
        aria-expanded={aperto}
        aria-controls={idContenuto}
        className={`flex w-full items-center gap-2 px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${compatto ? "min-h-8" : "min-h-11"}`}
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${aperto ? "rotate-90" : ""}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-tenorite font-semibold ${compatto ? "text-[13px]" : "text-sm"}`}>{etichetta}</span>
          {!aperto && !compatto && <span className="block truncate text-xs text-text-muted">{descrizione}</span>}
        </span>
        {conteggio ? (
          <span
            className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary"
            aria-label={`${conteggio} scelte`}
          >
            {conteggio}
          </span>
        ) : null}
      </button>
      <div id={idContenuto} hidden={!aperto} className={compatto ? "pb-1 pl-6 pr-1" : "pb-2 pl-8 pr-2"}>
        {children}
      </div>
    </div>
  );
}

/** Il titolo di una delle tre sezioni (Campi comuni, Operazioni, Misure). */
function TitoloSezione({ id, children, nota }: { id: string; children: ReactNode; nota?: string }) {
  const compatto = useContext(ContestoCompatto);
  return (
    <header className={compatto ? "px-2 pb-0.5 pt-2" : "border-b border-border px-3 py-2"}>
      <h3
        id={id}
        className={`font-tenorite font-bold uppercase tracking-wide ${compatto ? "text-[10px] text-text-muted" : "text-sm"}`}
      >
        {children}
      </h3>
      {nota && <p className="mt-0.5 text-xs text-text-muted">{nota}</p>}
    </header>
  );
}

/** Come e' calcolato un valore, in un simbolo: somma, conteggio, media, percentuale. */
function Natura({ natura }: { natura: NaturaValore }) {
  const { simbolo, nome, spiegazione } = NATURE[natura];
  return (
    <>
      <span
        aria-hidden
        title={`${nome}: ${spiegazione}`}
        className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-bg-page px-1 text-[10px] font-semibold text-text-muted"
      >
        {simbolo}
      </span>
      <span className="sr-only">({nome})</span>
    </>
  );
}

function Casella({
  etichetta,
  spuntata,
  motivoBloccata,
  onCambia,
  nota,
  azione,
  voce,
  segno,
}: {
  etichetta: string;
  spuntata: boolean;
  motivoBloccata: string | null;
  onCambia: (spuntata: boolean) => void;
  /** Una riga sotto l'etichetta. */
  nota?: string;
  /** Pulsanti a destra (per esempio «Togli la misura»), fuori dalla casella. */
  azione?: ReactNode;
  /**
   * Se c'e', la voce si puo' trascinare in un pozzetto. Una voce bloccata non
   * si trascina: non ci sarebbe un pozzetto che la accetta, e il motivo e'
   * gia' scritto accanto alla casella.
   */
  voce?: VoceCampo;
  /**
   * Il segno che dice che specie di campo e': la natura di un valore, o il
   * segno di un campo per suddividere. Sta fuori dall'etichetta: la casella si
   * chiama col nome del campo e basta.
   */
  segno?: ReactNode;
}) {
  const compatto = useContext(ContestoCompatto);
  const bloccata = motivoBloccata !== null && !spuntata;
  const trascinabile = Boolean(voce) && !bloccata;
  const casella = (
    <label
      draggable={trascinabile}
      onDragStart={
        voce && trascinabile
          ? (evento) => {
              evento.dataTransfer.setData(TIPO_MIME_CAMPO, JSON.stringify(voce));
              evento.dataTransfer.setData("text/plain", etichetta);
              evento.dataTransfer.effectAllowed = "move";
              impostaTrascinamento(voce);
            }
          : undefined
      }
      onDragEnd={voce ? () => impostaTrascinamento(null) : undefined}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1 ${compatto ? "min-h-7" : "min-h-10"} ${
        bloccata ? "cursor-not-allowed opacity-60" : trascinabile ? "cursor-grab hover:bg-bg-page active:cursor-grabbing" : "cursor-pointer hover:bg-bg-page"
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
        {nota && <span className="block text-xs text-text-muted">{nota}</span>}
        {bloccata && <span className="block text-xs text-text-muted">{motivoBloccata}</span>}
      </span>
    </label>
  );
  if (!azione && !segno) return casella;
  return (
    <div className="flex items-center gap-1">
      {casella}
      {segno}
      {azione}
    </div>
  );
}

/** Il segno dei campi per suddividere: un'etichetta, per distinguerli dai valori da misurare. */
function SegnoCampo({ tempo = false }: { tempo?: boolean }) {
  const Icona = tempo ? CalendarDays : Tag;
  return (
    <>
      <span
        aria-hidden
        title="Campo per suddividere"
        className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-bg-page text-text-muted"
      >
        <Icona className="h-3 w-3" />
      </span>
      <span className="sr-only">(campo per suddividere)</span>
    </>
  );
}

export function AlberoCampi({
  vocabolario,
  selezione,
  onCambia,
  azioneMisure,
  puoTogliereMisura,
  onTogliMisura,
  onPartiDa,
  compatto = false,
  senzaLimiteSuddivisioni = false,
}: {
  vocabolario: VocabolarioAlbero;
  selezione: SelezioneCampi;
  onCambia: (selezione: SelezioneCampi) => void;
  /**
   * Per il pannello laterale del builder: una colonna sola, con la ricerca, e
   * senza l'elenco «Suddivisioni scelte» (lo mostrano gia' i pozzetti).
   */
  compatto?: boolean;
  /** Nelle tabelle ogni campo e' una colonna: niente limite di due. */
  senzaLimiteSuddivisioni?: boolean;
  /** In fondo alla sezione delle misure: per esempio «Nuova misura a parole». */
  azioneMisure?: ReactNode;
  /** Se l'utente puo' togliere questa misura personalizzata dal catalogo. */
  puoTogliereMisura?: (chiave: ChiaveCampo) => boolean;
  onTogliMisura?: (chiave: ChiaveCampo) => void;
  /** Da una misura che c'e' gia' a «Nuova misura a parole», con il testo di partenza. */
  onPartiDa?: (testo: string) => void;
}) {
  const [trascinata, setTrascinata] = useState<number | null>(null);
  const [ricerca, setRicerca] = useState("");
  const [calcoloAperto, setCalcoloAperto] = useState<string | null>(null);
  const cerca = ricerca.trim().toLocaleLowerCase("it");
  // Una voce passa se la ricerca e' vuota o compare nel suo nome o in quello del gruppo.
  const passa = (...testi: string[]) =>
    cerca === "" || testi.some((testo) => testo.toLocaleLowerCase("it").includes(cerca));

  const metrica = (chiave: ChiaveCampo) => vocabolario.metriche.find((m) => m.chiave === chiave);
  const etichettaMetrica = (chiave: ChiaveCampo) => metrica(chiave)?.etichetta ?? chiave;
  const etichettaDimensione = (chiave: Dimensione) =>
    vocabolario.dimensioni.find((d) => d.chiave === chiave)?.etichetta ?? chiave;
  const haDimensione = (chiave: Dimensione) => vocabolario.dimensioni.some((d) => d.chiave === chiave);
  const haMetrica = (chiave: ChiaveCampo) => vocabolario.metriche.some((m) => m.chiave === chiave);

  const { dimensioniPerMetrica: perMetrica, famiglie } = vocabolario;
  const famiglieScelte = famiglieDelleMisure(selezione.misure, famiglie);

  function cambiaMisura(chiave: ChiaveCampo, spuntata: boolean) {
    onCambia(selezioneConMisura(selezione, chiave, spuntata, perMetrica, famiglie));
  }

  function cambiaSuddivisione(dimensione: Dimensione, spuntata: boolean) {
    onCambia(selezioneConSuddivisione(selezione, dimensione, spuntata, perMetrica, famiglie));
  }

  function spostaSuddivisione(da: number, a: number) {
    if (a < 0 || a >= selezione.suddivisioni.length) return;
    const suddivisioni = [...selezione.suddivisioni];
    const [tolta] = suddivisioni.splice(da, 1);
    suddivisioni.splice(a, 0, tolta);
    onCambia({ ...selezione, suddivisioni });
  }

  // ── Le righe ──────────────────────────────────────────────────────────────

  /** Un valore di base: una somma o un conteggio. */
  function rigaValore(chiave: ChiaveCampo) {
    const natura = naturaDellaVoce(chiave, vocabolario.definizioni);
    const dettaglio = metrica(chiave)?.descrizione;
    return (
      <div key={chiave}>
        <Casella
          etichetta={etichettaMetrica(chiave)}
          voce={{ tipo: "misura", chiave }}
          spuntata={selezione.misure.includes(chiave)}
          motivoBloccata={motivoMisuraNonSelezionabile(chiave, selezione, perMetrica, famiglie)}
          onCambia={(spuntata) => cambiaMisura(chiave, spuntata)}
          segno={<Natura natura={natura} />}
          azione={dettaglio ? bottoneCalcolo(chiave, etichettaMetrica(chiave)) : undefined}
        />
        {dettaglio && dettaglioCalcolo(chiave, etichettaMetrica(chiave), `${NATURE[natura].spiegazione} ${dettaglio}`, "Che cosa misura")}
      </div>
    );
  }

  /**
   * Il pulsante «i» che apre o chiude la spiegazione di una voce.
   * Una funzione e non un componente: dichiarato dentro il render, un
   * componente si rimonterebbe a ogni scelta e il pulsante perderebbe il fuoco.
   */
  function bottoneCalcolo(chiave: string, nome: string) {
    const aperto = calcoloAperto === chiave;
    return (
      <button
        type="button"
        aria-label={`Come si calcola ${nome}`}
        aria-expanded={aperto}
        onClick={() => setCalcoloAperto(aperto ? null : chiave)}
        className={`shrink-0 rounded p-1.5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          aperto ? "text-primary" : "text-text-muted"
        }`}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
    );
  }

  /** La spiegazione sotto una riga: come si calcola, e il modo di farne una variante. */
  function dettaglioCalcolo(chiave: string, nome: string, testo: string, titolo = "Come si calcola") {
    if (calcoloAperto !== chiave) return null;
    return (
      <div key={`${chiave}-dettaglio`} className="mb-1 ml-6 rounded-md bg-bg-page p-2 text-xs leading-relaxed text-text-muted">
        <p className="font-semibold text-text">{titolo}</p>
        <p>{testo}</p>
        {onPartiDa && (
          <button
            type="button"
            onClick={() => onPartiDa(testoPerPartireDa(nome, testo))}
            className="mt-1.5 font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Parti da questa per una variante
          </button>
        )}
      </div>
    );
  }

  /** Un campo per suddividere, con il suo nome in questo contesto. */
  function rigaDimensione(dimensione: Dimensione, etichettaLocale?: string, famiglieGruppo?: string[]) {
    // Il numero del documento e' di UNA operazione: sotto le altre non si accende.
    const dellaOperazione =
      !eDocumento(dimensione) ||
      !famiglieGruppo ||
      famiglieScelte.length === 0 ||
      famiglieScelte.every((f) => famiglieGruppo.includes(f));
    const spuntata = selezione.suddivisioni.includes(dimensione) && dellaOperazione;
    const motivo = !dellaOperazione
      ? "Non è il documento delle misure scelte"
      : motivoDimensioneNonSelezionabile(dimensione, selezione, perMetrica, famiglie, senzaLimiteSuddivisioni);
    return (
      <Casella
        key={`${dimensione}-${etichettaLocale ?? ""}`}
        etichetta={etichettaLocale ?? etichettaDimensione(dimensione)}
        voce={{ tipo: "dimensione", chiave: dimensione }}
        spuntata={spuntata}
        motivoBloccata={motivo}
        onCambia={(valore) => cambiaSuddivisione(dimensione, valore)}
        segno={<SegnoCampo />}
      />
    );
  }

  const nessunRisultato =
    cerca !== "" &&
    !CARTELLE.some(
      (cartella) =>
        passa(cartella.etichetta) ||
        cartella.voci.some(
          (v) =>
            passa(v.etichetta) ||
            [...v.valori, ...(v.misure ?? [])].some((m) => haMetrica(m) && passa(etichettaMetrica(m))) ||
            v.campi.some((c) => haDimensione(c.chiave) && passa(c.etichetta ?? etichettaDimensione(c.chiave)))
        )
    ) &&
    !GRUPPI_COMUNI.some(
      (g) => passa(g.etichetta) || g.dimensioni.some((d) => haDimensione(d) && passa(etichettaDimensione(d)))
    ) &&
    !vocabolario.tipologie.some((t) => t.chiave === "misure" && t.metriche.some((m) => passa(etichettaMetrica(m)))) &&
    !VOCI_CALENDARIO.some((v) => passa(v.etichetta, "calendario", "tempo"));

  /** Una misura calcolata dentro la sua voce: con la natura (x̄, %…) e come si calcola. */
  function rigaMisura(chiave: ChiaveCampo) {
    return (
      <div key={chiave}>
        <Casella
          etichetta={etichettaMetrica(chiave)}
          voce={{ tipo: "misura", chiave }}
          spuntata={selezione.misure.includes(chiave)}
          motivoBloccata={motivoMisuraNonSelezionabile(chiave, selezione, perMetrica, famiglie)}
          onCambia={(spuntata) => cambiaMisura(chiave, spuntata)}
          segno={<Natura natura={naturaDellaVoce(chiave)} />}
          azione={bottoneCalcolo(chiave, etichettaMetrica(chiave))}
        />
        {dettaglioCalcolo(chiave, etichettaMetrica(chiave), calcoloDellaMetrica(chiave as never) ?? "")}
      </div>
    );
  }

  const personalizzate = vocabolario.tipologie.find((t) => t.chiave === "misure")?.metriche ?? [];
  const sceltaIn = (chiavi: readonly string[]) => selezione.misure.filter((m) => chiavi.includes(chiaveBase(m))).length;

  return (
    <ContestoCompatto.Provider value={compatto}>
    <div className={compatto ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-4"}>
      {compatto && (
        <div className="shrink-0">
          <label htmlFor="cerca-campi" className="sr-only">
            Cerca un campo
          </label>
          <input
            id="cerca-campi"
            type="search"
            value={ricerca}
            onChange={(evento) => setRicerca(evento.target.value)}
            placeholder="Cerca un campo…"
            className="h-10 w-full rounded-lg border border-border bg-bg-page px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          {nessunRisultato && (
            <p role="status" className="mt-2 text-xs text-text-muted">
              Nessun campo corrisponde a «{ricerca.trim()}».
            </p>
          )}
        </div>
      )}

      {!compatto && selezione.suddivisioni.length > 0 && (
        <ol className="rounded-xl border border-border bg-bg px-3 py-2" aria-label="Suddivisioni scelte, in ordine">
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
            {senzaLimiteSuddivisioni ? "Una colonna per ogni campo, nell’ordine scelto." : "La prima comanda l’asse, la seconda il colore."}
          </li>
        </ol>
      )}

      <div className={compatto ? "min-h-0 flex-1 overflow-y-auto pr-1" : undefined}>
        {/* ── Campi comuni ─────────────────────────────────────────────── */}
        <section aria-labelledby="albero-comuni" className={compatto ? "rounded-lg border border-border bg-bg" : "rounded-xl border border-border bg-bg"}>
          <TitoloSezione id="albero-comuni" nota="Con questi si suddivide qualunque operazione.">
            Campi comuni
          </TitoloSezione>
          {GRUPPI_COMUNI.map((gruppo, indice) => {
            const visibili = gruppo.dimensioni.filter(
              (d) => haDimensione(d) && (passa(gruppo.etichetta) || passa(etichettaDimensione(d)))
            );
            if (visibili.length === 0) return null;
            return (
              <Gruppo
                key={gruppo.chiave}
                etichetta={gruppo.etichetta}
                descrizione={gruppo.descrizione}
                forzaAperto={cerca !== ""}
                conteggio={gruppo.dimensioni.filter((d) => selezione.suddivisioni.includes(d)).length}
                apertoDiDefault={indice === 0 || gruppo.dimensioni.some((d) => selezione.suddivisioni.includes(d))}
              >
                {visibili.map((dimensione) => rigaDimensione(dimensione))}
              </Gruppo>
            );
          })}

          {VOCI_CALENDARIO.some((voce) => passa(voce.etichetta, "calendario", "tempo")) && (
            <Gruppo
              etichetta="Calendario"
              descrizione="Per vedere l’andamento nel tempo."
              forzaAperto={cerca !== ""}
              conteggio={selezione.granularita ? 1 : 0}
              apertoDiDefault={selezione.granularita !== undefined}
            >
              {/*
                A scelta singola, e non per gusto: giorno, settimana, mese e anno
                sono la stessa cosa a granularità diverse. Spuntare «mese» e
                «anno» insieme non significa niente.
              */}
              {VOCI_CALENDARIO.filter((voce) => passa(voce.etichetta, "calendario", "tempo")).map((voce) => (
                <Casella
                  key={voce.chiave}
                  etichetta={voce.etichetta}
                  voce={{ tipo: "calendario", chiave: voce.chiave }}
                  spuntata={selezione.granularita === voce.chiave}
                  motivoBloccata={null}
                  segno={<SegnoCampo tempo />}
                  onCambia={(spuntata) =>
                    onCambia({
                      ...selezione,
                      granularita: spuntata ? voce.chiave : undefined,
                    })
                  }
                />
              ))}
            </Gruppo>
          )}
        </section>

        {/* ── Dati: cartelle, sottocartelle e voci ──────────────────────── */}
        <section
          aria-labelledby="albero-operazioni"
          className={`${compatto ? "mt-2 rounded-lg" : "rounded-xl"} border border-border bg-bg`}
        >
          <TitoloSezione id="albero-operazioni" nota="Cartelle e voci: scegli i valori, le misure e i campi di ciascuna.">
            Dati
          </TitoloSezione>
          {CARTELLE.map((cartella, indiceCartella) => {
            const voci = cartella.voci
              .map((voce) => {
                const tutta = passa(cartella.etichetta) || passa(voce.etichetta);
                return {
                  voce,
                  valori: voce.valori.filter((m) => haMetrica(m) && (tutta || passa(etichettaMetrica(m)))),
                  misure: (voce.misure ?? []).filter((m) => haMetrica(m) && (tutta || passa(etichettaMetrica(m)))),
                  campi: voce.campi.filter(
                    (c) => haDimensione(c.chiave) && (tutta || passa(c.etichetta ?? etichettaDimensione(c.chiave)))
                  ),
                };
              })
              .filter((v) => v.valori.length > 0 || v.misure.length > 0 || v.campi.length > 0);
            if (voci.length === 0) return null;
            const sceltiNellaVoce = (voce: (typeof voci)[number]["voce"]) =>
              sceltaIn([...voce.valori, ...(voce.misure ?? [])]) +
              voce.campi.filter(
                (c) =>
                  selezione.suddivisioni.includes(c.chiave) &&
                  (!eDocumento(c.chiave) ||
                    (famiglieScelte.length > 0 && famiglieScelte.every((f) => voce.famiglieDocumento?.includes(f))))
              ).length;
            const sceltiQui = voci.reduce((somma, v) => somma + sceltiNellaVoce(v.voce), 0);
            return (
              <Gruppo
                key={cartella.chiave}
                etichetta={cartella.etichetta}
                descrizione={cartella.descrizione}
                forzaAperto={cerca !== ""}
                conteggio={sceltiQui}
                apertoDiDefault={sceltiQui > 0 || (indiceCartella === 0 && selezione.misure.length === 0)}
              >
                {voci.map(({ voce, valori, misure, campi }, indiceVoce) => (
                  <Gruppo
                    key={voce.chiave}
                    etichetta={voce.etichetta}
                    descrizione={voce.descrizione}
                    forzaAperto={cerca !== ""}
                    conteggio={sceltiNellaVoce(voce)}
                    apertoDiDefault={sceltiNellaVoce(voce) > 0 || (indiceCartella === 0 && indiceVoce === 0 && selezione.misure.length === 0)}
                  >
                    {valori.map((chiave) => rigaValore(chiave))}
                    {misure.length > 0 && (
                      <p className="mt-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Misure</p>
                    )}
                    {misure.map((chiave) => rigaMisura(chiave))}
                    {campi.length > 0 && (
                      <p className="mt-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Campi</p>
                    )}
                    {campi.map((campo) => rigaDimensione(campo.chiave, campo.etichetta, voce.famiglieDocumento))}
                  </Gruppo>
                ))}
              </Gruppo>
            );
          })}
        </section>

        {/* ── Misure ───────────────────────────────────────────────────── */}
        <section
          aria-labelledby="albero-misure"
          className={`${compatto ? "mt-2 rounded-lg" : "rounded-xl"} border border-border bg-bg`}
        >
          <TitoloSezione id="albero-misure" nota="Quelle create a parole. Le misure calcolate di ogni voce (medie, tassi) stanno dentro la voce.">
            Misure personalizzate
          </TitoloSezione>
          {personalizzate.length > 0 && (
            <Gruppo
              etichetta="Misure personalizzate"
              descrizione="Quelle create a parole, pronte da riusare."
              forzaAperto={cerca !== "" && personalizzate.some((m) => passa(etichettaMetrica(m)))}
              conteggio={sceltaIn(personalizzate)}
              apertoDiDefault={personalizzate.some((m) => selezione.misure.some((v) => chiaveBase(v) === m))}
            >
              {personalizzate.filter((m) => passa(etichettaMetrica(m), "personalizzate")).map((chiave) => {
                const nome = etichettaMetrica(chiave);
                return (
                  <div key={chiave}>
                    <Casella
                      etichetta={nome}
                      voce={{ tipo: "misura", chiave }}
                      spuntata={selezione.misure.includes(chiave)}
                      motivoBloccata={motivoMisuraNonSelezionabile(chiave, selezione, perMetrica, famiglie)}
                      onCambia={(spuntata) => cambiaMisura(chiave, spuntata)}
                      segno={<Natura natura={naturaDellaVoce(chiave, vocabolario.definizioni)} />}
                      // La definizione di una misura personalizzata sta sempre
                      // sotto il nome: e' quello che la distingue dalle altre.
                      nota={metrica(chiave)?.descrizione || undefined}
                      azione={
                        puoTogliereMisura?.(chiave) && onTogliMisura ? (
                          <button
                            type="button"
                            aria-label={`Togli la misura ${nome} dal catalogo`}
                            onClick={() => onTogliMisura(chiave)}
                            className="rounded p-1.5 text-text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        ) : undefined
                      }
                    />
                  </div>
                );
              })}
            </Gruppo>
          )}
          {azioneMisure && <div className="border-t border-border px-3 py-2">{azioneMisure}</div>}
        </section>
      </div>
    </div>
    </ContestoCompatto.Provider>
  );
}
