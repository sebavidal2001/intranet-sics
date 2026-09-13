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

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
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
import { GraficoDaRisultato } from "./grafico-da-risultato";
import {
  fondiFiltriPaginaConEsito,
  type FiltriPagina,
} from "@/lib/prototipo-bi/filtri-pagina";
import type { TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type { RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

export interface AnalisiDashboard {
  id: string;
  titolo: string;
  descrizione: string | null;
  spec: SpecQuery;
  grafico: TipoGrafico | null;
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

const GRAFICI: Array<{ valore: TipoGrafico; etichetta: string }> = [
  { valore: "barre", etichetta: "Barre" },
  { valore: "linee", etichetta: "Linee" },
  { valore: "combo", etichetta: "Combinato" },
  { valore: "torta", etichetta: "Torta" },
  { valore: "anelli", etichetta: "Anelli" },
  { valore: "areeImpilate", etichetta: "Aree impilate" },
  { valore: "pareto", etichetta: "Pareto" },
  { valore: "heatmap", etichetta: "Mappa di calore" },
  { valore: "quadranti", etichetta: "Quadranti" },
  { valore: "imbuto", etichetta: "Imbuto" },
  { valore: "treemap", etichetta: "Composizione" },
  { valore: "sparkline", etichetta: "Sparkline" },
  { valore: "kpi", etichetta: "KPI" },
  { valore: "tabella", etichetta: "Tabella" },
];

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
  const [pannelloAnalisi, setPannelloAnalisi] = useState(false);
  const [azioneInCorso, setAzioneInCorso] = useState(false);
  const [duplicazioneInCorso, setDuplicazioneInCorso] = useState(false);

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

  const specsBatch = useMemo(() => {
    if (!paginaAttiva) return [];
    return paginaAttiva.riquadri.map((riquadro) => {
      const fusione = fondiFiltriPaginaConEsito(riquadro.analisi.spec, filtriPuliti(paginaAttiva.filtri));
      return { id: riquadro.id, spec: fusione.spec, ignorati: fusione.filtriPaginaIgnorati };
    });
  }, [paginaAttiva]);

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
  }, [specsBatch]);

  const modificabile = dashboard?.modificabile ?? Boolean(dashboardIniziale);

  function sostituisciPagina(pagina: PaginaDashboard) {
    setDashboard((corrente) => corrente ? {
      ...corrente,
      pagine: corrente.pagine.map((voce) => voce.id === pagina.id ? pagina : voce),
    } : corrente);
  }

  async function salvaFiltriPagina() {
    if (!dashboard || !paginaAttiva || !modificabile) return;
    const risposta = await fetch(`/api/bi/dashboard/${dashboard.id}/pagine`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagine: [{ id: paginaAttiva.id, filtri: paginaAttiva.filtri }] }),
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
    setPannelloAnalisi(false);
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
  const filtriModificabili = modificabile || dashboard.di_sistema === true;
  const modalitaPeriodo = filtri.periodo?.anno !== undefined ? "anno" : "intervallo";

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
            {modificabile && <button type="button" onClick={() => void duplicaDashboard()} disabled={duplicazioneInCorso} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-bg px-3 text-sm font-semibold text-text hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
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
                  onChange={(evento) => aggiornaFiltri({ ...filtri, periodo: evento.target.value === "anno" ? { anno: new Date().getFullYear() } : {} })}
                  onBlur={() => void salvaFiltriPagina()}
                  className="h-9 rounded-lg border border-border bg-bg-page px-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                >
                  <option value="anno">Anno</option><option value="intervallo">Dal / al</option>
                </select>
              </label>
              {modalitaPeriodo === "anno" ? (
                <label className="text-xs text-text-muted"><span className="mb-1 block">Anno</span><input type="number" value={filtri.periodo?.anno ?? new Date().getFullYear()} disabled={!filtriModificabili} onChange={(e) => aggiornaFiltri({ ...filtri, periodo: { anno: Number(e.target.value) } })} onBlur={() => void salvaFiltriPagina()} className="h-9 w-24 rounded-lg border border-border bg-bg-page px-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary disabled:opacity-60" /></label>
              ) : (
                <>
                  <label className="text-xs text-text-muted"><span className="mb-1 block">Dal</span><input type="date" value={filtri.periodo?.dal ?? ""} disabled={!filtriModificabili} onChange={(e) => aggiornaFiltri({ ...filtri, periodo: { ...filtri.periodo, anno: undefined, dal: e.target.value || undefined } })} onBlur={() => void salvaFiltriPagina()} className="h-9 rounded-lg border border-border bg-bg-page px-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary disabled:opacity-60" /></label>
                  <label className="text-xs text-text-muted"><span className="mb-1 block">Al</span><input type="date" value={filtri.periodo?.al ?? ""} disabled={!filtriModificabili} onChange={(e) => aggiornaFiltri({ ...filtri, periodo: { ...filtri.periodo, anno: undefined, al: e.target.value || undefined } })} onBlur={() => void salvaFiltriPagina()} className="h-9 rounded-lg border border-border bg-bg-page px-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary disabled:opacity-60" /></label>
                </>
              )}
              <label className="min-w-44 flex-1 text-xs text-text-muted"><span className="mb-1 block">Business unit</span><input value={filtri.bu ?? ""} disabled={!filtriModificabili} onChange={(e) => aggiornaFiltri({ ...filtri, bu: e.target.value || undefined })} onBlur={() => void salvaFiltriPagina()} placeholder="Tutte" className="h-9 w-full rounded-lg border border-border bg-bg-page px-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary disabled:opacity-60" /></label>
              <label className="min-w-44 flex-1 text-xs text-text-muted"><span className="mb-1 block">Agente</span><input value={filtri.agente ?? ""} disabled={!filtriModificabili} onChange={(e) => aggiornaFiltri({ ...filtri, agente: e.target.value || undefined })} onBlur={() => void salvaFiltriPagina()} placeholder="Tutti" className="h-9 w-full rounded-lg border border-border bg-bg-page px-2.5 text-sm text-text outline-none focus:ring-2 focus:ring-primary disabled:opacity-60" /></label>
              {modificabile ? <button type="button" onClick={() => setPannelloAnalisi(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-bg transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus className="h-4 w-4" aria-hidden />Aggiungi</button> : paginaAttiva.riquadri.length > 0 ? <button type="button" onClick={() => void duplicaDashboard()} disabled={duplicazioneInCorso} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-bg transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">{duplicazioneInCorso ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}Duplica per modificare</button> : null}
            </section>

            {errore && <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger"><span>{errore}</span><button type="button" onClick={() => setErrore(null)} aria-label="Chiudi avviso"><X className="h-4 w-4" /></button></div>}

            {pannelloAnalisi && (
              <AggiungiRiquadro
                paginaId={paginaAttiva.id}
                filtriPagina={paginaAttiva.filtri}
                analisiPresenti={paginaAttiva.riquadri.map((riquadro) => riquadro.analisi_id)}
                onAggiunta={registraRiquadro}
                onChiudi={() => setPannelloAnalisi(false)}
              />
            )}

            {paginaAttiva.riquadri.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center border-y border-dashed border-border py-12 text-center"><BarChart3 className="mb-3 h-8 w-8 text-primary" aria-hidden /><h2 className="font-tenorite text-xl font-bold">Questa pagina è pronta per la prima analisi</h2><p className="mt-1 max-w-md text-sm text-text-muted">{modificabile ? "Aggiungi una domanda salvata: verrà eseguita con questi filtri e con il tuo perimetro dati." : "Questa dashboard è condivisa e non si modifica direttamente. Crea una copia personale per aggiungere la tua prima analisi."}</p>{modificabile ? <button type="button" onClick={() => setPannelloAnalisi(true)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-bg"><Plus className="h-4 w-4" aria-hidden />Aggiungi</button> : <button type="button" onClick={() => void duplicaDashboard()} disabled={duplicazioneInCorso} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50">{duplicazioneInCorso ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}Duplica per modificare</button>}</div>
            ) : (
              <div className="grid grid-cols-12 gap-4">
                {paginaAttiva.riquadri.map((riquadro, indice) => {
                  const batch = specsBatch.find((voce) => voce.id === riquadro.id);
                  const risultato = risultati[riquadro.id];
                  return (
                    <article key={riquadro.id} className={`col-span-12 min-w-0 rounded-xl border border-border bg-bg ${COLONNE[riquadro.larghezza] ?? "lg:col-span-6"}`}>
                      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                        <div className="min-w-0"><h2 className="truncate font-tenorite text-base font-bold">{riquadro.titolo || riquadro.analisi.titolo}</h2>{batch && batch.ignorati.length > 0 && <p className="mt-1 text-[11px] text-text-muted">Filtro {batch.ignorati.map((v) => v === "bu" ? "business unit" : v).join(", ")} definito dall’analisi</p>}</div>
                        {modificabile && <div className="flex items-center gap-1">
                          <button type="button" onClick={() => spostaRiquadro(indice, -1)} disabled={indice === 0} className="rounded-md p-1.5 text-text-muted hover:bg-bg-page hover:text-text disabled:opacity-30" aria-label="Sposta prima"><ChevronLeft className="h-4 w-4" /></button>
                          <button type="button" onClick={() => spostaRiquadro(indice, 1)} disabled={indice === paginaAttiva.riquadri.length - 1} className="rounded-md p-1.5 text-text-muted hover:bg-bg-page hover:text-text disabled:opacity-30" aria-label="Sposta dopo"><ChevronRight className="h-4 w-4" /></button>
                          <select aria-label={`Larghezza di ${riquadro.analisi.titolo}`} value={riquadro.larghezza} onChange={(e) => { const larghezza = Number(e.target.value); const aggiornato = { ...riquadro, larghezza }; void aggiornaRiquadri(paginaAttiva.riquadri.map((r) => r.id === riquadro.id ? aggiornato : r), [{ id: riquadro.id, larghezza }]); }} className="h-8 rounded-md border border-border bg-bg-page px-1.5 text-xs outline-none focus:ring-2 focus:ring-primary"><option value={3}>3/12</option><option value={4}>4/12</option><option value={6}>6/12</option><option value={8}>8/12</option><option value={9}>9/12</option><option value={12}>12/12</option></select>
                          <select aria-label={`Grafico di ${riquadro.analisi.titolo}`} value={riquadro.grafico ?? riquadro.analisi.grafico ?? "barre"} onChange={(e) => { const grafico = e.target.value as TipoGrafico; const aggiornato = { ...riquadro, grafico }; void aggiornaRiquadri(paginaAttiva.riquadri.map((r) => r.id === riquadro.id ? aggiornato : r), [{ id: riquadro.id, grafico }]); }} className="h-8 max-w-32 rounded-md border border-border bg-bg-page px-1.5 text-xs outline-none focus:ring-2 focus:ring-primary">{GRAFICI.map((grafico) => <option key={grafico.valore} value={grafico.valore}>{grafico.etichetta}</option>)}</select>
                          <button type="button" onClick={() => void togliRiquadro(riquadro.id)} className="rounded-md p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger" aria-label="Togli riquadro"><Trash2 className="h-4 w-4" /></button>
                        </div>}
                      </header>
                      <div className="min-h-48 p-4">
                        {erroriRiquadri[riquadro.id] ? <div className="flex min-h-40 items-center justify-center text-center text-sm text-danger">{erroriRiquadri[riquadro.id]}</div> : risultato ? <GraficoDaRisultato risultato={risultato} tipo={riquadro.grafico ?? riquadro.analisi.grafico ?? undefined} altezza={Math.max(180, Math.min(480, riquadro.altezza * 60))} /> : <div className="flex min-h-40 items-center justify-center text-sm text-text-muted"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden />Calcolo in corso…</div>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
