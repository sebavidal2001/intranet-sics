"use client";

/**
 *
 * Il cruscotto. Rispetto al PBIX cambia soprattutto una cosa: qui si clicca.
 * Ogni barra, fetta, cella o riga aggiunge un filtro che si propaga a tutta
 * la pagina — il filtro incrociato che in Power BI si dà per scontato — e i
 * filtri attivi restano visibili come etichette rimovibili.
 *
 * Le sette viste rispondono a sette domande diverse:
 *   Sintesi      → dove siamo rispetto all'obiettivo
 *   Scostamenti  → da dove viene la differenza
 *   Clienti      → da chi dipendiamo e chi si sta muovendo
 *   Preventivi   → cosa c'è in canna
 *   Conversione  → che fine fanno i preventivi
 *   Back office  → quanto lavorano gli addetti e con che tempi
 *   Margine      → dove si guadagna, che non è dove si fattura
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Download,
  Filter,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  Pause,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { RaccordoCruscottoDashboard } from "./raccordo-cruscotto-dashboard";
import {
  GraficoBarre,
  GraficoCombo,
  GraficoLinee,
  GraficoTorta,
  KpiEroe,
  Scheda,
  useQueryBi,
  svuotaCacheQuery,
  euro,
} from "./primitivi";
import {
  BarreScostamento,
  Bullet,
  Heatmap,
  Multipli,
  Pareto,
  Quadranti,
  Waterfall,
} from "./grafici-avanzati";
import {
  TabellaAnalitica,
  colonneConfronto,
  costruisciConfronto,
  type ColonnaAnalitica,
  type RigaAnalitica,
} from "./tabella-analitica";
import { PannelloDettaglio, type RichiestaPannello } from "./dettaglio-documenti";
import { PannelloImpostazioni, useImpostazioni } from "./impostazioni";
import { VistaConversione } from "./vista-conversione";
import { VistaBackoffice } from "./vista-backoffice";
import { VistaAcquisti } from "./vista-acquisti";
import { useAutoAggiornamento } from "./auto-aggiornamento";
import type { Dimensione, RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

type Vista =
  | "sintesi"
  | "scostamenti"
  | "clienti"
  | "preventivi"
  | "conversione"
  | "backoffice"
  | "margine"
  | "acquisti";

const VISTE: { chiave: Vista; etichetta: string; nota: string }[] = [
  { chiave: "sintesi", etichetta: "Sintesi", nota: "dove siamo rispetto all'obiettivo" },
  { chiave: "scostamenti", etichetta: "Scostamenti", nota: "da dove viene la differenza" },
  { chiave: "clienti", etichetta: "Clienti", nota: "da chi dipendiamo, chi si muove" },
  { chiave: "margine", etichetta: "Margine", nota: "dove si guadagna, non dove si fattura" },
  { chiave: "preventivi", etichetta: "Preventivi", nota: "cosa c'è in canna" },
  { chiave: "conversione", etichetta: "Conversione", nota: "che fine fanno i preventivi" },
  { chiave: "backoffice", etichetta: "Back office", nota: "carico e tempi degli addetti" },
  { chiave: "acquisti", etichetta: "Acquisti", nota: "fornitori puntuali, carico dei buyer" },
];

/** Secondi per schermata nella modalità presentazione. */
const SECONDI_ROTAZIONE = 20;

/**
 * Giorno a cui fermare il confronto quando è attivo il periodo su periodo.
 *
 * Prende il giorno-mese dell'ultimo dato disponibile e lo applica all'anno
 * scelto: così il 2026 al 28 agosto si confronta con il 2025 al 28 agosto, e
 * non con il 2025 intero. Senza, ogni delta di un anno in corso è falso per
 * costruzione — mostra un calo che è solo il tempo che manca.
 */
function giornoLimite(anno: number, dataMassima: string | null): string {
  if (!dataMassima) return `${anno}-12-31`;
  return `${anno}-${dataMassima.slice(5, 10)}`;
}

const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

interface FiltroAttivo {
  campo: Dimensione;
  valore: string;
}

const NOMI_DIMENSIONE: Record<string, string> = {
  bu: "Business unit",
  agente: "Agente",
  cliente: "Cliente",
  categoria: "Categoria",
  causale: "Causale",
  articolo: "Articolo",
  creatore: "Addetto",
  esito: "Esito",
};

export function CruscottoView({
  anniDisponibili,
  dataMassima,
  runRicevutoIl,
  tassonomiaBu,
  puoForzareAggiornamento = false,
}: {
  anniDisponibili: number[];
  // `buDisponibili` e `agentiDisponibili` erano dichiarati qui e mai usati: la
  // pagina li calcolava sullo snapshot INTERO — non perimetrato — e Next li
  // serializzava comunque nel payload verso il browser. Nessuno li disegnava,
  // ma l'elenco completo di agenti e business unit arrivava lo stesso a
  // chiunque aprisse il cruscotto. Tolti da qui e dalla pagina.
  dataMassima: string | null;
  runRicevutoIl: string | null;
  /** Se chi guarda può forzare la rilettura dello snapshot (solo la direzione). */
  puoForzareAggiornamento?: boolean;
  /** Esito del controllo sulle business unit riconciliate. */
  tassonomiaBu?: { coerente: boolean; estranei: string[] } | null;
}) {
  const router = useRouter();
  const [vista, setVista] = useState<Vista>("sintesi");
  const [anno, setAnno] = useState<number>(anniDisponibili[0] ?? new Date().getFullYear());
  const [filtri, setFiltri] = useState<FiltroAttivo[]>([]);
  const [schermoIntero, setSchermoIntero] = useState(false);
  const [presentazione, setPresentazione] = useState(false);
  // Predefinito ACCESO: il confronto a periodo pieno è quello sbagliato, e
  // lasciarlo come impostazione iniziale significa mostrare per primo il
  // numero fuorviante.
  const [ytd, setYtd] = useState(true);
  const [esportando, setEsportando] = useState(false);
  const { imp, scuro, colore: coloreSerie } = useImpostazioni();

  // Modalità presentazione: schermo intero e rotazione automatica delle
  // schermate, per il monitor in sala riunioni.
  useEffect(() => {
    if (!presentazione) return;
    const id = window.setInterval(() => {
      setVista((v) => {
        const i = VISTE.findIndex((x) => x.chiave === v);
        return VISTE[(i + 1) % VISTE.length].chiave;
      });
    }, SECONDI_ROTAZIONE * 1000);
    return () => window.clearInterval(id);
  }, [presentazione]);

  // Esc esce dallo schermo intero: senza, in presentazione si resta bloccati.
  useEffect(() => {
    const onTasto = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPresentazione(false);
      setSchermoIntero(false);
    };
    window.addEventListener("keydown", onTasto);
    return () => window.removeEventListener("keydown", onTasto);
  }, []);

  /** Un click su un elemento aggiunge (o toglie) un filtro. */
  const alternaFiltro = useCallback((campo: Dimensione, valore: string) => {
    setFiltri((f) => {
      const esistente = f.find((x) => x.campo === campo);
      if (esistente?.valore === valore) return f.filter((x) => x.campo !== campo);
      return [...f.filter((x) => x.campo !== campo), { campo, valore }];
    });
  }, []);

  const filtroDi = (campo: Dimensione) => filtri.find((f) => f.campo === campo)?.valore ?? null;

  const filtriSpec = useMemo(
    () => filtri.map((f) => ({ campo: f.campo, op: "eq" as const, valore: f.valore })),
    [filtri]
  );

  const alGiorno = useMemo(
    () =>
      dataMassima && dataMassima.startsWith(String(anno)) ? dataMassima : `${anno}-12-31`,
    [anno, dataMassima]
  );
  const limiteYtd = useMemo(() => giornoLimite(anno, dataMassima), [anno, dataMassima]);

  // Quanto e' vecchio il caricamento che stiamo guardando.
  //
  // Serve perche' il 17/09/2026 questa pagina ha scritto per tre giorni «Dati
  // aggiornati al 11/09» in grigio piccolo, e nessuno l'ha letto come un
  // guasto. L'ingest da SRVWOA arriva ogni notte all'01:31: oltre le 36 ore
  // manca almeno un caricamento, e va detto a voce alta invece che lasciato
  // dedurre da una data.
  const oreDalCaricamento = useMemo(() => {
    if (!runRicevutoIl) return null;
    const t = Date.parse(runRicevutoIl);
    if (Number.isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 3_600_000);
  }, [runRicevutoIl]);
  const caricamentoVecchio = oreDalCaricamento !== null && oreDalCaricamento >= 36;

  const [forzando, setForzando] = useState(false);
  const [erroreAggiornamento, setErroreAggiornamento] = useState<string | null>(null);

  // Arrivato un caricamento nuovo sul server: la pagina si rilegge da sola,
  // restando sulla scheda aperta (anche in presentazione).
  useAutoAggiornamento(runRicevutoIl, () => {
    svuotaCacheQuery();
    router.refresh();
  });

  /**
   * Rilegge lo snapshot dalle viste `bi_*`.
   *
   * Svuota anche la cache del browser: senza, le risposte gia' ottenute
   * restano valide dieci minuti e la pagina continuerebbe a mostrare i numeri
   * vecchi subito dopo aver detto «aggiornato».
   */
  const forzaAggiornamento = useCallback(async () => {
    setForzando(true);
    setErroreAggiornamento(null);
    try {
      const r = await fetch("/api/bi/snapshot", { method: "POST" });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Aggiornamento non riuscito");
      svuotaCacheQuery();
      router.refresh();
    } catch (e) {
      setErroreAggiornamento(e instanceof Error ? e.message : "Aggiornamento non riuscito");
    } finally {
      setForzando(false);
    }
  }, [router]);

  // Con YTD acceso ogni metrica si ferma allo stesso giorno dell'anno; il
  // modificatore "anno_precedente" sposta indietro sia l'inizio sia la fine,
  // quindi il confronto resta a parità di periodo.
  const periodo = useMemo(
    () => (ytd ? { dal: `${anno}-01-01`, al: limiteYtd } : { anno }),
    [ytd, anno, limiteYtd]
  );
  const periodoProg = useMemo(() => ({ dal: `${anno}-01-01`, al: alGiorno }), [anno, alGiorno]);

  // ── Le spec: il cruscotto resta dichiarativo ──────────────────────────────
  const specs = useMemo<Record<string, SpecQuery | null>>(() => {
    const base = { filtri: filtriSpec, periodo };
    const comuni: Record<string, SpecQuery | null> = {
      ordinatoTot: { metrica: "ordinato", ...base },
      ordinatoAP: { metrica: "ordinato", modificatore: "anno_precedente", ...base },
      fatturatoTot: { metrica: "fatturato", ...base },
      fatturatoAP: { metrica: "fatturato", modificatore: "anno_precedente", ...base },
      nOrdini: { metrica: "n_ordini", ...base },
      ordineMedio: { metrica: "ordine_medio", ...base },
      // Budget "a oggi": confrontare il progressivo con il budget dell'anno
      // intero è l'errore che fa sembrare tutti sotto obiettivo a maggio.
      budgetAdOggi: { metrica: "budget", filtri: filtriSpec, periodo: periodoProg },
      bepAdOggi: { metrica: "bep", filtri: filtriSpec, periodo: periodoProg },
      budgetAnno: { metrica: "budget", filtri: filtriSpec, periodo },
      // Il portafoglio è una fotografia degli ordini ancora da consegnare:
      // non va tagliato al solo anno selezionato e non va sommato alle
      // consegne future, che sono la stessa origine ripartita per mese.
      portafoglioTot: { metrica: "portafoglio", filtri: filtriSpec },
    };

    // Conversione e back office interrogano autonomamente i propri grafici,
    // ma la fascia KPI generale resta visibile. Prima tornavamo `{}` qui:
    // l'effetto era una fila di zeri non calcolati su entrambe le pagine.
    if (vista === "conversione" || vista === "backoffice" || vista === "acquisti") return comuni;

    if (vista === "margine") {
      // Il margine vive solo sul fatturato: e' li' che esiste un costo da
      // sottrarre. Le righe senza costo restano fuori dal calcolo, ed e' per
      // questo che la copertura sta nella fascia dei KPI e non in una nota.
      return {
        ...comuni,
        margineTot: { metrica: "margine", ...base },
        margineAP: { metrica: "margine", modificatore: "anno_precedente", ...base },
        marginePct: { metrica: "margine_pct", ...base },
        marginePctAP: { metrica: "margine_pct", modificatore: "anno_precedente", ...base },
        coperturaPct: { metrica: "copertura_costi_pct", ...base },
        costoVendutoTot: { metrica: "costo_venduto", ...base },
        margineMese: { metrica: "margine", granularita: "mese", ...base, ordina: "etichetta" },
        margineMeseAP: {
          metrica: "margine",
          modificatore: "anno_precedente",
          granularita: "mese",
          ...base,
          ordina: "etichetta",
        },
        margineBu: { metrica: "margine", raggruppa: ["bu"], ...base, ordina: "valore_desc" },
        marginePctBu: { metrica: "margine_pct", raggruppa: ["bu"], ...base, ordina: "valore_desc" },
        marginePctCategoria: {
          metrica: "margine_pct",
          raggruppa: ["categoria"],
          ...base,
          ordina: "valore_desc",
        },
        // Crescente: qui interessa la coda, non la testa.
        marginePctClienti: {
          metrica: "margine_pct",
          raggruppa: ["cliente"],
          ...base,
          ordina: "valore_asc",
          limite: 15,
        },
        coperturaBu: {
          metrica: "copertura_costi_pct",
          raggruppa: ["bu"],
          ...base,
          ordina: "valore_desc",
        },
        marginePctAgente: {
          metrica: "margine_pct",
          raggruppa: ["agente"],
          ...base,
          ordina: "valore_desc",
        },
        // Le quattro grandezze per agente, per la tabella: la percentuale da
        // sola premia chi vende poco e bene, il valore da solo chi vende molto
        // e male. Vanno lette insieme.
        fatturatoAgente: { metrica: "fatturato", raggruppa: ["agente"], ...base },
        costoAgente: { metrica: "costo_venduto", raggruppa: ["agente"], ...base },
        margineAgente: { metrica: "margine", raggruppa: ["agente"], ...base },
        coperturaAgente: { metrica: "copertura_costi_pct", raggruppa: ["agente"], ...base },
        // Per CLIENTE, non per documento: il documento e' il livello a cui si
        // scende cliccando, non quello da cui si parte. Un elenco di cinquecento
        // fatture non si guarda; un elenco di clienti si', e da li' si entra.
        //
        // NESSUN `limite` e nessun `ordina` su queste cinque, ed e' la
        // correzione di un difetto vero: erano tutte `limite: 400` con
        // `ordina: "valore_desc"`, e ognuna ordinava per il PROPRIO valore.
        // Su 517 clienti — di cui 457 con copertura al 100% — le cinque liste
        // contenevano insiemi DIVERSI: un cliente grosso era fra i primi 400
        // per fatturato ma non fra i primi 400 per percentuale, e la tabella
        // gli mostrava margine in euro e un trattino al posto del margine %.
        // Numeri veri accanto a caselle vuote, senza che niente segnalasse
        // nulla.
        //
        // Quattro di queste servono solo da LOOKUP per chiave: tagliarle e
        // ordinarle non ha alcun senso, e l'unica cosa che poteva fare era
        // questa. L'ordinamento lo fa la tabella; il limite non serve, 517
        // righe si cercano e si paginano.
        fatturatoCli: { metrica: "fatturato", raggruppa: ["cliente"], ...base },
        costoCli: { metrica: "costo_venduto", raggruppa: ["cliente"], ...base },
        margineCli: { metrica: "margine", raggruppa: ["cliente"], ...base },
        marginePctCli: { metrica: "margine_pct", raggruppa: ["cliente"], ...base },
        coperturaCli: { metrica: "copertura_costi_pct", raggruppa: ["cliente"], ...base },
      };
    }

    if (vista === "sintesi") {
      return {
        ...comuni,
        ordinatoBu: { metrica: "ordinato", raggruppa: ["bu"], ...base, ordina: "valore_desc" },
        budgetBuAdOggi: {
          metrica: "budget",
          raggruppa: ["bu"],
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        bepBuAdOggi: { metrica: "bep", raggruppa: ["bu"], filtri: filtriSpec, periodo: periodoProg },
        ordinatoMese: { metrica: "ordinato", granularita: "mese", ...base, ordina: "etichetta" },
        budgetMese: { metrica: "budget", granularita: "mese", filtri: filtriSpec, periodo, ordina: "etichetta" },
        bepMese: { metrica: "bep", granularita: "mese", filtri: filtriSpec, periodo, ordina: "etichetta" },
        ordinatoProgSett: {
          metrica: "ordinato",
          modificatore: "progressivo",
          granularita: "settimana",
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        budgetProgSett: {
          metrica: "budget",
          modificatore: "progressivo",
          granularita: "settimana",
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        bepProgSett: {
          metrica: "bep",
          modificatore: "progressivo",
          granularita: "settimana",
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        ordinatoBuMese: {
          metrica: "ordinato",
          granularita: "mese",
          raggruppa: ["bu"],
          ...base,
          ordina: "etichetta",
        },
      };
    }

    if (vista === "scostamenti") {
      return {
        ...comuni,
        ordinatoBu: { metrica: "ordinato", raggruppa: ["bu"], ...base, ordina: "valore_desc" },
        ordinatoBuAP: {
          metrica: "ordinato",
          modificatore: "anno_precedente",
          raggruppa: ["bu"],
          ...base,
          ordina: "valore_desc",
        },
        ordinatoAgente: { metrica: "ordinato", raggruppa: ["agente"], ...base, ordina: "valore_desc" },
        ordinatoAgenteAP: {
          metrica: "ordinato",
          modificatore: "anno_precedente",
          raggruppa: ["agente"],
          ...base,
          ordina: "valore_desc",
        },
        budgetBuAdOggi: {
          metrica: "budget",
          raggruppa: ["bu"],
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        budgetAgenteAdOggi: {
          metrica: "budget",
          raggruppa: ["agente"],
          filtri: filtriSpec,
          periodo: periodoProg,
        },
        ordinatoBuMese: {
          metrica: "ordinato",
          granularita: "mese",
          raggruppa: ["bu"],
          ...base,
          ordina: "etichetta",
        },
        budgetBuMese: {
          metrica: "budget",
          granularita: "mese",
          raggruppa: ["bu"],
          filtri: filtriSpec,
          periodo,
          ordina: "etichetta",
        },
      };
    }

    if (vista === "clienti") {
      return {
        ...comuni,
        clienti: { metrica: "ordinato", raggruppa: ["cliente"], ...base, ordina: "valore_desc", limite: 200 },
        clientiAP: {
          metrica: "ordinato",
          modificatore: "anno_precedente",
          raggruppa: ["cliente"],
          ...base,
          ordina: "valore_desc",
          limite: 400,
        },
        clientiMese: {
          metrica: "ordinato",
          granularita: "mese",
          raggruppa: ["cliente"],
          ...base,
          ordina: "etichetta",
        },
        ordinatoAgente: { metrica: "ordinato", raggruppa: ["agente"], ...base, ordina: "valore_desc" },
        // La scheda disegna anche la torta per business unit: senza questa
        // riga il pannello restava a scheletro per sempre, e uno scheletro
        // dice «sto caricando», non «questo dato nessuno l'ha chiesto».
        ordinatoBu: { metrica: "ordinato", raggruppa: ["bu"], ...base, ordina: "valore_desc" },
      };
    }

    return {
      ...comuni,
      preventiviTot: { metrica: "preventivi_aperti", filtri: filtriSpec },
      nPreventivi: { metrica: "n_preventivi", filtri: filtriSpec },
      preventiviBu: { metrica: "preventivi_aperti", raggruppa: ["bu"], filtri: filtriSpec, ordina: "valore_desc" },
      preventiviAgente: {
        metrica: "preventivi_aperti",
        raggruppa: ["agente"],
        filtri: filtriSpec,
        ordina: "valore_desc",
      },
      preventiviCausale: {
        metrica: "preventivi_aperti",
        raggruppa: ["causale"],
        filtri: filtriSpec,
        ordina: "valore_desc",
      },
      preventiviCliente: {
        metrica: "preventivi_aperti",
        raggruppa: ["cliente"],
        filtri: filtriSpec,
        ordina: "valore_desc",
        limite: 200,
      },
      preventiviCausaleMese: {
        metrica: "preventivi_aperti",
        granularita: "mese",
        raggruppa: ["causale"],
        filtri: filtriSpec,
        ordina: "etichetta",
      },
      portafoglioMese: {
        metrica: "consegnato_futuro",
        granularita: "mese",
        filtri: filtriSpec,
        ordina: "etichetta",
      },
    };
  }, [vista, filtriSpec, periodo, periodoProg]);

  const { risultati, caricamento, errori, ricarica } = useQueryBi(specs);
  /**
   * Legge un risultato del batch.
   *
   * Con il guardiano acceso: chiedere una chiave che questa vista **non ha
   * richiesto** non e' un dato mancante, e' un errore di programmazione. Senza
   * segnalarlo il pannello resta a scheletro per sempre, e uno scheletro dice
   * «sto caricando», non «questo dato nessuno l'ha chiesto» — che e' esattamente
   * come la torta per business unit e' rimasta vuota nella scheda Clienti senza
   * che nessuno se ne accorgesse.
   *
   * Solo in sviluppo: in produzione un pannello vuoto e' meglio di una pagina
   * che non si apre.
   */
  /**
   * Lettura permissiva, per i calcoli derivati.
   *
   * I derivati (waterfall, tabelle di confronto, multipli) sono `useMemo` che
   * girano a ogni render qualunque sia la scheda aperta, e leggono chiavi che
   * solo *alcune* schede richiedono. Li' l'assenza e' normale e il risultato
   * viene semplicemente vuoto: segnalarla renderebbe il guardiano rumoroso
   * fino a farlo ignorare.
   */
  /** Documento aperto in dettaglio: dalla riga di un cliente alle sue fatture. */
  const [dettaglio, setDettaglio] = useState<RichiestaPannello | null>(null);

  const rSeCe = (k: string) => risultati[k];

  const r = (k: string) => {
    if (process.env.NODE_ENV !== "production" && !(k in specs)) {
      console.error(
        `[cruscotto] la vista "${vista}" disegna "${k}" ma non lo chiede: ` +
          "aggiungilo al blocco delle richieste, altrimenti resta a scheletro per sempre."
      );
    }
    return risultati[k];
  };
  const tot = (k: string) => risultati[k]?.totale ?? 0;

  /**
   * Righe di una tabella del margine: cinque misure affiancate sulla stessa
   * chiave — business unit, agente o documento che sia.
   *
   * Servono tutte e cinque insieme. La percentuale da sola premia chi vende
   * poco e bene; il valore da solo premia chi vende molto e male; e senza la
   * copertura non si distingue un margine basso da un margine calcolato su
   * mezza riga. L'ordine delle colonne è quello in cui si leggono.
   */
  const righeTabellaMargine = (chiavi: {
    fatturato: string;
    costo: string;
    margine: string;
    pct: string;
    copertura: string;
  }): RigaAnalitica[] => {
    const mappa = (k: string) =>
      new Map((rSeCe(k)?.righe ?? []).map((x) => [x.etichetta, x.valore]));
    const costo = mappa(chiavi.costo);
    const margine = mappa(chiavi.margine);
    const pct = mappa(chiavi.pct);
    const copertura = mappa(chiavi.copertura);

    // Si parte dal fatturato: è la misura che esiste su ogni riga, anche dove
    // il costo manca. Partire dal margine nasconderebbe proprio le voci di cui
    // non si conosce il costo, che sono quelle da guardare.
    const principale = rSeCe(chiavi.fatturato)?.righe ?? [];

    // Le quattro liste di lookup devono coprire le stesse chiavi della
    // principale. Se una le taglia — un `limite` con un `ordina` diverso è
    // bastato — la tabella mostra numeri veri accanto a caselle vuote, e
    // sembra un dato mancante invece di un difetto.
    if (process.env.NODE_ENV !== "production" && principale.length > 0) {
      for (const [ruolo, chiave] of Object.entries(chiavi)) {
        if (ruolo === "fatturato") continue;
        const righe = rSeCe(chiave)?.righe;
        if (!righe) continue;
        const presenti = new Set(righe.map((x) => x.etichetta));
        const mancanti = principale.filter((x) => !presenti.has(x.etichetta)).length;
        if (mancanti > 0) {
          console.error(
            `[cruscotto] "${chiave}" copre ${righe.length} voci ma alla tabella ne mancano ` +
              `${mancanti}: togli il limite e l'ordinamento dalle spec di lookup, ` +
              "servono solo a cercare per chiave."
          );
        }
      }
    }

    return principale.map((riga) => ({
      chiave: riga.etichetta,
      celle: {
        voce: riga.etichetta,
        fatturato: riga.valore,
        costo: costo.get(riga.etichetta) ?? null,
        margine: margine.get(riga.etichetta) ?? null,
        pct: pct.get(riga.etichetta) ?? null,
        copertura: copertura.get(riga.etichetta) ?? null,
      },
    }));
  };

  /** Colonne delle tabelle del margine: unità dichiarate una per una. */
  const COLONNE_MARGINE: ColonnaAnalitica[] = [
    { chiave: "fatturato", etichetta: "Fatturato", tipo: "euro", unita: "euro" },
    { chiave: "costo", etichetta: "Costo del venduto", tipo: "euro", unita: "euro" },
    { chiave: "margine", etichetta: "Margine", tipo: "euro", unita: "euro" },
    {
      chiave: "pct",
      etichetta: "Margine %",
      tipo: "numero",
      unita: "percentuale",
      decimali: 1,
      altoBuono: true,
      totale: { tipo: "nessuno" },
      titolo: "Calcolato sulle sole righe di cui si conosce il costo",
    },
    {
      chiave: "copertura",
      etichetta: "Copertura %",
      tipo: "numero",
      unita: "percentuale",
      decimali: 1,
      altoBuono: true,
      totale: { tipo: "nessuno" },
      titolo: "Quota del fatturato con un costo noto: sotto il 100% il margine accanto è parziale",
    },
  ];

  // ── Derivati per i grafici analitici ──────────────────────────────────────

  /** Voci del waterfall: contributo di ogni chiave alla variazione. */
  const vociWaterfall = useCallback(
    (corrente?: RisultatoQuery, precedente?: RisultatoQuery) => {
      if (!corrente) return [];
      const ap = new Map(precedente?.righe.map((x) => [x.etichetta, x.valore]) ?? []);
      const chiavi = new Set([
        ...corrente.righe.map((x) => x.etichetta),
        ...(precedente?.righe.map((x) => x.etichetta) ?? []),
      ]);
      return [...chiavi]
        .map((k) => ({
          etichetta: k,
          delta:
            (corrente.righe.find((x) => x.etichetta === k)?.valore ?? 0) - (ap.get(k) ?? 0),
        }))
        .filter((v) => Math.abs(v.delta) > 1);
    },
    []
  );

  /** Righe bullet: consuntivo contro budget e BEP, a pari periodo. */
  const righeBullet = useMemo(() => {
    const ord = r("ordinatoBu");
    const bdg = r("budgetBuAdOggi");
    const bep = r("bepBuAdOggi");
    if (!ord || !bdg) return [];
    const mb = new Map(bdg.righe.map((x) => [x.etichetta, x.valore]));
    const mbep = new Map(bep?.righe.map((x) => [x.etichetta, x.valore]) ?? []);
    return ord.righe
      .filter((x) => (mb.get(x.etichetta) ?? 0) > 0)
      .map((x) => ({
        etichetta: x.etichetta,
        valore: x.valore,
        obiettivo: mb.get(x.etichetta) ?? 0,
        soglia: mbep.get(x.etichetta) ?? null,
      }));
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Heatmap business unit × mese, colorata sullo scostamento dal budget. */
  const heatmapScostamenti = useMemo(() => {
    const ord = r("ordinatoBuMese");
    const bdg = rSeCe("budgetBuMese");
    if (!ord) return null;

    const bu = [...new Set(ord.righe.map((x) => x.chiavi.bu).filter(Boolean))] as string[];
    const mesiPresenti = [...new Set(ord.righe.map((x) => x.chiavi.periodo).filter(Boolean))].sort() as string[];
    if (bu.length === 0 || mesiPresenti.length === 0) return null;

    const mappaB = new Map(
      (bdg?.righe ?? []).map((x) => [`${x.chiavi.bu}|${x.chiavi.periodo}`, x.valore])
    );

    const valori: Record<string, Record<string, number>> = {};
    for (const b of bu) {
      valori[b] = {};
      for (const m of mesiPresenti) {
        const riga = ord.righe.find((x) => x.chiavi.bu === b && x.chiavi.periodo === m);
        const effettivo = riga?.valore ?? 0;
        const budget = mappaB.get(`${b}|${m}`) ?? 0;
        // Senza budget si mostra lo scostamento assoluto in euro; con budget,
        // la percentuale, che è il modo in cui la direzione lo legge.
        valori[b][MESI_BREVI[Number(m.slice(5, 7)) - 1] ?? m] =
          budget > 0 ? ((effettivo - budget) / budget) * 100 : 0;
      }
    }

    return {
      righe: bu,
      colonne: mesiPresenti.map((m) => MESI_BREVI[Number(m.slice(5, 7)) - 1] ?? m),
      valori,
      conBudget: Boolean(bdg && bdg.righe.length > 0),
    };
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Punti dei quadranti: valore anno precedente contro crescita. */
  const puntiQuadranti = useMemo(() => {
    const cur = rSeCe("clienti");
    const ap = rSeCe("clientiAP");
    if (!cur || !ap) return [];
    const mappaAP = new Map(ap.righe.map((x) => [x.etichetta, x.valore]));
    return cur.righe
      .map((x) => {
        const precedente = mappaAP.get(x.etichetta) ?? 0;
        if (precedente < 5000) return null; // troppo piccoli: sono rumore
        return {
          nome: x.etichetta,
          x: precedente,
          y: ((x.valore - precedente) / precedente) * 100,
          dimensione: x.valore,
        };
      })
      .filter(Boolean)
      .slice(0, 120) as { nome: string; x: number; y: number; dimensione: number }[];
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Piccoli multipli per business unit. */
  const multipliBu = useMemo(() => {
    const serie = r("ordinatoBuMese");
    const cur = r("ordinatoBu");
    if (!serie || !cur) return [];
    const bu = [...new Set(serie.righe.map((x) => x.chiavi.bu).filter(Boolean))] as string[];
    return bu.map((b) => {
      const valori = serie.righe
        .filter((x) => x.chiavi.bu === b)
        .map((x) => ({ periodo: x.chiavi.periodo ?? "", valore: x.valore }))
        .sort((a, z) => a.periodo.localeCompare(z.periodo));
      return {
        nome: b,
        valori,
        totale: cur.righe.find((x) => x.etichetta === b)?.valore ?? 0,
        variazionePct: null,
      };
    });
  }, [risultati]); // eslint-disable-line react-hooks/exhaustive-deps

  function tabellaDi(
    chiaveCorrente: string,
    chiaveAP: string,
    chiaveBudget: string | null,
    chiaveSerie: string | null,
    dimensione: string
  ) {
    return costruisciConfronto({
      corrente: r(chiaveCorrente),
      precedente: r(chiaveAP),
      budget: chiaveBudget ? r(chiaveBudget) : undefined,
      serie: chiaveSerie ? r(chiaveSerie) : undefined,
      dimensione,
    });
  }

  async function esporta() {
    setEsportando(true);
    try {
      const blocchi = Object.entries(specs)
        .filter(([, s]) => s !== null)
        .slice(0, 12)
        .map(([id, s]) => ({ titolo: id, spec: s }));
      const res = await fetch("/api/bi/esporta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "query-excel", blocchi }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Errore");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BI_Cruscotto_${vista}_${anno}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setEsportando(false);
    }
  }

  const budgetMancante = (r("budgetAdOggi")?.avvisi ?? []).some((a) => a.includes("non disponibili"));

  return (
    <div
      className={[
        schermoIntero ? "fixed inset-0 z-40 overflow-auto" : "",
        scuro ? "proto-bi-scuro bg-slate-950 text-slate-100" : schermoIntero ? "bg-bg-page" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Il tema scuro ridefinisce i token del design system solo dentro il
          cruscotto: il resto dell'intranet resta chiaro. */}
      {scuro && (
        <style>{`
          .proto-bi-scuro {
            --color-bg: #0f172a;
            --color-bg-page: #1e293b;
            --color-border: #334155;
            --color-text: #f1f5f9;
            --color-text-muted: #94a3b8;
          }
        `}</style>
      )}
      <div
        className={`max-w-[1600px] mx-auto px-4 ${
          imp.densita === "compatta" ? "py-3" : "py-6"
        }`}
      >
        <RaccordoCruscottoDashboard />
        {presentazione && (
          <div className="mb-3 flex items-center gap-2 text-xs text-primary">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            Presentazione attiva — la schermata cambia ogni {SECONDI_ROTAZIONE} secondi. Esc per
            uscire.
          </div>
        )}
        {/* ── Barra comandi ──────────────────────────────────────────────── */}
        <div className="flex items-end gap-3 flex-wrap mb-3">
          <div className="flex gap-1 p-1 rounded-lg bg-bg-page">
            {VISTE.map((v) => (
              <button
                key={v.chiave}
                onClick={() => setVista(v.chiave)}
                title={v.nota}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  vista === v.chiave
                    ? "bg-bg shadow-sm font-semibold text-primary"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {v.etichetta}
              </button>
            ))}
          </div>

          <label className="text-xs text-text-muted">
            <span className="block mb-1">Anno</span>
            <select
              value={anno}
              onChange={(e) => setAnno(Number(e.target.value))}
              className="px-2 py-1.5 text-sm rounded-lg border border-border bg-bg"
            >
              {anniDisponibili.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-text-muted">
            <span className="block mb-1">Confronto</span>
            <button
              onClick={() => setYtd((v) => !v)}
              title={
                ytd
                  ? `Periodo su periodo: entrambi gli anni fermati al ${limiteYtd.slice(8, 10)}/${limiteYtd.slice(5, 7)}`
                  : "Anno intero contro anno intero: su un anno in corso il confronto è falsato"
              }
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                ytd
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-warning/50 bg-warning/10 text-warning"
              }`}
            >
              {ytd
                ? `Periodo su periodo (al ${limiteYtd.slice(8, 10)}/${limiteYtd.slice(5, 7)})`
                : "Anno intero"}
            </button>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={ricarica}
              className="p-2 rounded-lg border border-border hover:bg-bg-page"
              aria-label="Ricarica"
            >
              {caricamento ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="w-4 h-4" aria-hidden />
              )}
            </button>
            <button
              onClick={() => void esporta()}
              disabled={esportando}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border hover:bg-bg-page disabled:opacity-50"
            >
              {esportando ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              ) : (
                <Download className="w-4 h-4" aria-hidden />
              )}
              Excel
            </button>
            <PannelloImpostazioni />
            <button
              onClick={() => {
                const attiva = !presentazione;
                setPresentazione(attiva);
                if (attiva) setSchermoIntero(true);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-sm rounded-lg border transition-colors ${
                presentazione
                  ? "border-primary bg-primary text-white"
                  : "border-border hover:bg-bg-page"
              }`}
              title={`Presentazione: cambia schermata ogni ${SECONDI_ROTAZIONE} secondi`}
            >
              {presentazione ? (
                <Pause className="w-4 h-4" aria-hidden />
              ) : (
                <Play className="w-4 h-4" aria-hidden />
              )}
            </button>
            <button
              onClick={() => setSchermoIntero((v) => !v)}
              className="p-2 rounded-lg border border-border hover:bg-bg-page"
              aria-label={schermoIntero ? "Esci da schermo intero" : "Schermo intero"}
            >
              {schermoIntero ? (
                <Minimize2 className="w-4 h-4" aria-hidden />
              ) : (
                <Maximize2 className="w-4 h-4" aria-hidden />
              )}
            </button>
          </div>
        </div>

        {/* ── Filtri incrociati attivi ───────────────────────────────────── */}
        {/* Nella scheda Acquisti filtri e KPI delle vendite non valgono: buyer e
            fornitori non sono agenti e clienti. Si nascondono invece di mentire. */}
        <div className={`flex items-center gap-2 flex-wrap mb-4 min-h-[30px] ${vista === "acquisti" ? "hidden" : ""}`}>
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <Filter className="w-3.5 h-3.5" aria-hidden />
            {filtri.length === 0
              ? "Clicca su un elemento di un grafico o di una tabella per filtrare tutto"
              : "Filtri attivi:"}
          </span>
          {filtri.map((f) => (
            <motion.button
              key={`${f.campo}-${f.valore}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => setFiltri((x) => x.filter((y) => y.campo !== f.campo))}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-primary/10 text-primary border border-primary/25 hover:bg-primary/20 transition-colors"
            >
              <span className="opacity-70">{NOMI_DIMENSIONE[f.campo] ?? f.campo}:</span>
              <strong className="max-w-[180px] truncate">{f.valore}</strong>
              <X className="w-3 h-3" aria-hidden />
            </motion.button>
          ))}
          {filtri.length > 1 && (
            <button
              onClick={() => setFiltri([])}
              className="text-xs text-text-muted hover:text-danger underline"
            >
              azzera tutti
            </button>
          )}
        </div>

        {errori._generale && (
          <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
            {errori._generale}
          </div>
        )}
        {tassonomiaBu && !tassonomiaBu.coerente && (
          <div className="mb-4 p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm">
            <strong>Business unit non riconosciute:</strong>{" "}
            {tassonomiaBu.estranei.join(", ")}. Il gestionale ha introdotto un gruppo o una
            categoria che la regola di riconciliazione non copre: le ripartizioni per business
            unit vanno lette con cautela finché la regola non viene aggiornata.
          </div>
        )}
        {budgetMancante && (
          <div className="mb-4 p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm">
            Budget e BEP non disponibili per il {anno}:{" "}
            <a href="/bi/configurazione" className="text-primary underline">
              importa il file Excel
            </a>{" "}
            per vedere scostamenti e raggiungimento.
          </div>
        )}

        {/* ── Fascia KPI ─────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={`rounded-2xl bg-slate-900 text-white p-5 lg:p-6 mb-5 grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-6 ${
            vista === "acquisti" ? "hidden" : ""
          }`}
        >
          <KpiEroe
            scuro
            etichetta={ytd ? `Ordinato ${anno} a oggi` : `Ordinato ${anno}`}
            valore={r("ordinatoTot") ? tot("ordinatoTot") : null}
            confronto={r("ordinatoAP") ? { valore: tot("ordinatoAP"), etichetta: `vs ${anno - 1}` } : null}
          />
          <KpiEroe
            scuro
            etichetta="Budget a oggi"
            valore={r("budgetAdOggi") ? tot("budgetAdOggi") : null}
            confronto={
              tot("budgetAdOggi") > 0
                ? { valore: tot("budgetAdOggi"), etichetta: "" }
                : null
            }
            nota={
              !r("budgetAdOggi")
                ? "calcolo in corso"
                : tot("budgetAdOggi") > 0
                ? `Raggiungimento ${((tot("ordinatoTot") / tot("budgetAdOggi")) * 100).toFixed(0)}% · anno ${euro(tot("budgetAnno"))}`
                : "non configurato"
            }
          />
          <KpiEroe
            scuro
            etichetta={ytd ? `Fatturato ${anno} a oggi` : `Fatturato ${anno}`}
            valore={r("fatturatoTot") ? tot("fatturatoTot") : null}
            confronto={r("fatturatoAP") ? { valore: tot("fatturatoAP"), etichetta: `vs ${anno - 1}` } : null}
          />
          <KpiEroe
            scuro
            etichetta="Portafoglio da consegnare"
            valore={r("portafoglioTot") ? tot("portafoglioTot") : null}
            nota="ordini acquisiti ancora da evadere"
          />
          <KpiEroe
            scuro
            etichetta="Ordini"
            valore={r("nOrdini") ? tot("nOrdini") : null}
            unita="numero"
            nota={r("ordineMedio") ? `Ordine medio ${euro(tot("ordineMedio"))}` : "calcolo in corso"}
          />
          <KpiEroe
            scuro
            etichetta="BEP a oggi"
            valore={r("bepAdOggi") ? tot("bepAdOggi") : null}
            nota={
              !r("bepAdOggi")
                ? "calcolo in corso"
                : tot("bepAdOggi") > 0
                ? tot("ordinatoTot") >= tot("bepAdOggi")
                  ? "sopra il pareggio"
                  : "sotto il pareggio"
                : "non configurato"
            }
          />
        </motion.div>

        {caricamentoVecchio && (
          <p className="text-xs text-warning mb-2 flex items-start gap-1.5">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
            <span>
              L&apos;ultimo caricamento risale a <strong>{oreDalCaricamento} ore fa</strong>. Il
              gestionale consegna i dati ogni notte: se questo numero continua a crescere, quello
              che stai leggendo non e&apos; la situazione di oggi.{" "}
              {/* Il rimedio sta dentro l'avviso, non in un'icona altrove. Il tasto
                  «Ricarica» qui sopra svuota solo la cache del browser: premuto sui
                  dati fermi ridava gli stessi dati fermi, ed e' il motivo per cui
                  nessuno riusciva a sbloccarli. Questo rilegge davvero dalle viste. */}
              {puoForzareAggiornamento ? (
                <button
                  onClick={() => void forzaAggiornamento()}
                  disabled={forzando}
                  className="underline font-medium hover:no-underline disabled:opacity-50"
                >
                  {forzando ? "Rilettura in corso…" : "Rileggi i dati dal gestionale"}
                </button>
              ) : (
                <span className="opacity-80">
                  La rilettura immediata è riservata alla direzione.
                </span>
              )}
              {erroreAggiornamento && (
                <span className="block mt-1 text-danger">{erroreAggiornamento}</span>
              )}
            </span>
          </p>
        )}

        <p className="text-xs text-text-muted mb-4">
          Dati aggiornati al <strong>{dataMassima ?? "n/d"}</strong>
          {runRicevutoIl && <> · caricamento del {new Date(runRicevutoIl).toLocaleString("it-IT")}</>}
          {" · "}budget confrontato a pari periodo.{" "}
          {ytd ? (
            <>
              Confronto anno su anno fermato al{" "}
              <strong>
                {limiteYtd.slice(8, 10)}/{limiteYtd.slice(5, 7)}
              </strong>{" "}
              per entrambi gli anni.
            </>
          ) : (
            <span className="text-warning">
              Confronto su anno intero: se il {anno} è in corso, il delta contro il {anno - 1}{" "}
              è falsato dai mesi che mancano.
            </span>
          )}
        </p>

        {/* ── SINTESI ────────────────────────────────────────────────────── */}
        {vista === "sintesi" && (
          <div className={`grid grid-cols-1 lg:grid-cols-3 ${imp.densita === "compatta" ? "gap-2" : "gap-4"}`}>
            <Scheda
              titolo="Raggiungimento per business unit"
              sottotitolo="consuntivo contro budget e BEP, allo stesso giorno dell'anno"
            >
              <Bullet righe={righeBullet} onClick={(b) => alternaFiltro("bu", b)} />
            </Scheda>

            <Scheda
              titolo="Ordinato, budget e BEP per mese"
              className="lg:col-span-2"
              sottotitolo="il budget segue i giorni lavorativi: agosto è più basso perché è chiuso"
            >
              <GraficoCombo
                barre={{ nome: "Ordinato", risultato: r("ordinatoMese") }}
                linee={[
                  { nome: "Budget", risultato: r("budgetMese"), colore: "#f59e0b" },
                  { nome: "BEP", risultato: r("bepMese"), colore: "#ef4444", tratteggiata: true },
                ]}
              />
            </Scheda>

            <Scheda titolo="Visione progressiva annua" className="lg:col-span-2">
              <GraficoLinee
                serie={[
                  { nome: "Ordinato", risultato: r("ordinatoProgSett"), colore: "#00a1be" },
                  { nome: "Budget", risultato: r("budgetProgSett"), colore: "#f59e0b", tratteggiata: true },
                  { nome: "BEP", risultato: r("bepProgSett"), colore: "#ef4444", tratteggiata: true },
                ]}
                altezza={300}
              />
            </Scheda>

            <Scheda titolo="Quota per business unit">
              <GraficoTorta
                risultato={r("ordinatoBu")}
                onClick={(b: string) => alternaFiltro("bu", b)}
                selezionata={filtroDi("bu")}
              />
            </Scheda>

            <Scheda
              titolo="Andamento per business unit"
              className="lg:col-span-3"
              sottotitolo="stessa scala per tutti, altrimenti il confronto visivo mente"
            >
              <Multipli serie={multipliBu} onClick={(b) => alternaFiltro("bu", b)} />
            </Scheda>
          </div>
        )}

        {/* ── SCOSTAMENTI ────────────────────────────────────────────────── */}
        {vista === "scostamenti" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Scheda
              titolo={`Da dove viene la variazione ${anno - 1} → ${anno}`}
              sottotitolo="contributo di ogni business unit"
            >
              <Waterfall
                partenza={tot("ordinatoAP")}
                arrivo={tot("ordinatoTot")}
                voci={vociWaterfall(r("ordinatoBu"), r("ordinatoBuAP"))}
                etichettaPartenza={String(anno - 1)}
                etichettaArrivo={String(anno)}
                onClickVoce={(b) => alternaFiltro("bu", b)}
              />
            </Scheda>

            <Scheda
              titolo={`Contributo per agente ${anno - 1} → ${anno}`}
              sottotitolo="stessa variazione, letta per commerciale"
            >
              <Waterfall
                partenza={tot("ordinatoAP")}
                arrivo={tot("ordinatoTot")}
                voci={vociWaterfall(r("ordinatoAgente"), r("ordinatoAgenteAP"))}
                etichettaPartenza={String(anno - 1)}
                etichettaArrivo={String(anno)}
                onClickVoce={(a) => alternaFiltro("agente", a)}
              />
            </Scheda>

            <Scheda titolo="Scostamento dal budget per business unit" sottotitolo="a pari periodo">
              <BarreScostamento
                dati={(r("ordinatoBu")?.righe ?? []).map((x) => {
                  const b =
                    r("budgetBuAdOggi")?.righe.find((y) => y.etichetta === x.etichetta)?.valore ?? 0;
                  return { etichetta: x.etichetta, valore: x.valore - b };
                })}
                onClick={(b) => alternaFiltro("bu", b)}
              />
            </Scheda>

            <Scheda titolo="Scostamento dal budget per agente" sottotitolo="a pari periodo">
              <BarreScostamento
                dati={(r("ordinatoAgente")?.righe ?? []).map((x) => {
                  const b =
                    r("budgetAgenteAdOggi")?.righe.find((y) => y.etichetta === x.etichetta)
                      ?.valore ?? 0;
                  return { etichetta: x.etichetta, valore: x.valore - b };
                })}
                onClick={(a) => alternaFiltro("agente", a)}
              />
            </Scheda>

            {heatmapScostamenti && (
              <Scheda
                titolo="Dove e quando"
                className="lg:col-span-2"
                sottotitolo={
                  heatmapScostamenti.conBudget
                    ? "scostamento % dal budget, business unit per mese — verde sopra, rosso sotto"
                    : "budget non disponibile: importa il file per vedere gli scostamenti"
                }
              >
                <Heatmap
                  righe={heatmapScostamenti.righe}
                  colonne={heatmapScostamenti.colonne}
                  valori={heatmapScostamenti.valori}
                  formato="percentuale"
                  divergente
                  onClick={(bu) => alternaFiltro("bu", bu)}
                />
              </Scheda>
            )}

            <Scheda titolo="Business unit — quadro completo" className="lg:col-span-2">
              <TabellaAnalitica
                colonnaDimensione="Business unit"
                colonne={colonneConfronto({ annoCorrente: anno, conBudget: true })}
                righe={tabellaDi("ordinatoBu", "ordinatoBuAP", "budgetBuAdOggi", null, "bu").righe}
                onClickRiga={(b) => alternaFiltro("bu", b)}
                rigaEvidenziata={filtroDi("bu")}
              />
            </Scheda>

            <Scheda titolo="Agenti — quadro completo" className="lg:col-span-2">
              <TabellaAnalitica
                colonnaDimensione="Agente"
                colonne={colonneConfronto({ annoCorrente: anno, conBudget: true })}
                righe={
                  tabellaDi("ordinatoAgente", "ordinatoAgenteAP", "budgetAgenteAdOggi", null, "agente")
                    .righe
                }
                onClickRiga={(a) => alternaFiltro("agente", a)}
                rigaEvidenziata={filtroDi("agente")}
              />
            </Scheda>
          </div>
        )}

        {/* ── CLIENTI ────────────────────────────────────────────────────── */}
        {vista === "clienti" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Scheda
              titolo="Concentrazione del fatturato"
              sottotitolo="barre = valore, linea = cumulata sul totale"
            >
              <Pareto
                dati={(r("clienti")?.righe ?? []).map((x) => ({
                  etichetta: x.etichetta,
                  valore: x.valore,
                }))}
                onClick={(c) => alternaFiltro("cliente", c)}
              />
            </Scheda>

            <Scheda
              titolo="Chi si sta muovendo"
              sottotitolo="dimensione = ordinato dell'anno · solo clienti sopra 5.000 € l'anno prima"
            >
              <Quadranti
                punti={puntiQuadranti}
                etichettaX={`Ordinato ${anno - 1}`}
                etichettaY="Variazione %"
                onClick={(c) => alternaFiltro("cliente", c)}
              />
            </Scheda>

            <Scheda titolo="Ordinato per agente">
              <BarreScostamento
                dati={(r("ordinatoAgente")?.righe ?? []).map((x) => ({
                  etichetta: x.etichetta,
                  valore: x.valore,
                }))}
                onClick={(a) => alternaFiltro("agente", a)}
              />
            </Scheda>

            <Scheda titolo="Quota per business unit">
              <GraficoTorta
                risultato={r("ordinatoBu")}
                onClick={(b: string) => alternaFiltro("bu", b)}
                selezionata={filtroDi("bu")}
              />
            </Scheda>

            <Scheda
              titolo="Clienti — quadro completo"
              className="lg:col-span-2"
              sottotitolo="ordinabile per qualsiasi colonna; l’andamento è la tendenza dei mesi, verde se sale — il mese in corso, ancora incompleto, non conta"
            >
              <TabellaAnalitica
                colonnaDimensione="Cliente"
                colonne={colonneConfronto({ annoCorrente: anno, conSparkline: true })}
                righe={tabellaDi("clienti", "clientiAP", null, "clientiMese", "cliente").righe}
                massimoIniziale={15}
                ultimoPeriodoParziale
                onClickRiga={(c) => alternaFiltro("cliente", c)}
                rigaEvidenziata={filtroDi("cliente")}
              />
            </Scheda>
          </div>
        )}

        {/* ── MARGINE ────────────────────────────────────────────────────── */}
        {/*
          Il costo e' quello valido il GIORNO DELLA VENDITA, non l'ultimo noto:
          e' cio' che rende confrontabili due anni diversi. Resta pero' un costo
          di RICOSTITUZIONE — il prezzo a cui quel giorno si sarebbe ricomprata
          la merce — e non il costo dei pezzi effettivamente venduti, perche' il
          magazzino non e' valorizzato. I sottotitoli lo dicono, e devono
          continuare a dirlo.
        */}
        {vista === "margine" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Scheda
              titolo="Margine"
              sottotitolo="fatturato meno costo di acquisto, al costo del giorno della vendita"
            >
              <div className="py-2">
                <KpiEroe
                  etichetta="Margine"
                  valore={tot("margineTot")}
                  confronto={
                    tot("margineAP")
                      ? { valore: tot("margineAP")!, etichetta: `${anno - 1}`, buonoSeAlto: true }
                      : null
                  }
                />
              </div>
            </Scheda>

            <Scheda titolo="Margine %" sottotitolo="sulla sola parte di cui si conosce il costo">
              <div className="py-2">
                <KpiEroe
                  etichetta="Margine %"
                  valore={tot("marginePct")}
                  unita="percentuale"
                  confronto={
                    tot("marginePctAP")
                      ? { valore: tot("marginePctAP")!, etichetta: `${anno - 1}`, buonoSeAlto: true }
                      : null
                  }
                />
              </div>
            </Scheda>

            <Scheda
              titolo="Copertura costi"
              sottotitolo="quanta parte del fatturato ha un costo noto: va guardata PRIMA del margine"
            >
              <div className="py-2">
                <KpiEroe
                  etichetta="Copertura"
                  valore={tot("coperturaPct")}
                  unita="percentuale"
                  nota={`Costo del venduto ${euro(tot("costoVendutoTot") ?? 0)}`}
                />
              </div>
            </Scheda>

            <Scheda
              titolo="Andamento del margine"
              className="lg:col-span-3"
              sottotitolo="mese per mese, contro lo stesso periodo dell'anno precedente"
            >
              <GraficoLinee
                serie={[
                  { nome: `Margine ${anno}`, risultato: r("margineMese"), colore: "#00a1be" },
                  {
                    nome: `Margine ${anno - 1}`,
                    risultato: r("margineMeseAP"),
                    colore: "#94a3b8",
                    tratteggiata: true,
                  },
                ]}
                altezza={300}
              />
            </Scheda>

            <Scheda
              titolo="Margine % per business unit"
              sottotitolo="dove si guadagna non è dove si fattura di più"
            >
              <GraficoBarre
                risultato={r("marginePctBu")}
                orizzontale
                colore={coloreSerie(0)}
                onClick={(b: string) => alternaFiltro("bu", b)}
                selezionata={filtroDi("bu")}
              />
            </Scheda>

            <Scheda titolo="Margine % per categoria">
              <GraficoBarre
                risultato={r("marginePctCategoria")}
                orizzontale
                colore={coloreSerie(1)}
                onClick={(c: string) => alternaFiltro("categoria", c)}
                selezionata={filtroDi("categoria")}
              />
            </Scheda>

            <Scheda titolo="Quota del margine per business unit">
              <GraficoTorta
                risultato={r("margineBu")}
                onClick={(b: string) => alternaFiltro("bu", b)}
                selezionata={filtroDi("bu")}
              />
            </Scheda>

            <Scheda
              titolo="I clienti a margine più sottile"
              className="lg:col-span-2"
              sottotitolo="dal più basso; un cliente che compra articoli senza costo a listino compare qui senza meritarlo — controllare la copertura"
            >
              <GraficoBarre
                risultato={r("marginePctClienti")}
                orizzontale
                colore={coloreSerie(2)}
                onClick={(c: string) => alternaFiltro("cliente", c)}
                selezionata={filtroDi("cliente")}
              />
            </Scheda>

            <Scheda
              titolo="Copertura per business unit"
              sottotitolo="dove questa scende, il margine accanto vale di meno"
            >
              <GraficoBarre
                risultato={r("coperturaBu")}
                orizzontale
                colore={coloreSerie(5)}
                onClick={(b: string) => alternaFiltro("bu", b)}
                selezionata={filtroDi("bu")}
              />
            </Scheda>

            <Scheda
              titolo="Margine % per agente"
              sottotitolo="da leggere con la tabella qui sotto: una percentuale alta su poco volume non è un risultato"
            >
              <GraficoBarre
                risultato={r("marginePctAgente")}
                orizzontale
                colore={coloreSerie(3)}
                onClick={(a: string) => alternaFiltro("agente", a)}
                selezionata={filtroDi("agente")}
              />
            </Scheda>

            <Scheda
              titolo="Agenti — fatturato, costo e margine"
              className="lg:col-span-3"
              sottotitolo="ordinabile per qualsiasi colonna; la copertura dice quanto fidarsi del margine accanto"
            >
              <TabellaAnalitica
                colonnaDimensione="Agente"
                colonne={COLONNE_MARGINE}
                righe={righeTabellaMargine({
                  fatturato: "fatturatoAgente",
                  costo: "costoAgente",
                  margine: "margineAgente",
                  pct: "marginePctAgente",
                  copertura: "coperturaAgente",
                })}
                colonnaOrdinamentoIniziale="margine"
                massimoIniziale={15}
                onClickRiga={(a) => alternaFiltro("agente", a)}
                rigaEvidenziata={filtroDi("agente")}
              />
            </Scheda>

            <Scheda
              titolo="Clienti — il margine, uno per uno"
              className="lg:col-span-3"
              sottotitolo="clicca una riga per aprire le sue fatture con il margine di ognuna"
            >
              <TabellaAnalitica
                colonnaDimensione="Cliente"
                colonne={COLONNE_MARGINE}
                righe={righeTabellaMargine({
                  fatturato: "fatturatoCli",
                  costo: "costoCli",
                  margine: "margineCli",
                  pct: "marginePctCli",
                  copertura: "coperturaCli",
                })}
                colonnaOrdinamentoIniziale="margine"
                massimoIniziale={20}
                onClickRiga={(cliente) =>
                  setDettaglio({
                    dataset: "fatturato",
                    titolo: cliente,
                    filtri: [
                      ...filtriSpec.filter((f) => f.campo !== "cliente"),
                      { campo: "cliente", op: "eq", valore: cliente },
                    ],
                    periodo,
                  })
                }
                rigaEvidenziata={filtroDi("cliente")}
              />
            </Scheda>
          </div>
        )}

        {/* ── PREVENTIVI ─────────────────────────────────────────────────── */}
        {vista === "preventivi" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Scheda titolo="Preventivi aperti" sottotitolo="importo inevaso, tutti gli anni">
              <div className="grid grid-cols-2 gap-4 py-2">
                <KpiEroe etichetta="Importo inevaso" valore={tot("preventiviTot")} />
                <KpiEroe
                  etichetta="Preventivi distinti"
                  valore={tot("nPreventivi")}
                  unita="numero"
                />
              </div>
              <div className="mt-3">
                <GraficoTorta
                  risultato={r("preventiviBu")}
                  altezza={220}
                  onClick={(b) => alternaFiltro("bu", b)}
                  selezionata={filtroDi("bu")}
                />
              </div>
            </Scheda>

            <Scheda titolo="Concentrazione per cliente">
              <Pareto
                dati={(r("preventiviCliente")?.righe ?? []).map((x) => ({
                  etichetta: x.etichetta,
                  valore: x.valore,
                }))}
                massimo={15}
                onClick={(c) => alternaFiltro("cliente", c)}
              />
            </Scheda>

            <Scheda titolo="Inevaso per agente">
              <BarreScostamento
                dati={(r("preventiviAgente")?.righe ?? []).map((x) => ({
                  etichetta: x.etichetta,
                  valore: x.valore,
                }))}
                onClick={(a) => alternaFiltro("agente", a)}
              />
            </Scheda>

            <Scheda titolo="Portafoglio per mese di consegna">
              <GraficoCombo
                barre={{ nome: "Portafoglio", risultato: r("portafoglioMese"), colore: "#8b5cf6" }}
                linee={[]}
                altezza={280}
              />
            </Scheda>

            <Scheda titolo="Per causale magazzino" className="lg:col-span-2">
              <BarreScostamento
                dati={(r("preventiviCausale")?.righe ?? []).slice(0, 12).map((x) => ({
                  etichetta: x.etichetta,
                  valore: x.valore,
                }))}
                altezza={320}
                onClick={(c) => alternaFiltro("causale", c)}
              />
            </Scheda>
          </div>
        )}

        {/* ── CONVERSIONE ────────────────────────────────────────────────── */}
        {vista === "conversione" && (
          <VistaConversione
            anno={anno}
            periodo={periodo}
            filtriSpec={filtriSpec}
            alternaFiltro={alternaFiltro}
            filtroDi={filtroDi}
          />
        )}

        {/* ── BACK OFFICE ────────────────────────────────────────────────── */}
        {vista === "backoffice" && (
          <VistaBackoffice
            anno={anno}
            periodo={periodo}
            filtriSpec={filtriSpec}
            alternaFiltro={alternaFiltro}
            filtroDi={filtroDi}
          />
        )}

        {/* ── ACQUISTI ───────────────────────────────────────────────────── */}
        {vista === "acquisti" && <VistaAcquisti anno={anno} periodo={periodo} />}
      </div>

      {/* Dalla riga di un cliente alle sue fatture, con il margine di ognuna. */}
      <PannelloDettaglio richiesta={dettaglio} onChiudi={() => setDettaglio(null)} />
    </div>
  );
}
