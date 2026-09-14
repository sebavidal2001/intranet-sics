"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Gauge,
  LayoutDashboard,
  Library,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";

/**
 * Questa pagina è diventata il punto d’ingresso unico ai dati organizzati.
 *
 * Prima la barra offriva Cruscotto, Dashboard e Analisi come tre destinazioni
 * separate, e nessuna delle tre diceva cosa fosse rispetto alle altre. La
 * duplicazione più fastidiosa era fra il Cruscotto storico — completo, con i
 * pannelli compositi — e la sua versione a dashboard, che ne contiene solo i
 * riquadri esprimibili come una sola query.
 *
 * Le due restano due cose diverse perché lo sono davvero, ma ora convivono in
 * una riga sola che dice a voce alta quale serve a cosa: il Cruscotto per
 * leggere, la sua copia per modificare.
 */

interface DashboardElenco {
  id: string;
  titolo: string;
  descrizione: string | null;
  visibilita: "privata" | "condivisa";
  conteggio_pagine: number;
  aggiornato_il: string;
  di_sistema: boolean;
  modificabile: boolean;
}

function erroreDa(valore: unknown, ripiego: string): string {
  if (valore && typeof valore === "object" && "error" in valore && typeof valore.error === "string") {
    return valore.error;
  }
  return ripiego;
}

export function DashboardList() {
  const [dashboard, setDashboard] = useState<DashboardElenco[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [creazione, setCreazione] = useState(false);
  const [salvataggio, setSalvataggio] = useState(false);
  const [titolo, setTitolo] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [visibilita, setVisibilita] = useState<"privata" | "condivisa">("privata");
  const [modificaId, setModificaId] = useState<string | null>(null);
  const [titoloModifica, setTitoloModifica] = useState("");
  const [azioneInCorso, setAzioneInCorso] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/bi/dashboard")
      .then(async (risposta) => {
        const corpo = (await risposta.json()) as { dashboard?: DashboardElenco[]; error?: string };
        if (!risposta.ok) throw new Error(erroreDa(corpo, "Impossibile leggere le dashboard."));
        setDashboard(corpo.dashboard ?? []);
      })
      .catch((causa: unknown) => setErrore(causa instanceof Error ? causa.message : "Impossibile leggere le dashboard."))
      .finally(() => setCaricamento(false));
  }, []);

  async function creaDashboard(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!titolo.trim()) return;
    setSalvataggio(true);
    setErrore(null);
    const risposta = await fetch("/api/bi/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titolo: titolo.trim(), descrizione: descrizione.trim() || undefined, visibilita }),
    });
    const corpo = (await risposta.json()) as { dashboard?: { id: string }; error?: string };
    if (risposta.ok && corpo.dashboard) {
      window.location.assign(`/bi/dashboard/${corpo.dashboard.id}`);
      return;
    }
    setErrore(erroreDa(corpo, "Impossibile creare la dashboard."));
    setSalvataggio(false);
  }

  async function rinominaDashboard(evento: React.FormEvent<HTMLFormElement>, voce: DashboardElenco) {
    evento.preventDefault();
    const nuovoTitolo = titoloModifica.trim();
    if (!nuovoTitolo || azioneInCorso) return;
    setAzioneInCorso(`rinomina-${voce.id}`);
    setErrore(null);
    try {
      const risposta = await fetch(`/api/bi/dashboard/${voce.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titolo: nuovoTitolo }),
      });
      const corpo: unknown = await risposta.json();
      if (!risposta.ok) throw new Error(erroreDa(corpo, "Impossibile rinominare la dashboard."));
      setDashboard((correnti) => correnti.map((dashboardCorrente) =>
        dashboardCorrente.id === voce.id ? { ...dashboardCorrente, titolo: nuovoTitolo } : dashboardCorrente
      ));
      setModificaId(null);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile rinominare la dashboard.");
    } finally {
      setAzioneInCorso(null);
    }
  }

  async function eliminaDashboard(voce: DashboardElenco) {
    if (!window.confirm(`Eliminare definitivamente la dashboard “${voce.titolo}” e tutte le sue pagine?`)) return;
    setAzioneInCorso(`elimina-${voce.id}`);
    setErrore(null);
    try {
      const risposta = await fetch(`/api/bi/dashboard/${voce.id}`, { method: "DELETE" });
      const corpo: unknown = await risposta.json();
      if (!risposta.ok) throw new Error(erroreDa(corpo, "Impossibile eliminare la dashboard."));
      setDashboard((correnti) => correnti.filter((dashboardCorrente) => dashboardCorrente.id !== voce.id));
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile eliminare la dashboard.");
    } finally {
      setAzioneInCorso(null);
    }
  }

  return (
    <main className="flex-1 bg-bg-page px-4 py-8 text-text sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-tenorite text-3xl font-bold tracking-[-0.02em]">Dashboard</h1>
            <p className="mt-1 max-w-2xl text-sm text-text-muted">Pagine operative che combinano analisi salvate e le ricalcolano sul perimetro di chi le apre.</p>
          </div>
          <button type="button" onClick={() => setCreazione(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-bg transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus className="h-4 w-4" aria-hidden />Nuova dashboard</button>
        </header>

        {/*
          Il Cruscotto e la libreria non sono più voci di menu: chi li cerca li
          trova qui, con una riga che dice a cosa servono invece di lasciarlo
          dedurre dal nome.
        */}
        <nav aria-label="Altre viste" className="mb-8 grid gap-3 sm:grid-cols-2">
          <Link href="/bi/cruscotto" className="group flex items-start gap-3 rounded-xl border border-border bg-bg p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Gauge className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0">
              <span className="block font-tenorite text-base font-semibold group-hover:text-primary">Cruscotto direzionale</span>
              <span className="mt-0.5 block text-sm text-text-muted">Le sei schede complete, già pronte da leggere: sintesi, scostamenti, clienti, preventivi, conversione, back office.</span>
            </span>
          </Link>
          <Link href="/bi/analisi" className="group flex items-start gap-3 rounded-xl border border-border bg-bg p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Library className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0">
              <span className="block font-tenorite text-base font-semibold group-hover:text-primary">Analisi salvate</span>
              <span className="mt-0.5 block text-sm text-text-muted">La libreria da cui pescare un riquadro già fatto, o da cui riaprire e correggere un’analisi.</span>
            </span>
          </Link>
        </nav>

        {errore && <div role="alert" className="mb-5 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{errore}</div>}

        {creazione && (
          <form onSubmit={(evento) => void creaDashboard(evento)} className="mb-7 rounded-xl border border-border bg-bg p-5">
            <div className="mb-4 flex items-start justify-between gap-4"><div><h2 className="font-tenorite text-xl font-bold">Nuova dashboard</h2><p className="mt-1 text-xs text-text-muted">La prima pagina viene creata subito, così la dashboard è pronta da aprire.</p></div><button type="button" onClick={() => setCreazione(false)} className="rounded-lg p-2 text-text-muted hover:bg-bg-page" aria-label="Chiudi"><X className="h-4 w-4" /></button></div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto_auto] sm:items-end">
              <label className="text-xs text-text-muted"><span className="mb-1 block">Titolo</span><input autoFocus required value={titolo} onChange={(e) => setTitolo(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-bg-page px-3 text-sm text-text outline-none focus:ring-2 focus:ring-primary" /></label>
              <label className="text-xs text-text-muted"><span className="mb-1 block">Descrizione</span><input value={descrizione} onChange={(e) => setDescrizione(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-bg-page px-3 text-sm text-text outline-none focus:ring-2 focus:ring-primary" /></label>
              <label className="text-xs text-text-muted"><span className="mb-1 block">Visibilità</span><select value={visibilita} onChange={(e) => setVisibilita(e.target.value as "privata" | "condivisa")} className="h-10 rounded-lg border border-border bg-bg-page px-3 text-sm text-text outline-none focus:ring-2 focus:ring-primary"><option value="privata">Privata</option><option value="condivisa">Condivisa</option></select></label>
              <button type="submit" disabled={salvataggio || !titolo.trim()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">{salvataggio && <LoaderCircle className="h-4 w-4 animate-spin" />}Crea</button>
            </div>
          </form>
        )}

        {caricamento ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-text-muted"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden />Carico le dashboard…</div>
        ) : dashboard.length === 0 ? (
          <section className="flex min-h-64 flex-col items-center justify-center border-y border-dashed border-border py-10 text-center"><LayoutDashboard className="mb-3 h-8 w-8 text-primary" aria-hidden /><h2 className="font-tenorite text-xl font-bold">Ancora nessuna dashboard</h2><p className="mt-1 max-w-md text-sm text-text-muted">Crea uno spazio per riunire le analisi che consulti insieme.</p><button type="button" onClick={() => setCreazione(true)} className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-bg hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus className="h-4 w-4" aria-hidden />Crea la prima dashboard</button></section>
        ) : (
          <div className="divide-y divide-border border-y border-border bg-bg">
            {dashboard.map((voce) => (
              <article key={voce.id} className="grid gap-4 px-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  {modificaId === voce.id ? (
                    <form onSubmit={(evento) => void rinominaDashboard(evento, voce)} className="flex max-w-xl items-center gap-2">
                      <input autoFocus aria-label={`Nuovo titolo di ${voce.titolo}`} value={titoloModifica} onChange={(evento) => setTitoloModifica(evento.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg-page px-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
                      <button type="submit" disabled={!titoloModifica.trim() || azioneInCorso !== null} className="rounded-lg p-2 text-primary hover:bg-bg-page disabled:opacity-50" aria-label="Salva titolo">{azioneInCorso === `rinomina-${voce.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}</button>
                      <button type="button" onClick={() => setModificaId(null)} className="rounded-lg p-2 text-text-muted hover:bg-bg-page" aria-label="Annulla rinomina"><X className="h-4 w-4" aria-hidden /></button>
                    </form>
                  ) : (
                    <Link href={`/bi/dashboard/${voce.id}`} className="group block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-tenorite text-lg font-bold group-hover:text-primary">{voce.titolo}</h2>{voce.di_sistema ? <span className="inline-flex items-center gap-1 rounded-full border border-primary px-2 py-0.5 text-[11px] font-semibold text-primary"><LayoutDashboard className="h-3 w-3" aria-hidden />Cruscotto di sistema</span> : voce.visibilita === "condivisa" ? <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted"><Users className="h-3 w-3" aria-hidden />Condivisa</span> : null}</div>
                      {voce.descrizione && <p className="mt-1 text-sm text-text-muted">{voce.descrizione}</p>}
                      {voce.di_sistema && <p className="mt-2 text-xs text-text-muted">È la copia modificabile del Cruscotto: contiene i riquadri che nascono da una sola domanda, non i pannelli compositi. Duplicala per costruirci sopra la tua versione.</p>}
                    </Link>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-text-muted">
                  <span>{voce.conteggio_pagine} {voce.conteggio_pagine === 1 ? "pagina" : "pagine"}</span>
                  <span>{new Date(voce.aggiornato_il).toLocaleDateString("it-IT")}</span>
                  {voce.modificabile && <button type="button" onClick={() => { setModificaId(voce.id); setTitoloModifica(voce.titolo); }} className="rounded-lg p-2 text-text-muted hover:bg-bg-page hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Rinomina ${voce.titolo}`}><Pencil className="h-4 w-4" aria-hidden /></button>}
                  {voce.modificabile && <button type="button" onClick={() => void eliminaDashboard(voce)} disabled={azioneInCorso !== null} className="rounded-lg p-2 text-text-muted hover:bg-bg-page hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50" aria-label={`Elimina ${voce.titolo}`}>{azioneInCorso === `elimina-${voce.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}</button>}
                  <Link href={`/bi/dashboard/${voce.id}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold text-primary hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Apri<ArrowRight className="h-4 w-4" aria-hidden /></Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
