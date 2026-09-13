"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, LayoutDashboard, LoaderCircle, Plus, Users, X } from "lucide-react";

interface DashboardElenco {
  id: string;
  titolo: string;
  descrizione: string | null;
  visibilita: "privata" | "condivisa";
  conteggio_pagine: number;
  aggiornato_il: string;
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

  return (
    <main className="flex-1 bg-bg-page px-4 py-8 text-text sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-tenorite text-3xl font-bold tracking-[-0.02em]">Dashboard</h1>
            <p className="mt-1 max-w-2xl text-sm text-text-muted">Pagine operative che combinano analisi salvate e le ricalcolano sul perimetro di chi le apre.</p>
          </div>
          <button type="button" onClick={() => setCreazione(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Plus className="h-4 w-4" aria-hidden />Nuova dashboard</button>
        </header>

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
          <section className="flex min-h-64 flex-col items-center justify-center border-y border-dashed border-border text-center"><LayoutDashboard className="mb-3 h-8 w-8 text-primary" aria-hidden /><h2 className="font-tenorite text-xl font-bold">Ancora nessuna dashboard</h2><p className="mt-1 max-w-md text-sm text-text-muted">Crea uno spazio per riunire le analisi che consulti insieme.</p></section>
        ) : (
          <div className="divide-y divide-border border-y border-border bg-bg">
            {dashboard.map((voce) => (
              <Link key={voce.id} href={`/bi/dashboard/${voce.id}`} className="group grid gap-3 px-4 py-5 transition-colors hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-tenorite text-lg font-bold group-hover:text-primary">{voce.titolo}</h2>{voce.visibilita === "condivisa" && <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted"><Users className="h-3 w-3" aria-hidden />Condivisa</span>}</div>{voce.descrizione && <p className="mt-1 truncate text-sm text-text-muted">{voce.descrizione}</p>}</div>
                <div className="flex items-center gap-4 text-xs text-text-muted"><span>{voce.conteggio_pagine} {voce.conteggio_pagine === 1 ? "pagina" : "pagine"}</span><span>{new Date(voce.aggiornato_il).toLocaleDateString("it-IT")}</span><ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-1" aria-hidden /></div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
