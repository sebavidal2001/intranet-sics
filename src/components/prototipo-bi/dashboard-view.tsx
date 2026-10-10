"use client";

/**
 * LA DASHBOARD APERTA: pagine, filtri comuni, griglia di riquadri.
 *
 * Un tema non sta in una schermata sola — "Commerciale 2026" vuole una pagina
 * di sintesi, una per agente, una sulla pipeline — e le pagine servono a
 * questo.
 *
 * Due cose che vale la pena sapere prima di metterci le mani:
 *
 *  - i riquadri di una pagina si chiedono in UNA chiamata sola
 *    (`POST /api/bi/query` con `specs`), non una per riquadro: con otto
 *    riquadri sarebbero otto viaggi a ogni cambio di filtro;
 *  - un riquadro contiene una SPEC, non dei dati. Chi apre una pagina
 *    condivisa la esegue con il proprio perimetro e vede i propri numeri. È il
 *    motivo per cui una dashboard si può condividere fra livelli diversi senza
 *    che diventi il modo più comodo per far uscire dati.
 */

import { useAutoAggiornamento } from "./auto-aggiornamento";
import { SelettoreValori } from "./selettore-valori";
import { SceltaGrafico } from "./scelta-grafico";
import { SelettoreAnni } from "./selettore-anni";
import { anniDelPeriodo } from "@/lib/prototipo-bi/periodo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Filter,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import {
  AggiungiRiquadro,
  type AnalisiAggiungibile,
  type RiquadroCreato,
} from "./aggiungi-riquadro";
import { GraficoDaAnalisi } from "./grafico-da-risultato";
import { PannelloDettaglio, type RichiestaPannello } from "./dettaglio-documenti";
import { DATASET_DI_METRICA, METRICHE_SOLO_IN_CORSO } from "@/lib/prototipo-bi/gruppi-campi";
import { preparaEsecuzioneAnalisi } from "@/lib/prototipo-bi/analisi-composita";
import { applicaFiltriIncrociati, type FiltriPagina } from "@/lib/prototipo-bi/filtri-pagina";
import { DIMENSIONI } from "@/lib/prototipo-bi/semantico";
import { preparaEsportazione, scriviExcelRiquadro } from "@/lib/prototipo-bi/esporta-riquadro";
import { TIPI_GRAFICO, type TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type {
  AspettoGrafico,
  Filtro,
  RisultatoQuery,
  SerieAnalisi,
  SerieAnalisiEseguita,
  SpecQuery,
} from "@/lib/prototipo-bi/tipi";

export interface AnalisiDashboard {
  id: string;
  titolo: string;
  descrizione: string | null;
  spec: SpecQuery;
  serie?: SerieAnalisi[] | null;
  grafico: TipoGrafico | null;
  aspetto?: AspettoGrafico | null;
  autore_id: string;
  visibilita: "privata" | "condivisa";
}

export interface RiquadroDashboard {
  id: string;
  pagina_id: string;
  analisi_id: string;
  titolo: string | null;
  posizione: number;
  larghezza: number;
  altezza: number;
  grafico: TipoGrafico | null;
  analisi: AnalisiDashboard;
}

export interface PaginaDashboard {
  id: string;
  dashboard_id: string;
  titolo: string;
  ordine: number;
  filtri: FiltriPagina;
  riquadri: RiquadroDashboard[];
}

export interface DashboardCompleta {
  id: string;
  titolo: string;
  descrizione: string | null;
  autore_id: string;
  visibilita: "privata" | "condivisa";
  modificabile?: boolean;
  di_sistema?: boolean;
  pagine: PaginaDashboard[];
}

interface RispostaBatch {
  risultati?: Array<{ id: string; risultato?: RisultatoQuery; errore?: string }>;
  error?: string;
}

interface ProprietaDashboardView {
  dashboardId?: string;
  dashboardIniziale?: DashboardCompleta;
}


const COLONNE: Record<number, string> = {
  1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4",
  5: "lg:col-span-5", 6: "lg:col-span-6", 7: "lg:col-span-7", 8: "lg:col-span-8",
  9: "lg:col-span-9", 10: "lg:col-span-10", 11: "lg:col-span-11", 12: "lg:col-span-12",
};

function messaggioErrore(valore: unknown, ripiego: string): string {
  if (valore && typeof valore === "object" && "error" in valore && typeof valore.error === "string") {
    return valore.error;
  }
  return ripiego;
}

// ── Filtri di pagina ↔ selettore di valori ─────────────────────────────────

function elencoValori(v: string | string[] | undefined): string[] {
  return (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
}

/** Il filtro che il selettore mostra: rami a matrioska o business unit intere. */
function filtroBuPagina(f: FiltriPagina): Filtro | null {
  const rami = elencoValori(f.rami);
  if (rami.length) return { campo: "bu_categoria", op: "in", valore: rami };
  const bu = elencoValori(f.bu);
  return bu.length ? { campo: "bu", op: "in", valore: bu } : null;
}

function conFiltroBu(f: FiltriPagina, filtro: Filtro | null): FiltriPagina {
  const valori = filtro ? (Array.isArray(filtro.valore) ? filtro.valore : [filtro.valore]) : [];
  if (!filtro || valori.length === 0) return { ...f, bu: undefined, rami: undefined };
  return filtro.campo === "bu_categoria"
    ? { ...f, bu: undefined, rami: valori }
    : { ...f, bu: valori, rami: undefined };
}

function filtroAgentePagina(f: FiltriPagina): Filtro | null {
  const agenti = elencoValori(f.agente);
  return agenti.length ? { campo: "agente", op: "in", valore: agenti } : null;
}

function riassuntoPagina(filtro: Filtro | null, vuoto: string): string {
  if (!filtro) return vuoto;
  const v = Array.isArray(filtro.valore) ? filtro.valore : [filtro.valore];
  return v.length === 1 ? v[0] : `${v.length} selezionati`;
}

function filtriPuliti(filtri: FiltriPagina | null | undefined): FiltriPagina {
  if (!filtri || typeof filtri !== "object") return {};
  return filtri;
}

export function DashboardView({ dashboardId, dashboardIniziale }: ProprietaDashboardView) {
  const [dashboard, setDashboard] = useState<DashboardCompleta | null>(dashboardIniziale ?? null);
  const [paginaAttivaId, setPaginaAttivaId] = useState(dashboardIniziale?.pagine[0]?.id ?? "");
  const [risultati, setRisultati] = useState<Record<string, RisultatoQuery>>({});
  const [erroriRiquadri, setErroriRiquadri] = useState<Record<string, string>>({});
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(!dashboardIniziale);
  const [queryInCorso, setQueryInCorso] = useState(false);
  const [nuovaPagina, setNuovaPagina] = useState(false);
  const [titoloPagina, setTitoloPagina] = useState("");
  const [pannelloAggiungi, setPannelloAggiungi] = useState(false);
  const [azioneInCorso, setAzioneInCorso] = useState(false);
  /**
   * I documenti dietro il punto cliccato.
   *
   * Il pannello e il suo motore esistevano gia', ma erano agganciati alle sole
   * schede Conversione e Back office del Cruscotto: nei riquadri costruiti
   * dagli utenti il clic non faceva niente. Un numero su cui non si puo'
   * scendere resta una cosa da credere sulla parola, ed e' il primo motivo per
   * cui a un cruscotto non si crede.
   */
  const [dettaglio, setDettaglio] = useState<RichiestaPannello | null>(null);
  const [duplicazioneInCorso, setDuplicazioneInCorso] = useState(false);
  /**
   * I filtri nati dal clic su un grafico. Stanno solo qui: non si salvano con la
   * pagina e quindi funzionano anche per chi la dashboard l'ha solo ricevuta.
   */
  const [incrociati, setIncrociati] = useState<Filtro[]>([]);
  /** Se l'ultimo clic aveva Ctrl/Alt/Cmd: in quel caso si aprono i documenti invece di filtrare. */
  const clicPerDocumenti = useRef(false);

  const caricaDashboard = useCallback(async () => {
    if (!dashboardId) return;
    setCaricamento(true);
    setErrore(null);
    try {
      const risposta = await fetch(`/api/bi/dashboard/${dashboardId}`);
      const corpo = (await risposta.json()) as { dashboard?: DashboardCompleta; error?: string };
      if (!risposta.ok || !corpo.dashboard) throw new Error(messaggioErrore(corpo, "Dashboard non disponibile."));
      setDashboard(corpo.dashboard);
      setPaginaAttivaId((corrente) =>
        corpo.dashboard?.pagine.some((pagina) => pagina.id === corrente)
          ? corrente
          : corpo.dashboard?.pagine[0]?.id ?? ""
      );
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Dashboard non disponibile.");
    } finally {
      setCaricamento(false);
    }
  }, [dashboardId]);

  useEffect(() => {
    if (!dashboardIniziale) void caricaDashboard();
  }, [caricaDashboard, dashboardIniziale]);

  const paginaAttiva = useMemo(
    () => dashboard?.pagine.find((pagina) => pagina.id === paginaAttivaId) ?? dashboard?.pagine[0] ?? null,
    [dashboard, paginaAttivaId]
  );

  // Cambiando pagina il filtro incrociato non la segue: un filtro «IMA» scelto
  // sulla sintesi non deve restare acceso, invisibile, su una pagina diversa.
  useEffect(() => {
    // Stessa identita' se e' gia' vuoto: un nuovo array rieseguirebbe tutti i riquadri per niente.
    setIncrociati((correnti) => (correnti.length === 0 ? correnti : []));
  }, [paginaAttiva?.id]);

  /**
   * Apre i documenti dietro una categoria cliccata su un riquadro.
   *
   * La dimensione su cui si e' cliccato e' la prima del raggruppamento: e'
   * quella che genera le etichette dell'asse, quindi il valore cliccato e' un
   * suo valore. Se il riquadro non raggruppa niente, l'etichetta e' un periodo
   * o un totale e non c'e' niente su cui scendere.
   */
  const esportaRiquadro = useCallback(async (titolo: string, serie: SerieAnalisiEseguita[]) => {
    try {
      await scriviExcelRiquadro(preparaEsportazione(titolo, serie));
    } catch (e) {
      setErrore(e instanceof Error ? `Esportazione non riuscita: ${e.message}` : "Esportazione non riuscita");
    }
  }, []);

  const apriDocumenti = useCallback(
    (riquadro: RiquadroDashboard, etichetta: string) => {
      const spec = riquadro.analisi.spec;
      // Una misura personalizzata non ha UN insieme di documenti dietro: i
      // filtri incorporati negli operandi non passano al dettaglio, che
      // mostrerebbe documenti che la misura non conta.
      if (spec.misura) return;
      const dataset = DATASET_DI_METRICA[spec.metrica];
      const dimensione = spec.raggruppa?.[0];
      if (!dataset || !dimensione) return;

      const filtriPagina = filtriPuliti(paginaAttiva?.filtri ?? {});
      setDettaglio({
        dataset: dataset as RichiestaPannello["dataset"],
        titolo: `${riquadro.titolo || riquadro.analisi.titolo} — ${etichetta}`,
        filtri: [
          ...(spec.filtri ?? [])
            .filter((filtro: Filtro) => filtro.op === "eq" && filtro.campo !== dimensione)
            .map((filtro: Filtro) => ({
              campo: filtro.campo,
              op: "eq" as const,
              valore: String(filtro.valore),
            })),
          { campo: dimensione, op: "eq" as const, valore: etichetta },
          // «Aperti» sono i preventivi in corso: l'elenco deve contare gli stessi del numero.
          ...(METRICHE_SOLO_IN_CORSO.has(spec.metrica) && dimensione !== "causale_codice"
            ? [{ campo: "causale_codice" as const, op: "eq" as const, valore: "PIC" }]
            : []),
        ],
        periodo: spec.periodo ?? filtriPagina.periodo,
      });
    },
    [paginaAttiva]
  );

  /**
   * Il clic su un grafico accende (o spegne) il filtro su quel valore per tutti
   * i riquadri della pagina, come nel Cruscotto. Ctrl/Alt/Cmd+clic apre invece i
   * documenti dietro il punto, che prima era l'unico effetto del clic.
   *
   * Si filtra solo quando il riquadro ha UNA suddivisione: con due, l'etichetta
   * è una coppia e non si sa a quale delle due appartiene il valore.
   */
  const cliccaEtichetta = useCallback(
    (riquadro: RiquadroDashboard, etichetta: string) => {
      const dimensioni = riquadro.analisi.spec.raggruppa ?? [];
      if (clicPerDocumenti.current || dimensioni.length !== 1) {
        apriDocumenti(riquadro, etichetta);
        return;
      }
      const campo = dimensioni[0];
      setIncrociati((correnti) => {
        const esistente = correnti.find((f) => f.campo === campo);
        const altri = correnti.filter((f) => f.campo !== campo);
        return esistente && esistente.valore === etichetta
          ? altri
          : [...altri, { campo, op: "eq", valore: etichetta }];
      });
    },
    [apriDocumenti]
  );

  const specsBatch = useMemo(() => {
    if (!paginaAttiva) return [];
    return paginaAttiva.riquadri.flatMap((riquadro) =>
      preparaEsecuzioneAnalisi(
        { spec: riquadro.analisi.spec, serie: riquadro.analisi.serie },
        filtriPuliti(paginaAttiva.filtri),
        riquadro.id
      ).map((voce) => {
        // Un riquadro che suddivide per la stessa dimensione non si filtra da solo:
        // altrimenti il grafico cliccato si ridurrebbe alla sola barra scelta e non
        // si potrebbe piu' passare a un'altra. Resta intero, come nel Cruscotto.
        const dimensioniRiquadro = riquadro.analisi.spec.raggruppa ?? [];
        const incrocio = applicaFiltriIncrociati(
          voce.spec,
          incrociati.filter((f) => !dimensioniRiquadro.includes(f.campo))
        );
        return {
          id: voce.id,
          spec: incrocio.spec,
          ruolo: voce.ruolo,
          nome: voce.nome,
          ignorati: [...voce.filtriPaginaIgnorati, ...incrocio.ignorati],
        };
      })
    );
  }, [paginaAttiva, incrociati]);

  // Caricamento nuovo sul server: si rieseguono i riquadri, senza ricaricare
  // la pagina ne' perdere la pagina di dashboard aperta.
  const [generazioneDati, setGenerazioneDati] = useState(0);
  useAutoAggiornamento(undefined, () => setGenerazioneDati((g) => g + 1));

  useEffect(() => {
    if (specsBatch.length === 0) {
      setRisultati({});
      setErroriRiquadri({});
      return;
    }

    let annullata = false;
    setQueryInCorso(true);
    setErrore(null);
    // La pagina condivisa trasporta domande, mai risultati: questo batch viene
    // rieseguito dal server nel perimetro dell'utente che la sta guardando.
    void fetch("/api/bi/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specs: specsBatch.map(({ id, spec }) => ({ id, spec })) }),
    })
      .then(async (risposta) => {
        const corpo = (await risposta.json()) as RispostaBatch;
        if (!risposta.ok) throw new Error(messaggioErrore(corpo, "Impossibile aggiornare i riquadri."));
        if (annullata) return;
        const nuoviRisultati: Record<string, RisultatoQuery> = {};
        const nuoviErrori: Record<string, string> = {};
        for (const voce of corpo.risultati ?? []) {
          if (voce.risultato) nuoviRisultati[voce.id] = voce.risultato;
          if (voce.errore) nuoviErrori[voce.id] = voce.errore;
        }
        setRisultati(nuoviRisultati);
        setErroriRiquadri(nuoviErrori);
      })
      .catch((causa: unknown) => {
        if (!annullata) setErrore(causa instanceof Error ? causa.message : "Impossibile aggiornare i riquadri.");
      })
      .finally(() => {
        if (!annullata) setQueryInCorso(false);
      });

    return () => {
      annullata = true;
    };
  }, [specsBatch, generazioneDati]);

  // «Può modificare» (autore, non Cruscotto di sistema) e «sta modificando» sono
  // due cose: una dashboard si apre SEMPRE in visualizzazione, e i comandi di
  // modifica compaiono solo dopo il clic su «Modifica». `modificabile` resta il
  // nome di «sta modificando» perché è quello che gate-a tutti i comandi sotto.
  const puoModificare = dashboard?.modificabile ?? Boolean(dashboardIniziale);
  const [inModifica, setInModifica] = useState(false);
  const modificabile = puoModificare && inModifica;

  // Una dashboard appena creata è vuota: non c'è niente da guardare, quindi si
  // apre già in modifica. Una volta sola, al primo caricamento.
  const apertaInModificaPerVuota = useRef(false);
  useEffect(() => {
    if (apertaInModificaPerVuota.current || !dashboard || !puoModificare) return;
    apertaInModificaPerVuota.current = true;
    if (dashboard.pagine.every((pagina) => pagina.riquadri.length === 0)) setInModifica(true);
  }, [dashboard, puoModificare]);

  function sostituisciPagina(pagina: PaginaDashboard) {
    setDashboard((corrente) => corrente ? {
      ...corrente,
      pagine: corrente.pagine.map((voce) => voce.id === pagina.id ? pagina : voce),
    } : corrente);
  }

  // `nuovi` quando si salva subito dopo aver cambiato: lo stato non e' ancora
  // aggiornato e `paginaAttiva.filtri` sarebbe quello di prima.
  async function salvaFiltriPagina(nuovi?: FiltriPagina) {
    if (!dashboard || !paginaAttiva || !modificabile) return;
    const risposta = await fetch(`/api/bi/dashboard/${dashboard.id}/pagine`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagine: [{ id: paginaAttiva.id, filtri: nuovi ?? paginaAttiva.filtri }] }),
    });
    if (!risposta.ok) setErrore(messaggioErrore(await risposta.json(), "Impossibile salvare i filtri."));
  }

  function aggiornaFiltri(filtri: FiltriPagina) {
    if (!paginaAttiva) return;
    sostituisciPagina({ ...paginaAttiva, filtri });
  }

  async function creaPagina() {
    if (!dashboard || !titoloPagina.trim()) return;
    setAzioneInCorso(true);
    const risposta = await fetch(`/api/bi/dashboard/${dashboard.id}/pagine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titolo: titoloPagina.trim() }),
    });
    const corpo = (await risposta.json()) as { pagina?: PaginaDashboard; error?: string };
    if (risposta.ok && corpo.pagina) {
      setDashboard({ ...dashboard, pagine: [...dashboard.pagine, corpo.pagina] });
      setPaginaAttivaId(corpo.pagina.id);
      setTitoloPagina("");
      setNuovaPagina(false);
    } else {
      setErrore(messaggioErrore(corpo, "Impossibile creare la pagina."));
    }
    setAzioneInCorso(false);
  }

  async function rinominaPagina() {
    if (!dashboard || !paginaAttiva || !modificabile) return;
    const titolo = window.prompt("Nuovo titolo della pagina", paginaAttiva.titolo)?.trim();
    if (!titolo || titolo === paginaAttiva.titolo) return;
    setAzioneInCorso(true);
    const risposta = await fetch(`/api/bi/dashboard/${dashboard.id}/pagine`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagine: [{ id: paginaAttiva.id, titolo }] }),
    });
    if (risposta.ok) sostituisciPagina({ ...paginaAttiva, titolo });
    else setErrore(messaggioErrore(await risposta.json(), "Impossibile rinominare la pagina."));
    setAzioneInCorso(false);
  }

  async function eliminaPagina() {
    if (!dashboard || !paginaAttiva || !modificabile || dashboard.pagine.length <= 1) return;
    if (!window.confirm(`Eliminare la pagina “${paginaAttiva.titolo}” e tutti i suoi riquadri?`)) return;
    setAzioneInCorso(true);
    const risposta = await fetch(
      `/api/bi/dashboard/${dashboard.id}/pagine?pagina=${encodeURIComponent(paginaAttiva.id)}`,
      { method: "DELETE" }
    );
    if (risposta.ok) {
      const pagine = dashboard.pagine.filter((pagina) => pagina.id !== paginaAttiva.id);
      setDashboard({ ...dashboard, pagine });
      setPaginaAttivaId(pagine[0]?.id ?? "");
    } else {
      setErrore(messaggioErrore(await risposta.json(), "Impossibile eliminare la pagina."));
    }
    setAzioneInCorso(false);
  }

  function registraRiquadro(analisi: AnalisiAggiungibile, riquadro: RiquadroCreato) {
    if (!paginaAttiva) return;
    sostituisciPagina({
      ...paginaAttiva,
      riquadri: [...paginaAttiva.riquadri, { ...riquadro, analisi }],
    });
    setPannelloAggiungi(false);
  }

  async function duplicaDashboard() {
    if (!dashboard || duplicazioneInCorso) return;
    setDuplicazioneInCorso(true);
    setErrore(null);
    try {
      const risposta = await fetch(`/api/bi/dashboard/${dashboard.id}/duplica`, { method: "POST" });
      const corpo = (await risposta.json()) as { dashboard?: { id: string }; error?: string };
      if (!risposta.ok || !corpo.dashboard) {
        throw new Error(messaggioErrore(corpo, "Impossibile duplicare la dashboard."));
      }
      window.location.assign(`/bi/dashboard/${corpo.dashboard.id}`);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile duplicare la dashboard.");
      setDuplicazioneInCorso(false);
    }
  }

  async function aggiornaRiquadri(riquadri: RiquadroDashboard[], modifiche: Array<Record<string, unknown>>) {
    if (!paginaAttiva) return;
    sostituisciPagina({ ...paginaAttiva, riquadri });
    const risposta = await fetch(`/api/bi/dashboard/pagine/${paginaAttiva.id}/riquadri`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ riquadri: modifiche }),
    });
    if (!risposta.ok) {
      setErrore(messaggioErrore(await risposta.json(), "Impossibile aggiornare il riquadro."));
      await caricaDashboard();
    }
  }

  function spostaRiquadro(indice: number, direzione: -1 | 1) {
    if (!paginaAttiva) return;
    const destinazione = indice + direzione;
    if (destinazione < 0 || destinazione >= paginaAttiva.riquadri.length) return;
    const riordinati = [...paginaAttiva.riquadri];
    [riordinati[indice], riordinati[destinazione]] = [riordinati[destinazione], riordinati[indice]];
    const normalizzati = riordinati.map((riquadro, posizione) => ({ ...riquadro, posizione }));
    void aggiornaRiquadri(normalizzati, normalizzati.map(({ id, posizione }) => ({ id, posizione })));
  }

  async function togliRiquadro(riquadroId: string) {
    if (!paginaAttiva) return;
    const riquadro = paginaAttiva.riquadri.find((voce) => voce.id === riquadroId);
    const titolo = riquadro?.titolo || riquadro?.analisi.titolo || "questo riquadro";
    if (!window.confirm(`Togliere “${titolo}” da questa pagina? L'analisi resterà nella libreria.`)) return;
    const risposta = await fetch(
      `/api/bi/dashboard/pagine/${paginaAttiva.id}/riquadri?riquadro=${riquadroId}`,
      { method: "DELETE" }
    );
    if (risposta.ok) {
      sostituisciPagina({ ...paginaAttiva, riquadri: paginaAttiva.riquadri.filter((r) => r.id !== riquadroId) });
    } else {
      setErrore(messaggioErrore(await risposta.json(), "Impossibile togliere il riquadro."));
    }
  }

  if (caricamento) {
    return <main className="flex flex-1 items-center justify-center bg-bg-page p-8 text-text-muted"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" aria-hidden />Apro la dashboard…</main>;
  }
  if (!dashboard) {
    return <main className="flex-1 bg-bg-page p-6 text-text"><div className="mx-auto max-w-3xl border-y border-border py-10"><h1 className="font-tenorite text-2xl font-semibold">Dashboard non disponibile</h1><p role="alert" className="mt-2 text-sm text-danger">{errore ?? "Non è stato possibile aprire la dashboard."}</p><div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => void caricaDashboard()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><RefreshCw className="h-4 w-4" aria-hidden />Riprova</button><Link href="/bi/dashboard" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-bg px-4 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ArrowLeft className="h-4 w-4" aria-hidden />Torna alle dashboard</Link></div></div></main>;
  }

  const filtri = filtriPuliti(paginaAttiva?.filtri);
  // I filtri della pagina si possono muovere sempre, anche da chi la dashboard
  // l'ha solo ricevuta: in visualizzazione valgono per chi guarda e non si
  // salvano; si salvano solo se chi li cambia sta modificando.
  const filtriModificabili = true;
  const anniPagina = anniDelPeriodo(filtri.periodo);
  const modalitaPeriodo = anniPagina ? "anno" : "intervallo";
  function cambiaAnniPagina(anni: number[]) {
    // Le pastiglie non hanno un «blur» affidabile come i campi: si salva subito.
    const nuovi = { ...filtri, periodo: { anni } };
    aggiornaFiltri(nuovi);
    void salvaFiltriPagina(nuovi);
  }

  return (
    <main className="flex-1 bg-bg-page px-4 py-6 text-text sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-tenorite text-3xl font-bold tracking-[-0.02em]">{dashboard.titolo}</h1>
            {dashboard.descrizione && <p className="mt-1 max-w-3xl text-sm text-text-muted">{dashboard.descrizione}</p>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-text-muted">
            <span className="rounded-full border border-border bg-bg px-2.5 py-1">{dashboard.visibilita === "condivisa" ? "Condivisa" : "Privata"}</span>
            {puoModificare && <button type="button" onClick={() => setInModifica((v) => !v)} aria-pressed={inModifica} className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${inModifica ? "bg-primary text-white hover:bg-primary-dark" : "border border-border bg-bg text-text hover:bg-bg-page"}`}>
              {inModifica ? <Check className="h-4 w-4" aria-hidden /> : <Pencil className="h-4 w-4" aria-hidden />}
              {inModifica ? "Fine modifica" : "Modifica"}
            </button>}
            {puoModificare && <button type="button" onClick={() => void duplicaDashboard()} disabled={duplicazioneInCorso} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-bg px-3 text-sm font-semibold text-text hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
              {duplicazioneInCorso ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              Duplica
            </button>}
            {queryInCorso && <span className="inline-flex items-center gap-1.5"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />Aggiornamento</span>}
          </div>
        </header>

        <div className="mb-4 flex min-w-0 items-end gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Pagine dashboard">
          {dashboard.pagine.map((pagina) => (
            <button
              key={pagina.id}
              type="button"
              role="tab"
              aria-selected={pagina.id === paginaAttiva?.id}
              onClick={() => setPaginaAttivaId(pagina.id)}
              className={`min-h-10 shrink-0 border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${pagina.id === paginaAttiva?.id ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text"}`}
            >
              {pagina.titolo}
            </button>
          ))}
          {modificabile && paginaAttiva && <button type="button" onClick={() => void rinominaPagina()} disabled={azioneInCorso} className="mb-1 shrink-0 rounded-lg p-2 text-text-muted hover:bg-bg hover:text-primary disabled:opacity-50" aria-label={`Rinomina pagina ${paginaAttiva.titolo}`}><Pencil className="h-4 w-4" aria-hidden /></button>}
          {modificabile && paginaAttiva && dashboard.pagine.length > 1 && <button type="button" onClick={() => void eliminaPagina()} disabled={azioneInCorso} className="mb-1 shrink-0 rounded-lg p-2 text-text-muted hover:bg-bg hover:text-danger disabled:opacity-50" aria-label={`Elimina pagina ${paginaAttiva.titolo}`}><Trash2 className="h-4 w-4" aria-hidden /></button>}
          {modificabile && (
            nuovaPagina ? (
              <form className="mb-1 flex shrink-0 items-center gap-1" onSubmit={(evento) => { evento.preventDefault(); void creaPagina(); }}>
                <input autoFocus value={titoloPagina} onChange={(evento) => setTitoloPagina(evento.target.value)} className="h-9 w-40 rounded-lg border border-border bg-bg px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary" aria-label="Titolo nuova pagina" placeholder="Titolo pagina" />
                <button type="submit" disabled={!titoloPagina.trim() || azioneInCorso} className="rounded-lg p-2 text-primary hover:bg-bg disabled:opacity-40" aria-label="Crea pagina"><Check className="h-4 w-4" aria-hidden /></button>
                <button type="button" onClick={() => setNuovaPagina(false)} className="rounded-lg p-2 text-text-muted hover:bg-bg" aria-label="Annulla"><X className="h-4 w-4" aria-hidden /></button>
              </form>
            ) : (
              <button type="button" onClick={() => setNuovaPagina(true)} className="mb-1 shrink-0 rounded-lg p-2 text-primary hover:bg-bg" aria-label="Aggiungi pagina"><Plus className="h-4 w-4" aria-hidden /></button>
            )
          )}
        </div>

        {paginaAttiva && (
          <>
            <section aria-label="Filtri della pagina" className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-bg p-3">
              <div className="mr-1 flex h-9 items-center gap-2 text-sm font-semibold"><Filter className="h-4 w-4 text-primary" aria-hidden />Filtri pagina</div>
              <label className="text-xs text-text-muted">
                <span className="mb-1 block">Periodo</span>
                <select
                  value={modalitaPeriodo}
                  disabled={!filtriModificabili}
                  onChange={(evento) => aggiornaFiltri({ ...filtri, periodo: evento.target.value === "anno" ? { anni: [new Date().getFullYear()] } : {} })}
                  onBlur={() => void salvaFiltriPagina()}
                  className="h-9 rounded-lg border border-border bg-bg-page px-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                >
                  <option value="anno">Anni</option><option value="intervallo">Dal / al</option>
                </select>
              </label>
              {modalitaPeriodo === "anno" ? (
                <div className="text-xs text-text-muted"><span className="mb-1 block">Anni (anche più di uno)</span><SelettoreAnni valore={anniPagina ?? [new Date().getFullYear()]} disabilitato={!filtriModificabili} onCambia={cambiaAnniPagina} etichetta="Anni della pagina" /></div>
              ) : (
                <>
                  <label className="text-xs text-text-muted"><span className="mb-1 block">Dal</span><input type="date" value={filtri.periodo?.dal ?? ""} disabled={!filtriModificabili} onChange={(e) => aggiornaFiltri({ ...filtri, periodo: { dal: e.target.value || undefined, al: filtri.periodo?.al } })} onBlur={() => void salvaFiltriPagina()} className="h-9 rounded-lg border border-border bg-bg-page px-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary disabled:opacity-60" /></label>
                  <label className="text-xs text-text-muted"><span className="mb-1 block">Al</span><input type="date" value={filtri.periodo?.al ?? ""} disabled={!filtriModificabili} onChange={(e) => aggiornaFiltri({ ...filtri, periodo: { dal: filtri.periodo?.dal, al: e.target.value || undefined } })} onBlur={() => void salvaFiltriPagina()} className="h-9 rounded-lg border border-border bg-bg-page px-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary disabled:opacity-60" /></label>
                </>
              )}
              <div className="min-w-52 flex-1 text-xs text-text-muted">
                <span className="mb-1 block">Business unit</span>
                {filtriModificabili ? (
                  <SelettoreValori
                    etichetta="Business unit"
                    campo="bu"
                    metrica="fatturato"
                    periodo={filtri.periodo}
                    filtro={filtroBuPagina(filtri)}
                    onChange={(f) => {
                      const nuovi = conFiltroBu(filtri, f);
                      aggiornaFiltri(nuovi);
                      void salvaFiltriPagina(nuovi);
                    }}
                  />
                ) : (
                  <span className="flex h-9 items-center text-sm text-text">{riassuntoPagina(filtroBuPagina(filtri), "Tutte")}</span>
                )}
              </div>
              <div className="min-w-52 flex-1 text-xs text-text-muted">
                <span className="mb-1 block">Agente</span>
                {filtriModificabili ? (
                  <SelettoreValori
                    etichetta="Agente"
                    campo="agente"
                    metrica="ordinato"
                    periodo={filtri.periodo}
                    filtro={filtroAgentePagina(filtri)}
                    onChange={(f) => {
                      const valori = f ? (Array.isArray(f.valore) ? f.valore : [f.valore]) : [];
                      const nuovi = { ...filtri, agente: valori.length ? valori : undefined };
                      aggiornaFiltri(nuovi);
                      void salvaFiltriPagina(nuovi);
                    }}
                  />
                ) : (
                  <span className="flex h-9 items-center text-sm text-text">{riassuntoPagina(filtroAgentePagina(filtri), "Tutti")}</span>
                )}
              </div>
              {modificabile ? <button type="button" onClick={() => setPannelloAggiungi(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-bg transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus className="h-4 w-4" aria-hidden />Aggiungi</button> : paginaAttiva.riquadri.length > 0 ? <button type="button" onClick={() => void duplicaDashboard()} disabled={duplicazioneInCorso} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-bg transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">{duplicazioneInCorso ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}Duplica per modificare</button> : null}
            </section>

            {errore && <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger"><span>{errore}</span><button type="button" onClick={() => setErrore(null)} aria-label="Chiudi avviso"><X className="h-4 w-4" /></button></div>}

            {pannelloAggiungi && (
              <AggiungiRiquadro
                paginaId={paginaAttiva.id}
                filtriPagina={paginaAttiva.filtri}
                analisiPresenti={paginaAttiva.riquadri.map((riquadro) => riquadro.analisi_id)}
                onAggiunta={registraRiquadro}
                onChiudi={() => setPannelloAggiungi(false)}
              />
            )}

            {incrociati.length > 0 && (
              <div className="sticky top-2 z-30 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm shadow-sm backdrop-blur" role="status">
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">Filtro dal grafico</span>
                {incrociati.map((f) => (
                  <button
                    key={f.campo}
                    type="button"
                    onClick={() => setIncrociati((correnti) => correnti.filter((x) => x.campo !== f.campo))}
                    className="inline-flex items-center gap-1 rounded-full border border-primary bg-bg px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={`Togli il filtro ${DIMENSIONI[f.campo]?.etichetta ?? f.campo} ${String(f.valore)}`}
                  >
                    {DIMENSIONI[f.campo]?.etichetta ?? f.campo}: {String(f.valore)}
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                ))}
                <button type="button" onClick={() => setIncrociati([])} className="text-xs text-text-muted underline hover:text-text">Togli tutti</button>
                <span className="ml-auto text-[11px] text-text-muted">Ctrl+clic su un grafico per i documenti</span>
              </div>
            )}

            {paginaAttiva.riquadri.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center border-y border-dashed border-border py-12 text-center"><BarChart3 className="mb-3 h-8 w-8 text-primary" aria-hidden /><h2 className="font-tenorite text-xl font-bold">Questa pagina è ancora vuota</h2><p className="mt-1 max-w-md text-sm text-text-muted">{modificabile ? "Descrivi a parole cosa vuoi vedere, oppure spunta le misure che ti servono: il grafico compare qui, con questi filtri e con i dati che puoi vedere tu." : "Questa dashboard è condivisa e non si modifica direttamente. Fanne una copia tua per aggiungere il primo grafico."}</p>{modificabile ? <button type="button" onClick={() => setPannelloAggiungi(true)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-bg"><Plus className="h-4 w-4" aria-hidden />Aggiungi</button> : <button type="button" onClick={() => void duplicaDashboard()} disabled={duplicazioneInCorso} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50">{duplicazioneInCorso ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}Duplica per modificare</button>}</div>
            ) : (
              <div className="grid grid-cols-12 gap-4">
                {paginaAttiva.riquadri.map((riquadro, indice) => {
                  const batchRiquadro = specsBatch.filter(
                    (voce) => voce.id === riquadro.id || voce.id.startsWith(`${riquadro.id}:`)
                  );
                  const ignorati = [...new Set(batchRiquadro.flatMap((voce) => voce.ignorati))];
                  // Cosa il filtro dal grafico fa a QUESTO riquadro: se e' il suo
                  // stesso grafico, la voce resta evidenziata (e gli altri si
                  // attenuano); se e' un altro, il riquadro si ricalcola e lo dice;
                  // se la dimensione non lo riguarda, dice che non e' collegato.
                  const dimensioniQui = riquadro.analisi.spec.raggruppa ?? [];
                  const selezionataQui =
                    dimensioniQui.length === 1
                      ? String(incrociati.find((f) => f.campo === dimensioniQui[0])?.valore ?? "") || null
                      : null;
                  const filtratoDa = incrociati.filter(
                    (f) => !dimensioniQui.includes(f.campo) && !ignorati.includes(f.campo)
                  );
                  const nonCollegato = incrociati.filter(
                    (f) => !dimensioniQui.includes(f.campo) && ignorati.includes(f.campo)
                  );
                  const serieEseguite = batchRiquadro.flatMap((voce): SerieAnalisiEseguita[] => {
                    const risultato = risultati[voce.id];
                    return risultato
                      ? [{ ruolo: voce.ruolo, nome: voce.nome, spec: voce.spec, risultato }]
                      : [];
                  });
                  const erroreRiquadro = batchRiquadro
                    .map((voce) => erroriRiquadri[voce.id])
                    .find(Boolean);
                  return (
                    <article key={riquadro.id} onClickCapture={(e) => { clicPerDocumenti.current = e.ctrlKey || e.altKey || e.metaKey; }} className={`col-span-12 min-w-0 rounded-xl border border-border bg-bg ${COLONNE[riquadro.larghezza] ?? "lg:col-span-6"}`}>
                      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                        <div className="min-w-0"><h2 className="truncate font-tenorite text-base font-bold">{riquadro.titolo || riquadro.analisi.titolo}</h2>{ignorati.length > 0 && <p className="mt-1 text-[11px] text-text-muted">Filtro {ignorati.map((v) => v === "bu" ? "business unit" : v).join(", ")} fissato dentro il riquadro</p>}
                          {filtratoDa.length > 0 && <p className="mt-1 inline-flex flex-wrap items-center gap-1 text-[11px] font-medium text-primary" data-testid="filtrato-da"><Filter className="h-3 w-3" aria-hidden />Filtrato da {filtratoDa.map((f) => `${DIMENSIONI[f.campo]?.etichetta ?? f.campo}: ${String(f.valore)}`).join(" · ")}</p>}
                          {nonCollegato.length > 0 && <p className="mt-1 text-[11px] text-text-muted" data-testid="non-collegato">Non collegato a {nonCollegato.map((f) => DIMENSIONI[f.campo]?.etichetta ?? f.campo).join(", ")}</p>}</div>
                        <div className="flex items-center gap-1">
                          {/* Come «Esporta dati» di Power BI: il risultato del riquadro com'e' ora, con i filtri della pagina, in un foglio Excel. */}
                          <button type="button" onClick={() => void esportaRiquadro(riquadro.titolo || riquadro.analisi.titolo, serieEseguite)} disabled={Boolean(erroreRiquadro) || serieEseguite.length !== batchRiquadro.length} className="rounded-md p-1.5 text-text-muted hover:bg-bg-page hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30" aria-label={`Esporta ${riquadro.titolo || riquadro.analisi.titolo} in Excel`} title="Esporta in Excel"><Download className="h-4 w-4" aria-hidden /></button>
                        {modificabile && <>
                          <button type="button" onClick={() => spostaRiquadro(indice, -1)} disabled={indice === 0} className="rounded-md p-1.5 text-text-muted hover:bg-bg-page hover:text-text disabled:opacity-30" aria-label="Sposta prima"><ChevronLeft className="h-4 w-4" /></button>
                          <button type="button" onClick={() => spostaRiquadro(indice, 1)} disabled={indice === paginaAttiva.riquadri.length - 1} className="rounded-md p-1.5 text-text-muted hover:bg-bg-page hover:text-text disabled:opacity-30" aria-label="Sposta dopo"><ChevronRight className="h-4 w-4" /></button>
                          <select aria-label={`Larghezza di ${riquadro.analisi.titolo}`} value={riquadro.larghezza} onChange={(e) => { const larghezza = Number(e.target.value); const aggiornato = { ...riquadro, larghezza }; void aggiornaRiquadri(paginaAttiva.riquadri.map((r) => r.id === riquadro.id ? aggiornato : r), [{ id: riquadro.id, larghezza }]); }} className="h-8 rounded-md border border-border bg-bg-page px-1.5 text-xs outline-none focus:ring-2 focus:ring-primary"><option value={3}>3/12</option><option value={4}>4/12</option><option value={6}>6/12</option><option value={8}>8/12</option><option value={9}>9/12</option><option value={12}>12/12</option></select>
                          <div className="w-40"><SceltaGrafico compatto etichetta={`Grafico di ${riquadro.analisi.titolo}`} valore={riquadro.grafico ?? riquadro.analisi.grafico ?? "barre"} opzioni={TIPI_GRAFICO} onChange={(grafico) => { const aggiornato = { ...riquadro, grafico }; void aggiornaRiquadri(paginaAttiva.riquadri.map((r) => r.id === riquadro.id ? aggiornato : r), [{ id: riquadro.id, grafico }]); }} /></div>
                          {/*
                            Riaprire un riquadro nel builder serve a correggerlo
                            senza rifarlo, e a vedere com'e' fatto: quelli
                            composti dall'AI sono lo stesso oggetto di quelli
                            fatti a mano, e aprirli e' il modo piu' rapido per
                            imparare a comporli.
                          */}
                          <Link href={`/bi/esplora?analisi=${encodeURIComponent(riquadro.analisi_id)}`} className="rounded-md p-1.5 text-text-muted hover:bg-bg-page hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Modifica ${riquadro.analisi.titolo}`} title="Apri nel builder"><Pencil className="h-4 w-4" /></Link>
                          <button type="button" onClick={() => void togliRiquadro(riquadro.id)} className="rounded-md p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger" aria-label="Togli riquadro"><Trash2 className="h-4 w-4" /></button>
                        </>}
                        </div>
                      </header>
                      <div className="min-h-48 p-4">
                        {erroreRiquadro ? <div className="flex min-h-40 items-center justify-center text-center text-sm text-danger">{erroreRiquadro}</div> : serieEseguite.length === batchRiquadro.length ? <GraficoDaAnalisi serie={serieEseguite} selezionata={selezionataQui} aspetto={riquadro.analisi.aspetto} tipo={riquadro.grafico ?? riquadro.analisi.grafico ?? undefined} altezza={Math.max(180, Math.min(480, riquadro.altezza * 60))} onClickEtichetta={(etichetta) => cliccaEtichetta(riquadro, etichetta)} /> : <div className="flex min-h-40 items-center justify-center text-sm text-text-muted"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden />Calcolo in corso…</div>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <PannelloDettaglio richiesta={dettaglio} onChiudi={() => setDettaglio(null)} />
    </main>
  );
}
