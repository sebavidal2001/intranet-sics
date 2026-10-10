"use client";

/**
 * L'EDITOR MANUALE DELLE ANALISI.
 *
 * La tipologia viene prima dei parametri perché è il modo in cui le persone
 * riconoscono il dato; metrica e dimensioni compaiono solo dopo, evitando una
 * lista piatta che mescola indicatori di natura diversa.
 *
 * L'oggetto che si compone qui è lo stesso `SpecQuery` che produce l'analista
 * AI. Non è un dettaglio implementativo: è la ragione per cui un'analisi
 * suggerita dall'AI si apre qui e si corregge, e una fatta a mano si può
 * passare all'AI. Un solo motore, due modi di imboccarlo — e uno solo da
 * tenere in sicurezza.
 *
 * Il limite di due dimensioni non è pigrizia: oltre le due non esiste grafico
 * che le rappresenti, e lasciar scegliere per poi ripiegare su una tabella
 * sarebbe peggio che dirlo prima.
 */

import { SelettoreValori } from "./selettore-valori";
import { TipoGraficoCompatto } from "./tipo-grafico-compatto";
import { TelaRilascio } from "./tela-rilascio";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { GraficoDaAnalisi } from "@/components/prototipo-bi/grafico-da-risultato";
import { Scheda, Scheletro, euro, numero } from "@/components/prototipo-bi/primitivi";
import { useImpostazioni } from "@/components/prototipo-bi/impostazioni";
import { PannelloAspetto } from "@/components/prototipo-bi/pannello-aspetto";
import { SelettoreAnni } from "@/components/prototipo-bi/selettore-anni";
import { CreaMisura } from "@/components/prototipo-bi/crea-misura";
import { ModificaAParole } from "@/components/prototipo-bi/modifica-a-parole";
import { riallineaDifferenze, scorciatoiaDi, type StatoRiquadro } from "@/lib/prototipo-bi/modifica-riquadro";
import {
  anniDelPeriodo,
  descriviPeriodo as descriviPeriodoFissato,
  periodoPresente,
} from "@/lib/prototipo-bi/periodo";
import {
  AlberoCampi,
  SELEZIONE_VUOTA,
  nomeConPeriodo,
  type SelezioneCampi,
  type VocabolarioAlbero,
} from "@/components/prototipo-bi/albero-campi";
import { avvisoNumeroDocumento, famiglieDellaMisura, famigliaDellaMetrica } from "@/lib/prototipo-bi/albero-modello";
import { dimensioniDellaMisura } from "@/lib/prototipo-bi/misure";
import { Pozzetti, type ManigliaPozzetti } from "@/components/prototipo-bi/pozzetti";
import type { NomePozzetto, VoceCampo } from "@/components/prototipo-bi/pozzetti-regole";
import {
  ammetteConfrontoBudget,
  eseguiAnalisiComposita,
  motivoBudgetNonDisponibile,
} from "@/lib/prototipo-bi/analisi-composita";
import {
  NOMI_GRAFICI,
  comeSbloccareAltriGrafici,
  graficiPossibili,
  scegliGrafico,
  type TipoGrafico,
} from "@/lib/prototipo-bi/scelta-grafico";
import type {
  AspettoGrafico,
  ChiaveMetrica,
  Dimensione,
  Filtro,
  Granularita,
  MisuraDefinita,
  Modificatore,
  Periodo,
  RisultatoQuery,
  RuoloSerie,
  SerieAnalisi,
  SerieAnalisiEseguita,
  SpecQuery,
} from "@/lib/prototipo-bi/tipi";
import type { ChiaveTipologia } from "@/lib/prototipo-bi/tassonomia";
import {
  chiaveBase,
  chiaveDellaSpec,
  chiaveMisura,
  estendiVocabolario,
  misureNelleSpec,
  scomponiValore,
  specPerChiave,
  valoreDellaSpec,
  type ChiaveCampo,
  type ChiaveValore,
} from "@/lib/prototipo-bi/misure-vocabolario";
import type { MisuraSalvata } from "@/lib/prototipo-bi/misure-catalogo";

interface VoceMetrica {
  chiave: ChiaveMetrica;
  etichetta: string;
  descrizione: string;
  unita: string;
}

interface VoceDimensione {
  chiave: Dimensione;
  etichetta: string;
}

interface VoceModificatore {
  chiave: Modificatore;
  descrizione: string;
}

interface VoceTipologia {
  chiave: ChiaveTipologia;
  etichetta: string;
  descrizione: string;
  metriche: ChiaveMetrica[];
}

interface Vocabolario {
  tipologie: VoceTipologia[];
  metriche: VoceMetrica[];
  dimensioni: VoceDimensione[];
  dimensioniPerMetrica: Record<ChiaveMetrica, Dimensione[]>;
  modificatori: VoceModificatore[];
  granularita: Granularita[];
}

/**
 * Il colore di una serie.
 *
 * Le pastiglie della palette coprono il caso normale — servono a distinguere
 * budget da ordinato, non a scegliere una tinta precisa — e il campo libero
 * resta per chi ha un colore aziendale da rispettare. «Automatico» e' una voce
 * vera e non l'assenza di scelta: riporta la serie sulla palette, e senza di
 * essa un colore messo per prova non si potrebbe piu' togliere.
 */
function SelettoreColore({
  valore,
  etichetta,
  onCambia,
}: {
  valore: string | undefined;
  etichetta: string;
  onCambia: (colore: string | undefined) => void;
}) {
  const { palette } = useImpostazioni();
  return (
    <div className="flex items-center gap-1" role="group" aria-label={etichetta}>
      <button
        type="button"
        aria-label={`${etichetta}: automatico`}
        aria-pressed={valore === undefined}
        title="Colore automatico dalla palette"
        onClick={() => onCambia(undefined)}
        className={`h-6 w-6 rounded-full border text-[10px] font-semibold leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
          valore === undefined ? "border-primary text-primary" : "border-border text-text-muted"
        }`}
      >
        A
      </button>
      {palette.serie.slice(0, 6).map((tinta) => (
        <button
          key={tinta}
          type="button"
          aria-label={`${etichetta}: ${tinta}`}
          aria-pressed={valore === tinta}
          title={tinta}
          onClick={() => onCambia(tinta)}
          style={{ backgroundColor: tinta }}
          className={`h-6 w-6 rounded-full border-2 transition-transform focus:outline-none focus:ring-2 focus:ring-primary ${
            valore === tinta ? "border-text scale-110" : "border-transparent"
          }`}
        />
      ))}
      <input
        type="color"
        aria-label={`${etichetta}: colore libero`}
        title="Scegli un colore qualsiasi"
        value={valore ?? palette.serie[0]}
        onChange={(evento) => onCambia(evento.target.value)}
        className="h-6 w-6 cursor-pointer rounded-full border border-border bg-transparent p-0"
      />
    </div>
  );
}

const NOMI_OPERATORI: Record<Filtro["op"], string> = {
  eq: "è uguale a",
  neq: "è diverso da",
  in: "è uno tra",
  contiene: "contiene",
};

const CLASSE_CAMPO =
  "min-h-10 w-full rounded-lg border border-border bg-bg-page px-3 text-sm outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Le schede del pannello destro. «Campi» e' quella dove si costruisce; le altre
 * raccolgono il resto dei parametri, cosi' il pannello resta una colonna sola
 * accanto al grafico invece di una pagina da scorrere.
 */
type SchedaPannello = "campi" | "filtri" | "confronti" | "aspetto";

const SCHEDE_PANNELLO: { chiave: SchedaPannello; etichetta: string }[] = [
  { chiave: "campi", etichetta: "Campi" },
  { chiave: "filtri", etichetta: "Filtri" },
  { chiave: "confronti", etichetta: "Confronti" },
  { chiave: "aspetto", etichetta: "Aspetto" },
];

type ScorciatoiaConfronto ="anno_precedente" | "budget" | "bep" | "progressivo";

interface SerieEditor extends SerieAnalisi {
  scorciatoia?: ScorciatoiaConfronto;
  /**
   * Vero (o assente) se la serie segue i filtri della principale; falso se ne ha
   * di propri e vanno lasciati stare (un confronto fra due clienti, per
   * esempio). Non si salva: all'apertura si deduce da come sono i filtri.
   */
  eredita?: boolean;
}

const stessiFiltri = (a: SpecQuery | undefined, b: SpecQuery | undefined) =>
  JSON.stringify(a?.filtri ?? []) === JSON.stringify(b?.filtri ?? []);

/**
 * I filtri della principale, nella forma che vale per un'altra serie: solo
 * quelli che la sua metrica ammette. Senza, una misura in piu' (o lo stesso
 * valore a un altro periodo) ignorerebbe i filtri e mostrerebbe numeri di un
 * perimetro diverso accanto a quelli filtrati.
 */
function filtriPerSerie(
  filtri: Filtro[] | undefined,
  serie: SpecQuery,
  perMetrica: Record<string, Dimensione[]> | undefined
): Filtro[] | undefined {
  if (!filtri || filtri.length === 0) return undefined;
  const ammesse = serie.misura ? dimensioniDellaMisura(serie.misura) : perMetrica?.[serie.metrica];
  const copia = (f: Filtro): Filtro => ({ ...f, valore: Array.isArray(f.valore) ? [...f.valore] : f.valore });
  if (!ammesse) return filtri.map(copia);
  const ok = new Set<string>(ammesse);
  const tenuti = filtri.filter((f) => ok.has(f.campo) || (f.campo === "bu_categoria" && ok.has("bu")));
  return tenuti.length > 0 ? tenuti.map(copia) : undefined;
}

/** Il riquadro com'era prima di una modifica a parole, per poterla annullare. */
interface PuntoDiRipristino {
  titolo: string;
  titoloModificato: boolean;
  spec: SpecQuery;
  serieAggiuntive: SerieEditor[];
  graficoScelto: TipoGrafico | undefined;
  aspetto: AspettoGrafico | null;
  nomePrincipale: string | null;
}

const NOMI_RUOLI: Record<RuoloSerie, string> = {
  principale: "Principale",
  confronto: "Confronto",
  obiettivo: "Obiettivo",
  soglia: "Soglia",
};

function specDaScorciatoia(spec: SpecQuery, scorciatoia: ScorciatoiaConfronto): SpecQuery {
  if (scorciatoia === "anno_precedente") {
    return { ...spec, modificatore: "anno_precedente" };
  }
  if (scorciatoia === "progressivo") {
    return { ...spec, modificatore: "progressivo" };
  }
  // Un'altra metrica sostituisce la domanda: una misura personalizzata rimasta
  // nella spec la farebbe calcolare ancora, con la metrica sbagliata accanto.
  const senzaMisura: SpecQuery = { ...spec };
  delete senzaMisura.misura;
  return { ...senzaMisura, metrica: scorciatoia };
}

/** L'operazione (dataset) di una spec: quella della sua metrica, o del primo operando di una misura. */
function famigliaDellaSpec(spec: SpecQuery): string {
  return famigliaDellaMetrica(spec.metrica);
}

function eOggetto(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === "object" && valore !== null;
}

function messaggioErrore(corpo: unknown, ripiego: string): string {
  return eOggetto(corpo) && typeof corpo.error === "string" ? corpo.error : ripiego;
}

function costruisciTitolo(spec: SpecQuery, vocabolario: Vocabolario): string {
  const metrica = spec.misura?.nome
    ?? vocabolario.metriche.find((voce) => voce.chiave === spec.metrica)?.etichetta;
  const dimensioni = (spec.raggruppa ?? [])
    .map((chiave) =>
      vocabolario.dimensioni.find((voce) => voce.chiave === chiave)?.etichetta.toLocaleLowerCase("it")
    )
    .filter((voce): voce is string => Boolean(voce));
  const parti = [metrica ?? spec.metrica];
  if (dimensioni.length > 0) parti.push(`per ${dimensioni.join(" e ")}`);
  if (periodoPresente(spec.periodo)) parti.push(descriviPeriodoFissato(spec.periodo));
  return parti.join(", ");
}

function valoreFiltroPerCampo(filtro: Filtro): string {
  return Array.isArray(filtro.valore) ? filtro.valore.join(", ") : filtro.valore;
}

function formattaTotale(risultato: RisultatoQuery): string {
  if (risultato.unita === "euro") return euro(risultato.totale, false);
  if (risultato.unita === "percentuale") {
    return `${risultato.totale.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
  }
  if (risultato.unita === "giorni") {
    return `${risultato.totale.toLocaleString("it-IT", { maximumFractionDigits: 1 })} giorni`;
  }
  return numero(risultato.totale);
}

function descriviPeriodo(periodo: Periodo | undefined): string {
  return descriviPeriodoFissato(periodo, "il periodo corrente della dashboard");
}

/**
 * Toglie la scelta degli anni. Se non restano date il periodo sarebbe vuoto,
 * cioe' «eredita dalla dashboard»: si tiene allora l'inizio del primo anno
 * scelto, cosi' il riquadro resta fermo come chiesto.
 */
function togliAnni(periodo: Periodo | undefined): Periodo {
  const restante = senzaAnni(periodo);
  if (restante.dal || restante.al) return restante;
  const primo = anniDelPeriodo(periodo)?.[0] ?? new Date().getFullYear();
  return { dal: `${primo}-01-01` };
}

/** Il periodo senza anni: restano solo le date. */
function senzaAnni(periodo: Periodo | undefined): Periodo {
  return { dal: periodo?.dal, al: periodo?.al };
}

export function EditorAnalisi({
  idAnalisi,
  specIniziale,
  serieIniziali,
  titoloIniziale,
  graficoIniziale,
  aspettoIniziale,
  modificabile = true,
  periodoEreditato,
  dentroUnaPagina = false,
  onSalvata,
}: {
  idAnalisi?: string;
  specIniziale?: SpecQuery;
  serieIniziali?: SerieAnalisi[] | null;
  titoloIniziale?: string;
  graficoIniziale?: TipoGrafico;
  aspettoIniziale?: AspettoGrafico | null;
  modificabile?: boolean;
  periodoEreditato?: Periodo;
  /**
   * Vero quando l'editor e' dentro il pannello "Aggiungi" di una pagina.
   *
   * Cambia solo le parole, ma sono le parole che descrivono cosa succede:
   * li' il pulsante non salva in libreria e basta, crea il riquadro nella
   * pagina che si sta guardando. Chiamarlo "Salva" faceva sembrare che
   * mancasse ancora un passo, ed era il passo che non c'e' piu'.
   */
  dentroUnaPagina?: boolean;
  onSalvata?: (id: string) => void;
}): JSX.Element {
  const [vocabolario, setVocabolario] = useState<Vocabolario | null>(null);
  const [spec, setSpec] = useState<SpecQuery | null>(specIniziale ?? null);
  const [serieAggiuntive, setSerieAggiuntive] = useState<SerieEditor[]>(() => {
    const principaleIniziale = specIniziale ?? serieIniziali?.find((voce) => voce.ruolo === "principale")?.spec;
    return (serieIniziali?.filter((voce) => voce.ruolo !== "principale") ?? []).map((voce) => ({
      ...voce,
      eredita: stessiFiltri(voce.spec, principaleIniziale),
    }));
  });
  const [tipologiaScelta, setTipologiaScelta] = useState<ChiaveTipologia | null>(null);
  const [risultato, setRisultato] = useState<RisultatoQuery | null>(null);
  const [serieEseguite, setSerieEseguite] = useState<SerieAnalisiEseguita[]>([]);
  const [altraMetricaAperta, setAltraMetricaAperta] = useState(false);
  const [tipologiaConfronto, setTipologiaConfronto] = useState<ChiaveTipologia | null>(null);
  const [metricaConfronto, setMetricaConfronto] = useState<ChiaveMetrica | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState("");
  const [erroreVocabolario, setErroreVocabolario] = useState("");
  // Le misure personalizzate del catalogo. Caricate a parte e senza fare rumore
  // se mancano: l'editor funziona anche senza (utente senza permesso, migration
  // non ancora applicata), e il vocabolario delle metriche resta quello di prima.
  const [misureSalvate, setMisureSalvate] = useState<MisuraSalvata[]>([]);
  const [chiGestisceMisure, setChiGestisceMisure] = useState<{ utenteId: string; tutte: boolean }>({ utenteId: "", tutte: false });
  const [creaMisuraAperta, setCreaMisuraAperta] = useState(false);
  // Il testo con cui si apre «Nuova misura a parole»: vuoto, o quello per
  // partire da una misura che c'e' gia'.
  const [testoNuovaMisura, setTestoNuovaMisura] = useState("");
  // Modifica a parole: il nome della principale scelto da una modifica (altrimenti
  // si deriva) e i punti di ripristino per «Annulla l'ultima modifica».
  const [nomePrincipaleScelto, setNomePrincipaleScelto] = useState<string | null>(null);
  const [cronologia, setCronologia] = useState<PuntoDiRipristino[]>([]);
  const [titolo, setTitolo] = useState(titoloIniziale ?? "");
  const [graficoScelto, setGraficoScelto] = useState<TipoGrafico | undefined>(graficoIniziale);
  // L'aspetto non entra in `chiaveSpec`: e' resa, non domanda, e cambiarlo
  // non deve far ripartire la query.
  const [aspetto, setAspetto] = useState<AspettoGrafico | null>(aspettoIniziale ?? null);
  const [schedaPannello, setSchedaPannello] = useState<SchedaPannello>("campi");
  // «Modifica a parole» sta chiusa finche' non serve: aperta, spingerebbe il grafico fuori schermo.
  const [modificaAperta, setModificaAperta] = useState(false);
  // L'esito dell'ultimo gesto sui pozzetti, mostrato sopra il grafico (dove si guarda).
  const [avvisoTela, setAvvisoTela] = useState<{ tipo: "avviso" | "rifiuto"; testo: string } | null>(null);
  const pozzettiRef = useRef<ManigliaPozzetti>(null);
  // Il grafico occupa l'altezza che lo schermo lascia: niente scroll per vederlo intero.
  const [altezzaGrafico, setAltezzaGrafico] = useState(520);
  useEffect(() => {
    const calcola = () => setAltezzaGrafico(Math.max(340, Math.min(760, window.innerHeight - 330)));
    calcola();
    window.addEventListener("resize", calcola);
    return () => window.removeEventListener("resize", calcola);
  }, []);
  useEffect(() => {
    if (!avvisoTela) return;
    const timer = window.setTimeout(() => setAvvisoTela(null), 7000);
    return () => window.clearTimeout(timer);
  }, [avvisoTela]);
  const [salvataggio, setSalvataggio] = useState<"pronto" | "in_corso" | "salvata">("pronto");
  const [messaggioSalvataggio, setMessaggioSalvataggio] = useState("");
  const titoloModificato = useRef(Boolean(titoloIniziale));
  const specInizialeRef = useRef(specIniziale);
  const aggiornaEsistente = Boolean(idAnalisi && modificabile);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/bi/query", { signal: controller.signal })
      .then(async (risposta) => {
        const corpo: unknown = await risposta.json();
        if (!risposta.ok) throw new Error(messaggioErrore(corpo, "Vocabolario non disponibile."));
        return corpo as Vocabolario;
      })
      .then((dati) => {
        setVocabolario(dati);
        const iniziale = specInizialeRef.current;
        if (iniziale) {
          const tipologia = dati.tipologie.find((voce) =>
            voce.metriche.includes(iniziale.metrica)
          );
          setTipologiaScelta(tipologia?.chiave ?? null);
        }
      })
      .catch((causa: unknown) => {
        if (causa instanceof DOMException && causa.name === "AbortError") return;
        setErroreVocabolario(
          causa instanceof Error ? causa.message : "Vocabolario non disponibile."
        );
      });
    return () => controller.abort();
  }, []);

  function leggiMisure(segnale?: AbortSignal) {
    return fetch("/api/bi/misure", { signal: segnale })
      .then(async (risposta) => {
        if (!risposta.ok) return;
        const corpo: unknown = await risposta.json();
        if (!eOggetto(corpo) || !Array.isArray(corpo.misure)) return;
        setMisureSalvate(corpo.misure as MisuraSalvata[]);
        setChiGestisceMisure({
          utenteId: typeof corpo.utenteId === "string" ? corpo.utenteId : "",
          tutte: corpo.puoGestireTutte === true,
        });
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    const controller = new AbortController();
    void leggiMisure(controller.signal);
    return () => controller.abort();
  }, []);

  async function togliMisura(chiave: ChiaveCampo) {
    const salvata = misureSalvate.find((m) => m.misura && chiaveMisura(m.misura) === chiave);
    if (!salvata) return;
    if (
      !window.confirm(
        `Togliere «${salvata.nome}» dal catalogo? I riquadri che già la usano continuano a funzionare e a dare gli stessi numeri.`
      )
    ) {
      return;
    }
    try {
      const risposta = await fetch(`/api/bi/misure/${encodeURIComponent(salvata.id)}`, { method: "DELETE" });
      if (!risposta.ok) {
        const corpo: unknown = await risposta.json().catch(() => null);
        setErrore(messaggioErrore(corpo, "Non riesco a togliere la misura."));
        return;
      }
      await leggiMisure();
    } catch {
      setErrore("Non riesco a togliere la misura.");
    }
  }

  const serieAnalisi = useMemo<SerieAnalisi[]>(() => {
    if (!spec) return [];
    const nomePrincipale = nomePrincipaleScelto
      ?? serieIniziali?.find((voce) => voce.ruolo === "principale")?.nome
      ?? nomeConPeriodo(
        spec.misura?.nome
          ?? vocabolario?.metriche.find((voce) => voce.chiave === spec.metrica)?.etichetta
          ?? spec.metrica,
        valoreDellaSpec(spec)
      );
    return [{ ruolo: "principale", nome: nomePrincipale, spec }, ...serieAggiuntive];
  }, [nomePrincipaleScelto, serieAggiuntive, serieIniziali, spec, vocabolario]);
  const seriePersistita = serieAggiuntive.length > 0 ? serieAnalisi : null;
  // La chiave che decide se rieseguire deve contenere solo cio' che cambia i
  // NUMERI. Il colore e' una scelta di resa: lasciarlo qui dentro farebbe
  // partire una query certificata a ogni pastiglia cliccata, e il selettore
  // sembrerebbe lento per il motivo sbagliato.
  const chiaveSpec = useMemo(() => {
    if (!spec) return "";
    const serieSenzaResa = seriePersistita?.map(({ colore: _colore, ...resto }) => resto) ?? null;
    return JSON.stringify({ spec, serie: serieSenzaResa, periodoEreditato });
  }, [periodoEreditato, seriePersistita, spec]);

  useEffect(() => {
    if (!spec) return;
    setSerieAggiuntive((correnti) => correnti.map((voce) => {
      if (voce.scorciatoia) return { ...voce, spec: specDaScorciatoia(spec, voce.scorciatoia) };
      // Le misure spuntate nell'albero seguono la principale su suddivisione e
      // granularita': cambiare «mese» in «anno» deve spostare tutte le serie,
      // non solo la prima.
      // Anche il periodo fissato: senza, il budget spuntato nell'albero
      // arrivava per tutti gli anni mentre l'ordinato era fermo al 2026, e la
      // tabella si riempiva di mesi con il solo budget.
      const { periodo: _periodoVecchio, filtri: filtriVoce, ...restoSpec } = voce.spec;
      // I filtri seguono la principale, salvo per le serie che ne hanno di
      // propri: senza questo, una misura in piu' ignorava il filtro.
      const filtri =
        voce.eredita === false
          ? filtriVoce
          : filtriPerSerie(spec.filtri, voce.spec, vocabolario?.dimensioniPerMetrica);
      return {
        ...voce,
        spec: {
          ...restoSpec,
          ...(filtri ? { filtri } : {}),
          raggruppa: spec.raggruppa ? [...spec.raggruppa] : undefined,
          granularita: spec.granularita,
          ...(spec.periodo ? { periodo: { ...spec.periodo } } : {}),
        },
      };
    }));
  }, [spec, vocabolario]);

  useEffect(() => {
    if (!vocabolario || !spec) return;
    const controller = new AbortController();
    setCaricamento(true);
    setErrore("");

    // Il ritardo accorpa anche la digitazione libera dei filtri, che altrimenti
    // trasformerebbe ogni carattere in una query certificata completa.
    const attesa = window.setTimeout(() => {
      eseguiAnalisiComposita(
        { spec, serie: seriePersistita },
        { periodo: periodoEreditato },
        { signal: controller.signal }
      )
        .then((esito) => {
          const principale = esito.serie.find((voce) => voce.ruolo === "principale");
          if (!principale) throw new Error("Il motore non ha restituito la serie principale.");
          setRisultato(principale.risultato);
          setSerieEseguite(esito.serie);
          setErrore("");
        })
        .catch((causa: unknown) => {
          if (causa instanceof DOMException && causa.name === "AbortError") return;
          setErrore(causa instanceof Error ? causa.message : "Non riesco a calcolare questo riquadro.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setCaricamento(false);
        });
    }, 400);

    return () => {
      window.clearTimeout(attesa);
      controller.abort();
    };
  }, [chiaveSpec, periodoEreditato, seriePersistita, spec, vocabolario]);

  useEffect(() => {
    if (!spec || !vocabolario || titoloModificato.current) return;
    setTitolo(costruisciTitolo(spec, vocabolario));
  }, [chiaveSpec, spec, vocabolario]);

  const risultatoGrafico = serieEseguite.length > 1 ? serieEseguite : risultato;
  // Le voci della prima suddivisione, da colorare una per una nel pannello
  // Aspetto. Oltre trenta non si sceglie piu' un colore per ciascuna.
  const categorieDelRisultato = useMemo(() => {
    const dimensione = risultato?.spec.raggruppa?.[0];
    if (!risultato || !dimensione) return [];
    const voci = [...new Set(risultato.righe.map((riga) => riga.chiavi[dimensione]).filter(Boolean))];
    return voci.length <= 30 ? voci : [];
  }, [risultato]);
  const proposta = risultatoGrafico ? scegliGrafico(risultatoGrafico) : null;
  const grafici = risultatoGrafico ? graficiPossibili(risultatoGrafico) : [];
  // Perche' la tendina delle visualizzazioni e' cosi' corta. Si accorcia da
  // sola quando la forma del dato non regge un tipo, ed e' giusto, ma senza
  // dirlo chi guarda non sa che gli basterebbe cambiare una tendina.
  const sbloccaGrafici = risultatoGrafico ? comeSbloccareAltriGrafici(risultatoGrafico) : [];
  const tipoGrafico =
    graficoScelto && grafici.includes(graficoScelto) ? graficoScelto : proposta?.tipo;

  /**
   * La selezione dell'albero, ricavata dallo stato che gia' c'era.
   *
   * `serieAggiuntive` ha due proprietari: l'albero possiede le misure in piu'
   * (quelle senza `scorciatoia`), il pannello «Confronta con…» possiede anno
   * precedente e progressivo, che sono modificatori della stessa misura e non
   * misure diverse. Tenerli distinti e' l'unico modo perche' l'uno non
   * cancelli le serie dell'altro a ogni spunta.
   */
  const esteso = useMemo(() => {
    if (!vocabolario) return null;
    // Prima quelle del catalogo, poi quelle che le spec gia' portano (un
    // riquadro salvato con una misura poi archiviata deve poterla mostrare).
    const dalCatalogo = misureSalvate.flatMap((m) => (m.misura ? [m.misura] : []));
    const dalleSpec = misureNelleSpec([
      specIniziale,
      ...(serieIniziali ?? []).map((voce) => voce.spec),
      spec,
      ...serieAggiuntive.map((voce) => voce.spec),
    ]);
    const risultato = estendiVocabolario(vocabolario, [...dalCatalogo, ...dalleSpec]);
    // Quali operazioni (dataset) coinvolge ogni misura personalizzata: serve alla
    // regola sul numero del documento, che vale per una operazione alla volta.
    const famiglie = Object.fromEntries(
      Object.entries(risultato.definizioni).map(([chiave, misura]) => [chiave, famiglieDellaMisura(misura)])
    );
    return { ...risultato, famiglie };
  }, [misureSalvate, serieAggiuntive, serieIniziali, spec, specIniziale, vocabolario]);

  const vocabolarioAlbero: VocabolarioAlbero | null = vocabolario
    ? {
        tipologie: esteso?.vocabolario.tipologie ?? vocabolario.tipologie,
        metriche: esteso?.vocabolario.metriche ?? vocabolario.metriche,
        dimensioni: vocabolario.dimensioni,
        dimensioniPerMetrica: esteso?.vocabolario.dimensioniPerMetrica ?? vocabolario.dimensioniPerMetrica,
        famiglie: esteso?.famiglie,
        definizioni: esteso?.definizioni,
      }
    : null;

  // Tutte le serie sono valori, ciascuna col suo periodo: «ordinato» e «ordinato
  // dell'anno precedente» sono due valori diversi. Senza doppioni: una serie
  // generata dal pannello Confronti puo' coincidere con una scelta dai campi.
  const selezioneCampi: SelezioneCampi = spec
    ? {
        misure: [...new Set<ChiaveValore>([valoreDellaSpec(spec), ...serieAggiuntive.map((voce) => valoreDellaSpec(voce.spec))])],
        suddivisioni: spec.raggruppa ?? [],
        granularita: spec.granularita,
      }
    : SELEZIONE_VUOTA;

  // I pozzetti seguono la visualizzazione, come in Tableau: se e' una tabella
  // (proposta perche' i campi sono piu' di due, o scelta dalla fila delle
  // anteprime) non c'e' asse ne' legenda, ogni campo e' una colonna.
  const modalitaTabella = graficoScelto === "tabella" || tipoGrafico === "tabella";

  // Il numero del documento riparte ogni anno: chi lo mette fra i campi, con piu'
  // anni nel periodo, deve saperlo.
  const avvisoDocumento = spec
    ? avvisoNumeroDocumento(
        spec,
        famigliaDellaSpec(spec),
        periodoPresente(spec.periodo) ? spec.periodo : periodoEreditato
      )
    : null;

  /**
   * Il riquadro torna vuoto.
   *
   * E' uno stato lecito: chi vuole ricominciare non deve aggirare l'editor. Non
   * c'e' errore finche' non si prova a salvare (`salva`). Il titolo scelto a
   * mano resta; quello automatico si cancella insieme alla domanda; la tabella
   * resta tabella, perche' e' una scelta di come vedere i dati.
   */
  function svuotaRiquadro() {
    setSpec(null);
    setSerieAggiuntive([]);
    setRisultato(null);
    setSerieEseguite([]);
    setErrore("");
    setCaricamento(false);
    setGraficoScelto((scelto) => (scelto === "tabella" ? scelto : undefined));
    setAspetto(null);
    setNomePrincipaleScelto(null);
    setCronologia([]);
    if (!titoloModificato.current) setTitolo("");
    setSalvataggio("pronto");
    setMessaggioSalvataggio("");
  }

  function applicaSelezione(nuova: SelezioneCampi, definizioniExtra: Record<string, MisuraDefinita> = {}) {
    const [principale, ...altre] = nuova.misure;
    if (!principale) {
      svuotaRiquadro();
      return;
    }
    const definizioni = { ...(esteso?.definizioni ?? {}), ...definizioniExtra };

    const tipologia = esteso?.vocabolario.tipologie.find((voce) => voce.metriche.includes(chiaveBase(principale)));
    // Il gruppo delle misure personalizzate non esiste nel pannello «Un'altra
    // metrica»: non va scelto come tipologia di partenza.
    if (tipologia && tipologia.chiave !== "misure") setTipologiaScelta(tipologia.chiave);

    /** Il nome di un valore: l'etichetta della misura, col periodo se non e' il corrente. */
    const nomeDi = (valore: ChiaveValore) => {
      const chiave = chiaveBase(valore);
      return nomeConPeriodo(
        esteso?.vocabolario.metriche.find((voce) => voce.chiave === chiave)?.etichetta ?? definizioni[chiave]?.nome ?? chiave,
        valore
      );
    };

    const principaleSpec = specPerChiave(
      {
        ...(spec ?? { metrica: "ordinato" as const }),
        // Il periodo lo decide il valore (`ordinato@anno_precedente`), non
        // quello che la spec aveva prima.
        modificatore: "corrente",
        raggruppa: nuova.suddivisioni.length > 0 ? [...nuova.suddivisioni] : undefined,
        granularita: nuova.granularita,
      },
      principale,
      definizioni
    );
    // Senza definizione non c'e' domanda: si lascia com'era invece di calcolare altro.
    if (!principaleSpec) return;
    setSpec(principaleSpec);
    // Se la principale cambia (un'altra misura, o lo stesso valore a un altro
    // periodo) il nome la segue; un nome scelto a mano resta finche' non cambia.
    if (!spec || valoreDellaSpec(spec) !== valoreDellaSpec(principaleSpec)) setNomePrincipaleScelto(nomeDi(principale));

    setSerieAggiuntive((correnti) =>
      altre.flatMap((valore) => {
        const chiave = chiaveBase(valore);
        const gia = correnti.find((voce) => valoreDellaSpec(voce.spec) === valore);
        // Le serie nate dal pannello Confronti si chiamano «Anno precedente»: in
        // una tabella con piu' misure non dice di quale. Il nome scelto a mano,
        // invece, sopravvive.
        const nome = gia && !gia.scorciatoia ? gia.nome : nomeDi(valore);
        // La misura in piu' deve condividere suddivisione, granularita', periodo
        // e filtri della principale: e' la stessa domanda su un altro numero.
        // Senza, la serie si riduce a un solo valore e compare sull'asse come
        // una categoria di troppo chiamata «totale», accanto ai mesi.
        const specExtra = specPerChiave(
          {
            metrica: "ordinato",
            modificatore: "corrente",
            ...(nuova.suddivisioni.length > 0 ? { raggruppa: [...nuova.suddivisioni] } : {}),
            ...(nuova.granularita ? { granularita: nuova.granularita } : {}),
            ...(spec?.periodo ? { periodo: { ...spec.periodo } } : {}),
          },
          valore,
          definizioni
        );
        if (!specExtra) return [];
        const filtri = filtriPerSerie(spec?.filtri, specExtra, vocabolario?.dimensioniPerMetrica);
        const serie: SerieEditor = {
          ruolo: chiave === "budget" ? "obiettivo" : chiave === "bep" ? "soglia" : "confronto",
          nome,
          // Il colore scelto a mano sopravvive a una rispuntata.
          ...(gia?.colore ? { colore: gia.colore } : {}),
          spec: filtri ? { ...specExtra, filtri } : specExtra,
        };
        return [serie];
      })
    );

    // La tabella resta tabella: e' una scelta, non qualcosa che un campo in piu'
    // deve far dimenticare.
    setGraficoScelto((scelto) => (scelto === "tabella" ? scelto : undefined));
    setSalvataggio("pronto");
    setMessaggioSalvataggio("");
  }

  // Budget e BEP esistono solo per business unit e agente: con altri
  // raggruppamenti la serie collasserebbe sul totale e il confronto mentirebbe.
  // `spec` è null finché non si sceglie una metrica: senza spec non c'è niente
  // da confrontare, quindi il pulsante resta spento ma senza spiegazione —
  // non c'è ancora nulla da spiegare.
  const budgetDisponibile = spec !== null && ammetteConfrontoBudget(spec);
  const motivoBudget = spec === null ? null : motivoBudgetNonDisponibile(spec);
  const metricheConfrontoVisibili = (vocabolario?.tipologie.find(
    (voce) => voce.chiave === tipologiaConfronto
  )?.metriche ?? [])
    .map((chiave) => vocabolario?.metriche.find((metrica) => metrica.chiave === chiave))
    .filter((metrica): metrica is VoceMetrica => Boolean(metrica));
  const chiaviDimensioniAmmesse = spec
    ? esteso?.vocabolario.dimensioniPerMetrica[chiaveDellaSpec(spec)] ?? []
    : [];
  const dimensioniAmmesse = chiaviDimensioniAmmesse
    .map((chiave) => vocabolario?.dimensioni.find((dimensione) => dimensione.chiave === chiave))
    .filter((dimensione): dimensione is VoceDimensione => Boolean(dimensione));

  function aggiornaSpec(aggiornamento: (corrente: SpecQuery) => SpecQuery) {
    setSpec((corrente) => (corrente ? aggiornamento(corrente) : corrente));
    setSalvataggio("pronto");
    setMessaggioSalvataggio("");
  }

  function aggiungiScorciatoia(
    scorciatoia: ScorciatoiaConfronto,
    nome: string,
    ruolo: RuoloSerie
  ) {
    if (!spec) return;
    setSerieAggiuntive((correnti) => [
      ...correnti,
      { ruolo, nome, spec: specDaScorciatoia(spec, scorciatoia), scorciatoia },
    ]);
    setGraficoScelto(undefined);
    setSalvataggio("pronto");
    setMessaggioSalvataggio("");
  }

  function apriAltraMetrica() {
    const tipologia = tipologiaScelta ?? vocabolario?.tipologie[0]?.chiave ?? null;
    const primaMetrica = vocabolario?.tipologie.find((voce) => voce.chiave === tipologia)?.metriche[0] ?? null;
    setTipologiaConfronto(tipologia);
    setMetricaConfronto(primaMetrica);
    setAltraMetricaAperta(true);
  }

  function aggiungiAltraMetrica() {
    if (!spec || !metricaConfronto) return;
    const ammesse = new Set(vocabolario?.dimensioniPerMetrica[metricaConfronto] ?? []);
    // L'altra metrica e' una domanda diversa: la misura personalizzata della
    // principale non deve restarle attaccata.
    const specSenzaMisura: SpecQuery = { ...spec };
    delete specSenzaMisura.misura;
    const nuovaSpec: SpecQuery = {
      ...specSenzaMisura,
      metrica: metricaConfronto,
      raggruppa: spec.raggruppa?.filter((dimensione) => ammesse.has(dimensione)),
      filtri: spec.filtri?.filter(
        (filtro) => ammesse.has(filtro.campo) || (filtro.campo === "bu_categoria" && ammesse.has("bu"))
      ),
    };
    const nome = vocabolario?.metriche.find((voce) => voce.chiave === metricaConfronto)?.etichetta
      ?? metricaConfronto;
    // Una misura in piu' non deve aggiungere da sola una colonna di differenza:
    // si fissano le differenze che ci sono GIA' e quelle nuove le sceglie l'utente
    // dal pannello Aspetto.
    setAspetto((corrente) => {
      if (corrente?.tabella?.differenze !== undefined) return corrente;
      const iPrincipale = Math.max(0, serieAnalisi.findIndex((voce) => voce.ruolo === "principale"));
      const iConfronto = serieAnalisi.findIndex((voce) => voce.ruolo === "confronto");
      return {
        ...(corrente ?? {}),
        tabella: {
          ...(corrente?.tabella ?? {}),
          differenze: iConfronto >= 0 && iConfronto !== iPrincipale ? [{ da: iPrincipale, con: iConfronto }] : [],
        },
      };
    });
    setSerieAggiuntive((correnti) => [
      ...correnti,
      { ruolo: "confronto", nome, spec: nuovaSpec },
    ]);
    setAltraMetricaAperta(false);
    setGraficoScelto(undefined);
    setSalvataggio("pronto");
    setMessaggioSalvataggio("");
  }

  /** Il riquadro com'e' ora, nella forma che l'assistente puo' modificare. */
  const statoRiquadro: StatoRiquadro | null = spec
    ? {
        titolo,
        serie: serieAnalisi.map(({ ruolo, nome, colore, spec: specSerie }) => ({
          ruolo,
          nome,
          ...(colore ? { colore } : {}),
          spec: specSerie,
        })),
        ...(graficoScelto ? { grafico: graficoScelto } : {}),
      }
    : null;

  /**
   * Adotta lo stato proposto da una modifica a parole.
   *
   * Le serie che l'editor rigenera dalla principale (anno precedente, budget,
   * BEP, progressivo) vanno riconosciute e segnate come scorciatoie, altrimenti
   * resterebbero ferme quando la principale cambia. Prima si salva un punto di
   * ripristino: l'annullamento riporta il riquadro com'era.
   */
  function applicaStatoRiquadro(nuovo: StatoRiquadro) {
    if (!spec) return;
    setCronologia((correnti) => [
      ...correnti.slice(-9),
      { titolo, titoloModificato: titoloModificato.current, spec, serieAggiuntive, graficoScelto, aspetto, nomePrincipale: nomePrincipaleScelto },
    ]);
    const [principale, ...altre] = nuovo.serie;
    setNomePrincipaleScelto(principale.nome);
    setSpec(principale.spec);
    setSerieAggiuntive(
      altre.map((serie) => {
        const scorciatoia = scorciatoiaDi(serie, principale);
        return scorciatoia ? { ...serie, scorciatoia } : serie;
      })
    );
    setAspetto(riallineaDifferenze(aspetto, serieAnalisi, nuovo.serie));
    setGraficoScelto(nuovo.grafico);
    // Il titolo cambia solo se la modifica lo ha chiesto: altrimenti resta
    // quello di prima (o quello automatico, che segue la domanda).
    if (nuovo.titolo !== titolo.trim()) {
      titoloModificato.current = true;
      setTitolo(nuovo.titolo);
    }
    setSalvataggio("pronto");
    setMessaggioSalvataggio("");
  }

  function annullaUltimaModifica() {
    const ultima = cronologia.at(-1);
    if (!ultima) return;
    setCronologia((correnti) => correnti.slice(0, -1));
    setNomePrincipaleScelto(ultima.nomePrincipale);
    setSpec(ultima.spec);
    setSerieAggiuntive(ultima.serieAggiuntive);
    setGraficoScelto(ultima.graficoScelto);
    setAspetto(ultima.aspetto);
    titoloModificato.current = ultima.titoloModificato;
    setTitolo(ultima.titolo);
    setSalvataggio("pronto");
    setMessaggioSalvataggio("");
  }

  // Un campo lasciato sulla tela va nella zona scelta col gesto; la regola e' quella dei pozzetti.
  function rilasciaSullaTela(pozzetto: NomePozzetto, voce: VoceCampo) {
    pozzettiRef.current?.deponi(pozzetto, voce);
  }

  function ereditaPeriodo() {
    aggiornaSpec((corrente) => {
      const copia = { ...corrente };
      delete copia.periodo;
      return copia;
    });
  }

  function fissaPeriodo() {
    aggiornaSpec((corrente) => ({
      ...corrente,
      periodo: periodoPresente(periodoEreditato)
        ? { ...periodoEreditato }
        : { anni: [new Date().getFullYear()] },
    }));
  }

  function aggiornaFiltro(indice: number, filtro: Filtro) {
    aggiornaSpec((corrente) => ({
      ...corrente,
      filtri: (corrente.filtri ?? []).map((voce, posizione) =>
        posizione === indice ? filtro : voce
      ),
    }));
  }

  async function salva() {
    // Svuotare e' lecito; salvare un riquadro vuoto no.
    if (!spec) {
      setMessaggioSalvataggio("Il riquadro è vuoto: scegli almeno una misura prima di salvarlo.");
      return;
    }
    const titoloPulito = titolo.trim();
    if (!titoloPulito) {
      setMessaggioSalvataggio("Il titolo è obbligatorio.");
      return;
    }
    if (salvataggio === "in_corso") return;

    setSalvataggio("in_corso");
    setMessaggioSalvataggio("");
    try {
      const risposta = await fetch(
        aggiornaEsistente ? `/api/bi/analisi?id=${encodeURIComponent(idAnalisi ?? "")}` : "/api/bi/analisi",
        {
        method: aggiornaEsistente ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titolo: titoloPulito,
          spec,
          serie: seriePersistita,
          ...(tipoGrafico ? { grafico: tipoGrafico } : {}),
          aspetto,
        }),
      });
      const corpo: unknown = await risposta.json();
      if (!risposta.ok) {
        throw new Error(messaggioErrore(corpo, "Salvataggio non riuscito."));
      }
      const id =
        eOggetto(corpo) && eOggetto(corpo.analisi) && typeof corpo.analisi.id === "string"
          ? corpo.analisi.id
          : null;
      if (!id) throw new Error("Il salvataggio non ha restituito un identificativo.");
      setSalvataggio("salvata");
      setMessaggioSalvataggio(
        aggiornaEsistente
          ? "Modifiche salvate."
          : dentroUnaPagina
            ? "Riquadro aggiunto alla pagina."
            : "Riquadro salvato."
      );
      onSalvata?.(id);
    } catch (causa) {
      setSalvataggio("pronto");
      setMessaggioSalvataggio(
        causa instanceof Error ? causa.message : "Salvataggio non riuscito."
      );
    }
  }

  if (erroreVocabolario) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8">
        <p role="alert" className="rounded-xl border border-border bg-bg-page p-4 text-danger">
          {erroreVocabolario}
        </p>
      </main>
    );
  }

  if (!vocabolario) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8">
        <Scheletro altezza={altezzaGrafico} />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 py-3 sm:px-6">
      <header className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href="/bi/analisi" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Torna alle analisi
        </Link>
        <h1 className="font-tenorite text-xl font-semibold">
          {aggiornaEsistente ? "Modifica il riquadro" : modificabile ? "Costruisci un riquadro" : "Crea una copia modificabile"}
        </h1>
        {!modificabile && (
          <p className="text-sm text-text-muted">
            Questo riquadro è condiviso o appartiene al Cruscotto: le tue modifiche finiranno in una copia tua, l’originale resta com’è.
          </p>
        )}
      </header>

      {creaMisuraAperta && (
        <CreaMisura
          testoIniziale={testoNuovaMisura}
          onChiudi={() => setCreaMisuraAperta(false)}
          onSalvata={(salvata) => {
            setCreaMisuraAperta(false);
            if (!salvata.misura) return;
            const misura = salvata.misura;
            setMisureSalvate((correnti) => [salvata, ...correnti.filter((m) => m.id !== salvata.id)]);
            const chiave = chiaveMisura(misura);
            // Si usa subito: la misura appena creata si aggiunge a quelle
            // spuntate (o diventa la principale se non c'era niente).
            applicaSelezione(
              { ...selezioneCampi, misure: [...selezioneCampi.misure, chiave] },
              { [chiave]: misura }
            );
          }}
        />
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
        {/* LA TELA: il grafico in grande, con titolo e salvataggio sopra. */}
        <div className="min-w-0 space-y-4">
          <div className="rounded-xl border border-border bg-bg p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="editor-titolo" className="sr-only">
                Titolo del riquadro
              </label>
              <input
                id="editor-titolo"
                aria-label="Titolo del riquadro"
                placeholder="Titolo del riquadro"
                required
                value={titolo}
                onChange={(evento) => {
                  titoloModificato.current = true;
                  setTitolo(evento.target.value);
                  setSalvataggio("pronto");
                  setMessaggioSalvataggio("");
                }}
                className={`${CLASSE_CAMPO} flex-1 font-tenorite text-base font-semibold`}
              />
              <button
                type="button"
                disabled={!spec}
                aria-expanded={modificaAperta}
                onClick={() => setModificaAperta((aperta) => !aperta)}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                  modificaAperta ? "border-primary bg-primary/10 text-primary" : "border-border bg-bg-page text-text"
                }`}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                A parole
              </button>
              <button
                type="button"
                onClick={() => void salva()}
                disabled={salvataggio === "in_corso" || salvataggio === "salvata"}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-bg focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" aria-hidden />
                {salvataggio === "in_corso"
                  ? dentroUnaPagina ? "Aggiungo…" : "Salvataggio…"
                  : salvataggio === "salvata"
                    ? dentroUnaPagina ? "Aggiunta" : "Salvata"
                    : aggiornaEsistente
                      ? "Salva modifiche"
                      : dentroUnaPagina
                        ? "Aggiungi alla pagina"
                        : modificabile
                          ? "Salva il riquadro"
                          : "Salva una copia"}
              </button>
            </div>
            {messaggioSalvataggio && (
              <p
                role="status"
                className={`mt-2 text-xs ${salvataggio === "salvata" ? "text-primary" : "text-danger"}`}
              >
                {messaggioSalvataggio}
              </p>
            )}
          </div>

          {!spec ? (
            <TelaRilascio inTabella={modalitaTabella} onRilascia={rilasciaSullaTela} avviso={avvisoTela} onChiudiAvviso={() => setAvvisoTela(null)}>
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-bg px-6 text-center" style={{ minHeight: altezzaGrafico + 80 }}>
              <p className="font-tenorite text-lg font-semibold">
                {modalitaTabella ? "La tabella comparirà qui" : "Il grafico comparirà qui"}
              </p>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">
                {modalitaTabella
                  ? "Trascina qui un valore dall’elenco a destra, oppure spuntalo. Poi aggiungi quanti campi vuoi: ognuno è una colonna, e la tabella si ricalcola a ogni scelta."
                  : "Trascina qui una misura dall’elenco a destra, oppure spuntala. Poi trascina una dimensione per suddividerla: il grafico si ricalcola a ogni scelta."}
              </p>
            </div>
            </TelaRilascio>
          ) : (
          <>
      {statoRiquadro && (
        <div hidden={!modificaAperta}>
        <ModificaAParole
          stato={statoRiquadro}
          risultatiPrima={serieEseguite}
          graficoPrima={tipoGrafico}
          aspetto={aspetto}
          periodoEreditato={periodoEreditato}
          onApplica={applicaStatoRiquadro}
          puoAnnullare={cronologia.length > 0}
          onAnnulla={annullaUltimaModifica}
        />
        </div>
      )}
          <Scheda
            titolo="Risultato in tempo reale"
            azione={
              risultato ? (
                <div className="text-right">
                  <p className="text-xs text-text-muted">Totale</p>
                  <p className="font-tenorite text-xl font-semibold text-primary tabular-nums">
                    {formattaTotale(risultato)}
                  </p>
                </div>
              ) : null
            }
          >
            {errore && (
              <p role="alert" className="mb-4 rounded-lg border border-border bg-bg-page p-3 text-sm text-danger">
                {errore}
              </p>
            )}

            <TelaRilascio inTabella={modalitaTabella} onRilascia={rilasciaSullaTela} avviso={avvisoTela} onChiudiAvviso={() => setAvvisoTela(null)}>
            <div className="relative" style={{ minHeight: altezzaGrafico }} aria-busy={caricamento}>
              {risultato && tipoGrafico && serieEseguite.length > 0 ? (
                <div className={caricamento ? "opacity-50" : undefined}>
                  <GraficoDaAnalisi serie={serieEseguite} aspetto={aspetto} tipo={tipoGrafico} altezza={altezzaGrafico} />
                </div>
              ) : (
                <Scheletro altezza={altezzaGrafico} />
              )}
              {caricamento && risultato && (
                <div className="pointer-events-none absolute inset-0 opacity-50">
                  <Scheletro altezza={altezzaGrafico} />
                </div>
              )}
            </div>
            </TelaRilascio>

            {!periodoPresente(spec.periodo) && (
              <p className="mt-3 text-xs leading-relaxed text-text-muted">
                Anteprima con il periodo ereditato: {descriviPeriodo(periodoEreditato)}. La spec salvata non fissa il periodo.
              </p>
            )}

            {risultato && proposta && tipoGrafico && (!modalitaTabella || risultato.avvisi.length > 0 || avvisoDocumento) && (
              <div className="mt-4 border-t border-border pt-3">
                {/* Chi ha scelto la tabella non vuole sapere quale grafico gli si proporrebbe. */}
                {!modalitaTabella && (
                  <p className="text-xs text-text-muted">
                    <span className="font-medium text-text">Grafico proposto: {NOMI_GRAFICI[proposta.tipo]}.</span>{" "}
                    {proposta.motivo}
                  </p>
                )}
                {!modalitaTabella && sbloccaGrafici.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs leading-relaxed text-text-muted">
                    {sbloccaGrafici.map((suggerimento) => (
                      <li key={suggerimento}>{suggerimento}</li>
                    ))}
                  </ul>
                )}

                {(risultato.avvisi.length > 0 || avvisoDocumento) && (
                  <div className="mt-4 space-y-2" aria-label="Avvisi del risultato">
                    {[...(avvisoDocumento ? [avvisoDocumento] : []), ...risultato.avvisi].map((avviso) => (
                      <p key={avviso} className="rounded-lg border border-border bg-bg-page p-3 text-xs leading-relaxed text-warning">
                        {avviso}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Scheda>
          </>
          )}
        </div>

        {/* IL PANNELLO DEI PARAMETRI: tutto quello che si puo' usare e combinare. */}
        <aside
          aria-label="Parametri del riquadro"
          className="flex min-w-0 flex-col rounded-xl border border-border bg-bg xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)]"
        >
          <div
            role="tablist"
            aria-label="Sezioni del pannello"
            className="grid shrink-0 grid-cols-4 border-b border-border bg-bg"
          >
            {SCHEDE_PANNELLO.map((voce) => (
              <button
                key={voce.chiave}
                type="button"
                role="tab"
                id={`scheda-${voce.chiave}`}
                aria-selected={schedaPannello === voce.chiave}
                aria-controls={`pannello-${voce.chiave}`}
                onClick={() => setSchedaPannello(voce.chiave)}
                className={`min-h-9 border-b-2 px-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                  schedaPannello === voce.chiave
                    ? "border-primary text-primary"
                    : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                {voce.etichetta}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id="pannello-campi"
            aria-labelledby="scheda-campi"
            hidden={schedaPannello !== "campi"}
            className="flex min-h-0 flex-1 flex-col gap-3 p-2.5 max-xl:min-h-[560px] [&[hidden]]:hidden"
          >
            {vocabolario && vocabolarioAlbero && (
              <>
                {risultato && proposta && tipoGrafico && (
                  <TipoGraficoCompatto
                    valore={tipoGrafico}
                    opzioni={grafici}
                    onChange={(tipo) => {
                      setGraficoScelto(tipo);
                      setSalvataggio("pronto");
                      setMessaggioSalvataggio("");
                    }}
                  />
                )}
                <Pozzetti
                  ref={pozzettiRef}
                  modalita={modalitaTabella ? "tabella" : "grafico"}
                  compatto
                  onMessaggio={setAvvisoTela}
                  vocabolario={vocabolarioAlbero}
                  selezione={selezioneCampi}
                  filtri={spec?.filtri ?? []}
                  onCambia={(nuova) => applicaSelezione(nuova)}
                  onAggiungiFiltro={(campo) => {
                    aggiornaSpec((corrente) => ({
                      ...corrente,
                      filtri: [...(corrente.filtri ?? []), { campo, op: "in", valore: [] }],
                    }));
                    // I valori si scelgono nella scheda Filtri: ci si porta chi ha appena aggiunto il filtro.
                    setSchedaPannello("filtri");
                  }}
                  onTogliFiltro={(indice) =>
                    aggiornaSpec((corrente) => ({
                      ...corrente,
                      filtri: (corrente.filtri ?? []).filter((_, posizione) => posizione !== indice),
                    }))
                  }
                  onVaiAiFiltri={() => setSchedaPannello("filtri")}
                />
                <AlberoCampi
                  compatto
                  senzaLimiteSuddivisioni
                  vocabolario={vocabolarioAlbero}
                  selezione={selezioneCampi}
                  onCambia={(nuova) => applicaSelezione(nuova)}
                  onPartiDa={(testo) => {
                    setTestoNuovaMisura(testo);
                    setCreaMisuraAperta(true);
                  }}
                  azioneMisure={
                    <button
                      type="button"
                      onClick={() => {
                        setTestoNuovaMisura("");
                        setCreaMisuraAperta(true);
                      }}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-primary bg-bg-page px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Nuova misura a parole
                    </button>
                  }
                  puoTogliereMisura={(chiave) => {
                    const salvata = misureSalvate.find((m) => m.misura && chiaveMisura(m.misura) === chiave);
                    return Boolean(salvata && (chiGestisceMisure.tutte || salvata.autoreId === chiGestisceMisure.utenteId));
                  }}
                  onTogliMisura={(chiave) => void togliMisura(chiave)}
                />
              </>
            )}
          </div>

          <div
            role="tabpanel"
            id="pannello-filtri"
            aria-labelledby="scheda-filtri"
            hidden={schedaPannello !== "filtri"}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 [&[hidden]]:hidden"
          >
            {spec ? (
              <>
          <Scheda titolo="Quando" sottotitolo="Segui la dashboard oppure mantieni un confronto fisso">
            <fieldset>
              <legend className="sr-only">Modalità del periodo</legend>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg-page p-3 text-sm">
                  <input
                    type="radio"
                    name="modalita-periodo"
                    checked={!periodoPresente(spec.periodo)}
                    onChange={ereditaPeriodo}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span>
                    <span className="block font-medium">Eredita dalla dashboard</span>
                    <span className="mt-1 block text-xs text-text-muted">Segue il periodo scelto nella pagina.</span>
                  </span>
                </label>
                <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg-page p-3 text-sm">
                  <input
                    type="radio"
                    name="modalita-periodo"
                    checked={periodoPresente(spec.periodo)}
                    onChange={fissaPeriodo}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span>
                    <span className="block font-medium">Fissa un periodo</span>
                    <span className="mt-1 block text-xs text-text-muted">Resta fermo quando cambia la pagina.</span>
                  </span>
                </label>
              </div>
            </fieldset>

            {periodoPresente(spec.periodo) && (
              <div className="mt-3">
                <p className="mb-2 text-xs leading-relaxed text-text-muted">
                  Questo riquadro resterà sul periodo fissato anche quando la dashboard cambia periodo.
                </p>
                <div className="mb-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={anniDelPeriodo(spec.periodo) !== null}
                      onChange={(evento) =>
                        aggiornaSpec((corrente) => ({
                          ...corrente,
                          periodo: evento.target.checked
                            ? { ...senzaAnni(corrente.periodo), anni: [new Date().getFullYear()] }
                            : togliAnni(corrente.periodo),
                        }))
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    Solo questi anni
                  </label>
                  {anniDelPeriodo(spec.periodo) && (
                    <div className="mt-2">
                      <SelettoreAnni
                        valore={anniDelPeriodo(spec.periodo) ?? []}
                        etichetta="Anni del riquadro"
                        onCambia={(anni) =>
                          aggiornaSpec((corrente) => ({
                            ...corrente,
                            periodo: { ...senzaAnni(corrente.periodo), anni },
                          }))
                        }
                      />
                    </div>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <label className="text-xs text-text-muted">
                    Dal
                    <input
                      aria-label="Dal"
                      type="date"
                      value={spec.periodo.dal ?? ""}
                      onChange={(evento) =>
                        aggiornaSpec((corrente) => ({
                          ...corrente,
                          periodo: { ...corrente.periodo, dal: evento.target.value || undefined },
                        }))
                      }
                      className={`${CLASSE_CAMPO} mt-1`}
                    />
                  </label>
                  <label className="text-xs text-text-muted">
                    Al
                    <input
                      aria-label="Al"
                      type="date"
                      value={spec.periodo.al ?? ""}
                      onChange={(evento) =>
                        aggiornaSpec((corrente) => ({
                          ...corrente,
                          periodo: { ...corrente.periodo, al: evento.target.value || undefined },
                        }))
                      }
                      className={`${CLASSE_CAMPO} mt-1`}
                    />
                  </label>
                </div>
              </div>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="text-xs text-text-muted">
                Granularità
                <select
                  aria-label="Granularità"
                  value={spec.granularita ?? ""}
                  onChange={(evento) =>
                    aggiornaSpec((corrente) => ({
                      ...corrente,
                      granularita: (evento.target.value || undefined) as Granularita | undefined,
                    }))
                  }
                  className={`${CLASSE_CAMPO} mt-1`}
                >
                  <option value="">Totale del periodo</option>
                  {vocabolario.granularita.map((granularita) => (
                    <option key={granularita} value={granularita}>
                      {granularita[0].toLocaleUpperCase("it") + granularita.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-text-muted">
                Confronto
                <select
                  aria-label="Confronto"
                  value={spec.modificatore ?? "corrente"}
                  onChange={(evento) =>
                    aggiornaSpec((corrente) => ({
                      ...corrente,
                      modificatore: evento.target.value as Modificatore,
                    }))
                  }
                  className={`${CLASSE_CAMPO} mt-1`}
                >
                  {vocabolario.modificatori.map((modificatore) => (
                    <option
                      key={modificatore.chiave}
                      value={modificatore.chiave}
                      disabled={Boolean(spec.misura) && modificatore.chiave.startsWith("progressivo")}
                    >
                      {modificatore.descrizione}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Scheda>

          <div id="editor-filtri">
          <Scheda
            titolo="Solo dove"
            sottotitolo="Tieni solo le righe che ti interessano"
            azione={
              <button
                type="button"
                onClick={() =>
                  aggiornaSpec((corrente) => ({
                    ...corrente,
                    filtri: [
                      ...(corrente.filtri ?? []),
                      { campo: dimensioniAmmesse[0]?.chiave ?? "bu", op: "in", valore: [] },
                    ],
                  }))
                }
                className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border bg-bg-page px-3 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Aggiungi
              </button>
            }
          >
            {(spec.filtri ?? []).length === 0 ? (
              <p className="text-sm text-text-muted">Nessun filtro: stai guardando l’intero perimetro disponibile.</p>
            ) : (
              <div className="space-y-3">
                {(spec.filtri ?? []).map((filtro, indice) => (
                  <div key={indice} className="grid gap-2 sm:grid-cols-[1fr_1fr_1.2fr_auto]">
                    <select
                      aria-label={`Dimensione filtro ${indice + 1}`}
                      value={filtro.campo === "bu_categoria" ? "bu" : filtro.campo}
                      onChange={(evento) =>
                        // Cambiando campo i valori scelti non valgono piu'.
                        aggiornaFiltro(indice, {
                          campo: evento.target.value as Dimensione,
                          op: filtro.op,
                          valore: filtro.op === "in" ? [] : "",
                        })
                      }
                      className={CLASSE_CAMPO}
                    >
                      {dimensioniAmmesse.map((dimensione) => (
                        <option key={dimensione.chiave} value={dimensione.chiave}>
                          {dimensione.etichetta}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Operatore filtro ${indice + 1}`}
                      value={filtro.op}
                      onChange={(evento) => {
                        const op = evento.target.value as Filtro["op"];
                        const lista = Array.isArray(filtro.valore)
                          ? filtro.valore
                          : valoreFiltroPerCampo(filtro).split(",").map((voce) => voce.trim()).filter(Boolean);
                        // Da «è uno tra» a un operatore a valore singolo si tiene il
                        // primo: unirli in "A, B" darebbe un valore che non esiste.
                        const valore = op === "in" ? lista : lista[0] ?? "";
                        aggiornaFiltro(indice, { ...filtro, op, valore });
                      }}
                      className={CLASSE_CAMPO}
                    >
                      {Object.entries(NOMI_OPERATORI).map(([op, nome]) => (
                        <option key={op} value={op}>
                          {nome}
                        </option>
                      ))}
                    </select>
                    {filtro.op === "eq" || filtro.op === "in" ? (
                      // I valori si scelgono fra quelli presenti nei dati; per
                      // business unit e categoria, ad albero.
                      <SelettoreValori
                        etichetta={`Valore filtro ${indice + 1}`}
                        campo={filtro.campo}
                        metrica={spec.metrica}
                        periodo={spec.periodo ?? periodoEreditato}
                        filtro={filtro}
                        onChange={(nuovo) =>
                          aggiornaFiltro(
                            indice,
                            nuovo ?? {
                              campo: filtro.campo === "bu_categoria" ? "bu" : filtro.campo,
                              op: "in",
                              valore: [],
                            }
                          )
                        }
                      />
                    ) : (
                      <input
                        aria-label={`Valore filtro ${indice + 1}`}
                        value={valoreFiltroPerCampo(filtro)}
                        placeholder="Valore"
                        onChange={(evento) => aggiornaFiltro(indice, { ...filtro, valore: evento.target.value })}
                        className={CLASSE_CAMPO}
                      />
                    )}
                    <button
                      type="button"
                      aria-label={`Rimuovi filtro ${indice + 1}`}
                      onClick={() =>
                        aggiornaSpec((corrente) => ({
                          ...corrente,
                          filtri: (corrente.filtri ?? []).filter((_, posizione) => posizione !== indice),
                        }))
                      }
                      className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-border bg-bg-page text-danger focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Scheda>
          </div>
              </>
            ) : (
              <p className="text-sm text-text-muted">Scegli prima una misura nella scheda «Campi».</p>
            )}
          </div>

          <div
            role="tabpanel"
            id="pannello-confronti"
            aria-labelledby="scheda-confronti"
            hidden={schedaPannello !== "confronti"}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 [&[hidden]]:hidden"
          >
            {spec ? (
              <>
          <Scheda
            titolo="Confronta con…"
            sottotitolo="Aggiungi una misura allo stesso riquadro"
          >
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <button
                type="button"
                onClick={() => aggiungiScorciatoia("anno_precedente", "Anno precedente", "confronto")}
                className="min-h-10 rounded-lg border border-border bg-bg-page px-3 text-left text-sm font-medium text-text transition-colors hover:border-primary hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              >
                Anno precedente
              </button>
              <button
                type="button"
                disabled={!budgetDisponibile}
                title={motivoBudget ?? undefined}
                onClick={() => aggiungiScorciatoia("budget", "Budget", "obiettivo")}
                className="min-h-10 rounded-lg border border-border bg-bg-page px-3 text-left text-sm font-medium text-text transition-colors hover:border-primary hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text"
              >
                Budget
              </button>
              <button
                type="button"
                disabled={!budgetDisponibile}
                title={motivoBudget ?? undefined}
                onClick={() => aggiungiScorciatoia("bep", "BEP", "soglia")}
                className="min-h-10 rounded-lg border border-border bg-bg-page px-3 text-left text-sm font-medium text-text transition-colors hover:border-primary hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text"
              >
                BEP
              </button>
              <button
                type="button"
                disabled={Boolean(spec.misura)}
                title={spec.misura ? "Il progressivo non è disponibile per le misure personalizzate." : undefined}
                onClick={() => aggiungiScorciatoia("progressivo", "Progressivo", "confronto")}
                className="min-h-10 rounded-lg border border-border bg-bg-page px-3 text-left text-sm font-medium text-text transition-colors hover:border-primary hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text"
              >
                Progressivo
              </button>
              {motivoBudget && (
                <p className="text-xs leading-relaxed text-text-muted sm:col-span-2 xl:col-span-1">
                  {motivoBudget}
                </p>
              )}
              <button
                type="button"
                onClick={apriAltraMetrica}
                className="min-h-10 rounded-lg border border-primary bg-bg-page px-3 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary sm:col-span-2 xl:col-span-1"
              >
                Un’altra metrica…
              </button>
            </div>

            {altraMetricaAperta && (
              <div className="mt-3 space-y-3 border-t border-border pt-3">
                <label className="block text-xs text-text-muted">
                  Tipologia
                  <select
                    aria-label="Tipologia della metrica di confronto"
                    value={tipologiaConfronto ?? ""}
                    onChange={(evento) => {
                      const chiave = evento.target.value as ChiaveTipologia;
                      const prima = vocabolario.tipologie.find((voce) => voce.chiave === chiave)?.metriche[0] ?? null;
                      setTipologiaConfronto(chiave);
                      setMetricaConfronto(prima);
                    }}
                    className={`${CLASSE_CAMPO} mt-1`}
                  >
                    {vocabolario.tipologie.map((tipologia) => (
                      <option key={tipologia.chiave} value={tipologia.chiave}>{tipologia.etichetta}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-text-muted">
                  Metrica
                  <select
                    aria-label="Metrica di confronto"
                    value={metricaConfronto ?? ""}
                    onChange={(evento) => setMetricaConfronto(evento.target.value as ChiaveMetrica)}
                    className={`${CLASSE_CAMPO} mt-1`}
                  >
                    {metricheConfrontoVisibili.map((metrica) => (
                      <option key={metrica.chiave} value={metrica.chiave}>{metrica.etichetta}</option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={aggiungiAltraMetrica}
                    disabled={!metricaConfronto}
                    className="min-h-10 rounded-lg bg-primary px-3 text-sm font-semibold text-bg focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  >
                    Aggiungi confronto
                  </button>
                  <button
                    type="button"
                    onClick={() => setAltraMetricaAperta(false)}
                    className="min-h-10 rounded-lg border border-border bg-bg-page px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}

            {serieAggiuntive.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-border pt-4" aria-label="Serie aggiunte">
                {serieAggiuntive.map((voce, indice) => (
                  <div key={`${voce.ruolo}-${indice}`} className="grid gap-2 rounded-lg bg-bg-page p-2 sm:grid-cols-[auto_1fr_auto_auto] sm:items-center">
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
                      {NOMI_RUOLI[voce.ruolo]}
                    </span>
                    <input
                      aria-label={`Nome serie ${indice + 1}`}
                      value={voce.nome}
                      onChange={(evento) => {
                        const nome = evento.target.value;
                        setSerieAggiuntive((correnti) => correnti.map((serie, posizione) =>
                          posizione === indice ? { ...serie, nome } : serie
                        ));
                        setSalvataggio("pronto");
                        setMessaggioSalvataggio("");
                      }}
                      className={CLASSE_CAMPO}
                    />
                    <SelettoreColore
                      valore={voce.colore}
                      etichetta={`Colore di ${voce.nome || `serie ${indice + 1}`}`}
                      onCambia={(colore) => {
                        setSerieAggiuntive((correnti) => correnti.map((serie, posizione) => {
                          if (posizione !== indice) return serie;
                          // Togliere la chiave, non metterla a undefined: il
                          // jsonb salvato porterebbe con se' un campo nullo che
                          // il validatore poi rifiuta.
                          const { colore: _tolto, ...resto } = serie;
                          return colore === undefined ? resto : { ...resto, colore };
                        }));
                        setSalvataggio("pronto");
                        setMessaggioSalvataggio("");
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`Rimuovi serie ${voce.nome}`}
                      onClick={() => {
                        setSerieAggiuntive((correnti) => correnti.filter((_, posizione) => posizione !== indice));
                        setGraficoScelto(undefined);
                        setSalvataggio("pronto");
                        setMessaggioSalvataggio("");
                      }}
                      className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-border text-danger focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Scheda>
              </>
            ) : (
              <p className="text-sm text-text-muted">Scegli prima una misura nella scheda «Campi».</p>
            )}
          </div>

          <div
            role="tabpanel"
            id="pannello-aspetto"
            aria-labelledby="scheda-aspetto"
            hidden={schedaPannello !== "aspetto"}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 [&[hidden]]:hidden"
          >
            {spec ? (
          <PannelloAspetto
            aspetto={aspetto}
            onCambia={(nuovo) => {
              setAspetto(nuovo);
              setSalvataggio("pronto");
              setMessaggioSalvataggio("");
            }}
            nomiSerie={serieAnalisi.map((voce) => voce.nome)}
            ruoliSerie={serieAnalisi.map((voce) => voce.ruolo)}
            categorie={categorieDelRisultato}
          />
            ) : (
              <p className="text-sm text-text-muted">Scegli prima una misura nella scheda «Campi».</p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
