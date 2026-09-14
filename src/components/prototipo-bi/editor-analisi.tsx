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

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { GraficoDaAnalisi } from "@/components/prototipo-bi/grafico-da-risultato";
import { Scheda, Scheletro, euro, numero } from "@/components/prototipo-bi/primitivi";
import { useImpostazioni } from "@/components/prototipo-bi/impostazioni";
import {
  ammetteConfrontoBudget,
  eseguiAnalisiComposita,
  motivoBudgetNonDisponibile,
} from "@/lib/prototipo-bi/analisi-composita";
import {
  NOMI_GRAFICI,
  graficiPossibili,
  scegliGrafico,
  type TipoGrafico,
} from "@/lib/prototipo-bi/scelta-grafico";
import type {
  ChiaveMetrica,
  Dimensione,
  Filtro,
  Granularita,
  Modificatore,
  Periodo,
  RisultatoQuery,
  RuoloSerie,
  SerieAnalisi,
  SerieAnalisiEseguita,
  SpecQuery,
} from "@/lib/prototipo-bi/tipi";
import type { ChiaveTipologia } from "@/lib/prototipo-bi/tassonomia";

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

type ScorciatoiaConfronto = "anno_precedente" | "budget" | "bep" | "progressivo";

interface SerieEditor extends SerieAnalisi {
  scorciatoia?: ScorciatoiaConfronto;
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
  return { ...spec, metrica: scorciatoia };
}

function eOggetto(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === "object" && valore !== null;
}

function messaggioErrore(corpo: unknown, ripiego: string): string {
  return eOggetto(corpo) && typeof corpo.error === "string" ? corpo.error : ripiego;
}

function costruisciTitolo(spec: SpecQuery, vocabolario: Vocabolario): string {
  const metrica = vocabolario.metriche.find((voce) => voce.chiave === spec.metrica)?.etichetta;
  const dimensioni = (spec.raggruppa ?? [])
    .map((chiave) =>
      vocabolario.dimensioni.find((voce) => voce.chiave === chiave)?.etichetta.toLocaleLowerCase("it")
    )
    .filter((voce): voce is string => Boolean(voce));
  const parti = [metrica ?? spec.metrica];
  if (dimensioni.length > 0) parti.push(`per ${dimensioni.join(" e ")}`);
  if (spec.periodo?.anno) parti.push(String(spec.periodo.anno));
  else if (spec.periodo?.dal || spec.periodo?.al) {
    parti.push([spec.periodo.dal, spec.periodo.al].filter(Boolean).join(" – "));
  }
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

function periodoPresente(periodo: Periodo | undefined): periodo is Periodo {
  return Boolean(periodo && (periodo.anno !== undefined || periodo.dal || periodo.al));
}

function descriviPeriodo(periodo: Periodo | undefined): string {
  if (!periodoPresente(periodo)) return "il periodo corrente della dashboard";
  if (periodo.anno !== undefined) return String(periodo.anno);
  if (periodo.dal && periodo.al) return `${periodo.dal} – ${periodo.al}`;
  if (periodo.dal) return `dal ${periodo.dal}`;
  return `fino al ${periodo.al}`;
}

export function EditorAnalisi({
  idAnalisi,
  specIniziale,
  serieIniziali,
  titoloIniziale,
  graficoIniziale,
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
  const [serieAggiuntive, setSerieAggiuntive] = useState<SerieEditor[]>(
    () => serieIniziali?.filter((voce) => voce.ruolo !== "principale") ?? []
  );
  const [tipologiaScelta, setTipologiaScelta] = useState<ChiaveTipologia | null>(null);
  const [risultato, setRisultato] = useState<RisultatoQuery | null>(null);
  const [serieEseguite, setSerieEseguite] = useState<SerieAnalisiEseguita[]>([]);
  const [altraMetricaAperta, setAltraMetricaAperta] = useState(false);
  const [tipologiaConfronto, setTipologiaConfronto] = useState<ChiaveTipologia | null>(null);
  const [metricaConfronto, setMetricaConfronto] = useState<ChiaveMetrica | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState("");
  const [erroreVocabolario, setErroreVocabolario] = useState("");
  const [titolo, setTitolo] = useState(titoloIniziale ?? "");
  const [graficoScelto, setGraficoScelto] = useState<TipoGrafico | undefined>(graficoIniziale);
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

  const serieAnalisi = useMemo<SerieAnalisi[]>(() => {
    if (!spec) return [];
    const nomePrincipale = serieIniziali?.find((voce) => voce.ruolo === "principale")?.nome
      ?? vocabolario?.metriche.find((voce) => voce.chiave === spec.metrica)?.etichetta
      ?? spec.metrica;
    return [{ ruolo: "principale", nome: nomePrincipale, spec }, ...serieAggiuntive];
  }, [serieAggiuntive, serieIniziali, spec, vocabolario]);
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
    setSerieAggiuntive((correnti) => correnti.map((voce) =>
      voce.scorciatoia ? { ...voce, spec: specDaScorciatoia(spec, voce.scorciatoia) } : voce
    ));
  }, [spec]);

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
  const proposta = risultatoGrafico ? scegliGrafico(risultatoGrafico) : null;
  const grafici = risultatoGrafico ? graficiPossibili(risultatoGrafico) : [];
  const tipoGrafico =
    graficoScelto && grafici.includes(graficoScelto) ? graficoScelto : proposta?.tipo;
  const dimensioniScelte = spec?.raggruppa ?? [];
  const limiteDimensioniRaggiunto = dimensioniScelte.length >= 2;

  // Budget e BEP esistono solo per business unit e agente: con altri
  // raggruppamenti la serie collasserebbe sul totale e il confronto mentirebbe.
  // `spec` è null finché non si sceglie una metrica: senza spec non c'è niente
  // da confrontare, quindi il pulsante resta spento ma senza spiegazione —
  // non c'è ancora nulla da spiegare.
  const budgetDisponibile = spec !== null && ammetteConfrontoBudget(spec);
  const motivoBudget = spec === null ? null : motivoBudgetNonDisponibile(spec);
  const tipologiaAttiva = vocabolario?.tipologie.find(
    (voce) => voce.chiave === tipologiaScelta
  );
  const metricheVisibili = (tipologiaAttiva?.metriche ?? [])
    .map((chiave) => vocabolario?.metriche.find((metrica) => metrica.chiave === chiave))
    .filter((metrica): metrica is VoceMetrica => Boolean(metrica));
  const metricheConfrontoVisibili = (vocabolario?.tipologie.find(
    (voce) => voce.chiave === tipologiaConfronto
  )?.metriche ?? [])
    .map((chiave) => vocabolario?.metriche.find((metrica) => metrica.chiave === chiave))
    .filter((metrica): metrica is VoceMetrica => Boolean(metrica));
  const chiaviDimensioniAmmesse = spec
    ? vocabolario?.dimensioniPerMetrica[spec.metrica] ?? []
    : [];
  const dimensioniAmmesse = chiaviDimensioniAmmesse
    .map((chiave) => vocabolario?.dimensioni.find((dimensione) => dimensione.chiave === chiave))
    .filter((dimensione): dimensione is VoceDimensione => Boolean(dimensione));

  function aggiornaSpec(aggiornamento: (corrente: SpecQuery) => SpecQuery) {
    setSpec((corrente) => (corrente ? aggiornamento(corrente) : corrente));
    setSalvataggio("pronto");
    setMessaggioSalvataggio("");
  }

  function cambiaDimensione(dimensione: Dimensione, selezionata: boolean) {
    aggiornaSpec((corrente) => {
      const raggruppa = corrente.raggruppa ?? [];
      return {
        ...corrente,
        raggruppa: selezionata
          ? [...raggruppa, dimensione].slice(0, 2)
          : raggruppa.filter((voce) => voce !== dimensione),
      };
    });
  }

  function scegliTipologia(chiave: ChiaveTipologia) {
    const tipologia = vocabolario?.tipologie.find((voce) => voce.chiave === chiave);
    const metrica = tipologia?.metriche[0];
    if (!metrica) return;
    setTipologiaScelta(chiave);
    setSpec({ metrica, modificatore: "corrente" });
    setSerieAggiuntive([]);
    setGraficoScelto(undefined);
    titoloModificato.current = false;
    setSalvataggio("pronto");
    setMessaggioSalvataggio("");
  }

  function cambiaMetrica(metrica: ChiaveMetrica) {
    const ammesse = new Set(vocabolario?.dimensioniPerMetrica[metrica] ?? []);
    aggiornaSpec((corrente) => ({
      ...corrente,
      metrica,
      raggruppa: corrente.raggruppa?.filter((dimensione) => ammesse.has(dimensione)),
      filtri: corrente.filtri?.filter((filtro) => ammesse.has(filtro.campo)),
    }));
    setGraficoScelto(undefined);
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
    const nuovaSpec: SpecQuery = {
      ...spec,
      metrica: metricaConfronto,
      raggruppa: spec.raggruppa?.filter((dimensione) => ammesse.has(dimensione)),
      filtri: spec.filtri?.filter((filtro) => ammesse.has(filtro.campo)),
    };
    const nome = vocabolario?.metriche.find((voce) => voce.chiave === metricaConfronto)?.etichetta
      ?? metricaConfronto;
    setSerieAggiuntive((correnti) => [
      ...correnti,
      { ruolo: "confronto", nome, spec: nuovaSpec },
    ]);
    setAltraMetricaAperta(false);
    setGraficoScelto(undefined);
    setSalvataggio("pronto");
    setMessaggioSalvataggio("");
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
        : { anno: new Date().getFullYear() },
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
    const titoloPulito = titolo.trim();
    if (!titoloPulito) {
      setMessaggioSalvataggio("Il titolo è obbligatorio.");
      return;
    }
    if (!spec || salvataggio === "in_corso") return;

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
        <Scheletro altezza={520} />
      </main>
    );
  }

  const metricaScelta = spec
    ? vocabolario.metriche.find((voce) => voce.chiave === spec.metrica)
    : undefined;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6">
      <header className="mb-6 max-w-3xl">
        <Link href="/bi/analisi" className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Torna alle analisi
        </Link>
        <h1 className="font-tenorite text-3xl font-semibold">
          {aggiornaEsistente ? "Modifica il riquadro" : modificabile ? "Costruisci un riquadro" : "Crea una copia modificabile"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          {modificabile
            ? "Costruisci la stessa domanda certificata che usa l’Analista AI. Ogni scelta aggiorna subito il risultato e può essere riaperta, modificata o condivisa."
            : "Questo riquadro è condiviso o appartiene al Cruscotto: le tue modifiche finiranno in una copia tua, l’originale resta com’è."}
        </p>
      </header>

      <section aria-labelledby="titolo-tipologia" className="mb-6">
        <div className="mb-3">
          <h2 id="titolo-tipologia" className="font-tenorite text-xl font-semibold">
            Cosa vuoi analizzare?
          </h2>
          <p className="mt-1 text-sm text-text-muted">Scegli l’area con cui parlate dei dati in azienda.</p>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Che cosa vuoi misurare">
          {vocabolario.tipologie.map((tipologia) => {
            const selezionata = tipologia.chiave === tipologiaScelta;
            return (
              <button
                key={tipologia.chiave}
                type="button"
                aria-pressed={selezionata}
                onClick={() => scegliTipologia(tipologia.chiave)}
                className={`min-h-24 min-w-44 rounded-xl border p-4 text-left outline-none transition-colors focus:ring-2 focus:ring-primary ${
                  selezionata
                    ? "border-primary bg-bg-page text-primary"
                    : "border-border bg-bg-page hover:text-primary"
                }`}
              >
                <span className="font-tenorite text-lg font-semibold">{tipologia.etichetta}</span>
                <span className="mt-1 block text-xs leading-relaxed text-text-muted">
                  {tipologia.descrizione}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {!spec ? (
        <p className="rounded-xl border border-border bg-bg-page p-5 text-sm text-text-muted">
          Scegli una tipologia per vedere le metriche e i raggruppamenti disponibili.
        </p>
      ) : (
      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.5fr)] xl:items-start">
        <div className="space-y-4">
          <Scheda titolo="Metrica" sottotitolo={`Solo le misure di ${tipologiaAttiva?.etichetta ?? "questa tipologia"}`}>
            <label className="text-sm font-medium" htmlFor="editor-metrica">
              Metrica
            </label>
            <select
              id="editor-metrica"
              aria-label="Metrica"
              value={spec.metrica}
              onChange={(evento) => cambiaMetrica(evento.target.value as ChiaveMetrica)}
              className={`${CLASSE_CAMPO} mt-2`}
            >
              {metricheVisibili.map((metrica) => (
                <option key={metrica.chiave} value={metrica.chiave}>
                  {metrica.etichetta}
                </option>
              ))}
            </select>
            {metricaScelta && (
              <p className="mt-2 text-xs leading-relaxed text-text-muted">
                {metricaScelta.descrizione}
              </p>
            )}
          </Scheda>

          <Scheda titolo="Raggruppa per" sottotitolo="Fino a due dimensioni">
            <fieldset>
              <legend className="sr-only">Dimensioni</legend>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {dimensioniAmmesse.map((dimensione) => {
                  const selezionata = dimensioniScelte.includes(dimensione.chiave);
                  const disabilitata = limiteDimensioniRaggiunto && !selezionata;
                  return (
                    <label
                      key={dimensione.chiave}
                      className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-bg-page px-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
                    >
                      <input
                        type="checkbox"
                        checked={selezionata}
                        disabled={disabilitata}
                        onChange={(evento) =>
                          cambiaDimensione(dimensione.chiave, evento.target.checked)
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      {dimensione.etichetta}
                    </label>
                  );
                })}
              </div>
              <p className={`mt-2 text-xs ${limiteDimensioniRaggiunto ? "text-warning" : "text-text-muted"}`}>
                {limiteDimensioniRaggiunto
                  ? "Hai scelto due dimensioni: è il massimo rappresentabile in un grafico. Deselezionane una per cambiarla."
                  : "Puoi scegliere ancora fino a due dimensioni complessive."}
              </p>
            </fieldset>
          </Scheda>

          <Scheda titolo="Quando" sottotitolo="Segui la dashboard oppure mantieni un confronto fisso">
            <fieldset>
              <legend className="sr-only">Modalità del periodo</legend>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
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
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                  <label className="text-xs text-text-muted">
                    Anno
                    <input
                      aria-label="Anno"
                      type="number"
                      min={2000}
                      max={2100}
                      value={spec.periodo.anno ?? ""}
                      placeholder="Tutti"
                      onChange={(evento) => {
                        const anno = evento.target.value ? Number(evento.target.value) : undefined;
                        aggiornaSpec((corrente) => ({
                          ...corrente,
                          periodo: anno ? { anno } : { dal: corrente.periodo?.dal, al: corrente.periodo?.al },
                        }));
                      }}
                      className={`${CLASSE_CAMPO} mt-1`}
                    />
                  </label>
                  <label className="text-xs text-text-muted">
                    Dal
                    <input
                      aria-label="Dal"
                      type="date"
                      value={spec.periodo.dal ?? ""}
                      onChange={(evento) =>
                        aggiornaSpec((corrente) => ({
                          ...corrente,
                          periodo: { dal: evento.target.value || undefined, al: corrente.periodo?.al },
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
                          periodo: { dal: corrente.periodo?.dal, al: evento.target.value || undefined },
                        }))
                      }
                      className={`${CLASSE_CAMPO} mt-1`}
                    />
                  </label>
                </div>
              </div>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
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
                    <option key={modificatore.chiave} value={modificatore.chiave}>
                      {modificatore.descrizione}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Scheda>

          <Scheda
            titolo="Confronta con…"
            sottotitolo="Aggiungi una misura allo stesso riquadro"
          >
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
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
                onClick={() => aggiungiScorciatoia("progressivo", "Progressivo", "confronto")}
                className="min-h-10 rounded-lg border border-border bg-bg-page px-3 text-left text-sm font-medium text-text transition-colors hover:border-primary hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              >
                Progressivo
              </button>
              {motivoBudget && (
                <p className="text-xs leading-relaxed text-text-muted sm:col-span-2 xl:col-span-1 2xl:col-span-2">
                  {motivoBudget}
                </p>
              )}
              <button
                type="button"
                onClick={apriAltraMetrica}
                className="min-h-10 rounded-lg border border-primary bg-bg-page px-3 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary sm:col-span-2 xl:col-span-1 2xl:col-span-2"
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
                      { campo: dimensioniAmmesse[0]?.chiave ?? "bu", op: "eq", valore: "" },
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
                      value={filtro.campo}
                      onChange={(evento) =>
                        aggiornaFiltro(indice, {
                          ...filtro,
                          campo: evento.target.value as Dimensione,
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
                        const valore =
                          op === "in"
                            ? valoreFiltroPerCampo(filtro)
                                .split(",")
                                .map((voce) => voce.trim())
                                .filter(Boolean)
                            : valoreFiltroPerCampo(filtro);
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
                    <input
                      aria-label={`Valore filtro ${indice + 1}`}
                      value={valoreFiltroPerCampo(filtro)}
                      placeholder={filtro.op === "in" ? "Valori separati da virgola" : "Valore"}
                      onChange={(evento) =>
                        aggiornaFiltro(indice, {
                          ...filtro,
                          valore:
                            filtro.op === "in"
                              ? evento.target.value.split(",").map((voce) => voce.trim())
                              : evento.target.value,
                        })
                      }
                      className={CLASSE_CAMPO}
                    />
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

        <section className="min-w-0 xl:sticky xl:top-4">
          <Scheda
            titolo="Risultato in tempo reale"
            sottotitolo="La domanda viene rieseguita dopo ogni modifica"
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

            <div className="relative min-h-[340px]" aria-busy={caricamento}>
              {risultato && tipoGrafico && serieEseguite.length > 0 ? (
                <div className={caricamento ? "opacity-50" : undefined}>
                  <GraficoDaAnalisi serie={serieEseguite} tipo={tipoGrafico} altezza={340} />
                </div>
              ) : (
                <Scheletro altezza={340} />
              )}
              {caricamento && risultato && (
                <div className="pointer-events-none absolute inset-0 opacity-50">
                  <Scheletro altezza={340} />
                </div>
              )}
            </div>

            {!periodoPresente(spec.periodo) && (
              <p className="mt-3 text-xs leading-relaxed text-text-muted">
                Anteprima con il periodo ereditato: {descriviPeriodo(periodoEreditato)}. La spec salvata non fissa il periodo.
              </p>
            )}

            {risultato && proposta && tipoGrafico && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
                  <div>
                    <p className="text-xs font-medium">Grafico proposto: {NOMI_GRAFICI[proposta.tipo]}</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">{proposta.motivo}</p>
                  </div>
                  <label className="text-xs text-text-muted">
                    Visualizzazione
                    <select
                      aria-label="Visualizzazione"
                      value={tipoGrafico}
                      onChange={(evento) => {
                        setGraficoScelto(evento.target.value as TipoGrafico);
                        setSalvataggio("pronto");
                        setMessaggioSalvataggio("");
                      }}
                      className={`${CLASSE_CAMPO} mt-1`}
                    >
                      {grafici.map((tipo) => (
                        <option key={tipo} value={tipo}>
                          {NOMI_GRAFICI[tipo]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {risultato.avvisi.length > 0 && (
                  <div className="mt-4 space-y-2" aria-label="Avvisi del risultato">
                    {risultato.avvisi.map((avviso) => (
                      <p key={avviso} className="rounded-lg border border-border bg-bg-page p-3 text-xs leading-relaxed text-warning">
                        {avviso}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 border-t border-border pt-5">
              <label htmlFor="editor-titolo" className="text-sm font-medium">
                {dentroUnaPagina ? "Titolo del riquadro" : "Titolo del riquadro"}
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="editor-titolo"
                  aria-label="Titolo del riquadro"
                  required
                  value={titolo}
                  onChange={(evento) => {
                    titoloModificato.current = true;
                    setTitolo(evento.target.value);
                    setSalvataggio("pronto");
                    setMessaggioSalvataggio("");
                  }}
                  className={`${CLASSE_CAMPO} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => void salva()}
                  disabled={salvataggio === "in_corso" || salvataggio === "salvata"}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-bg-page px-4 text-sm font-medium text-primary focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
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
          </Scheda>
        </section>
      </div>
      )}
    </main>
  );
}
