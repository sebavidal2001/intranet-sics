/**
 * La libreria esiste perché un'analisi salvata deve restare ritrovabile e
 * gestibile anche fuori dalla dashboard in cui è nata.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Copy,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import type { TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type { SerieAnalisi, SpecQuery } from "@/lib/prototipo-bi/tipi";

interface UtilizzoAnalisi {
  dashboard_id: string;
  dashboard_titolo: string;
  pagina_id: string;
  pagina_titolo: string;
}

interface AnalisiElenco {
  id: string;
  titolo: string;
  descrizione: string | null;
  spec: SpecQuery;
  serie?: SerieAnalisi[] | null;
  grafico: TipoGrafico | null;
  autore_id: string;
  visibilita: "privata" | "condivisa";
  aggiornato_il: string;
  chiave: string | null;
  modificabile: boolean;
  utilizzi: UtilizzoAnalisi[];
}

function erroreDa(valore: unknown, ripiego: string): string {
  if (valore && typeof valore === "object" && "error" in valore && typeof valore.error === "string") {
    return valore.error;
  }
  return ripiego;
}

function descriviUtilizzi(analisi: AnalisiElenco): string {
  if (analisi.utilizzi.length === 0) return "";
  return analisi.utilizzi
    .map((utilizzo) => `${utilizzo.dashboard_titolo} / ${utilizzo.pagina_titolo}`)
    .join(", ");
}

export function AnalisiList() {
  const [analisi, setAnalisi] = useState<AnalisiElenco[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [azioneInCorso, setAzioneInCorso] = useState<string | null>(null);

  const carica = useCallback(async () => {
    setCaricamento(true);
    setErrore(null);
    try {
      const risposta = await fetch("/api/bi/analisi");
      const corpo = (await risposta.json()) as { analisi?: AnalisiElenco[]; error?: string };
      if (!risposta.ok) throw new Error(erroreDa(corpo, "Impossibile leggere le analisi."));
      setAnalisi(corpo.analisi ?? []);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile leggere le analisi.");
    } finally {
      setCaricamento(false);
    }
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  async function duplica(voce: AnalisiElenco) {
    setAzioneInCorso(`duplica-${voce.id}`);
    setErrore(null);
    try {
      const risposta = await fetch("/api/bi/analisi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titolo: `${voce.titolo} — copia`,
          descrizione: voce.descrizione ?? undefined,
          spec: voce.spec,
          serie: voce.serie,
          grafico: voce.grafico ?? undefined,
          visibilita: "privata",
        }),
      });
      const corpo = (await risposta.json()) as { analisi?: AnalisiElenco; error?: string };
      if (!risposta.ok || !corpo.analisi) {
        throw new Error(erroreDa(corpo, "Impossibile duplicare l'analisi."));
      }
      await carica();
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile duplicare l'analisi.");
    } finally {
      setAzioneInCorso(null);
    }
  }

  async function elimina(voce: AnalisiElenco) {
    const utilizzi = descriviUtilizzi(voce);
    const avviso = utilizzi
      ? `L'analisi “${voce.titolo}” è usata in ${utilizzi}. Eliminandola verranno rimossi anche quei riquadri. Vuoi continuare?`
      : `Eliminare definitivamente l'analisi “${voce.titolo}”?`;
    if (!window.confirm(avviso)) return;

    setAzioneInCorso(`elimina-${voce.id}`);
    setErrore(null);
    try {
      const risposta = await fetch(`/api/bi/analisi?id=${encodeURIComponent(voce.id)}`, {
        method: "DELETE",
      });
      const corpo: unknown = await risposta.json();
      if (!risposta.ok) throw new Error(erroreDa(corpo, "Impossibile eliminare l'analisi."));
      setAnalisi((correnti) => correnti.filter((analisiCorrente) => analisiCorrente.id !== voce.id));
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile eliminare l'analisi.");
    } finally {
      setAzioneInCorso(null);
    }
  }

  return (
    <main className="flex-1 bg-bg-page px-4 py-8 text-text sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-tenorite text-3xl font-bold tracking-[-0.02em]">Analisi</h1>
            <p className="mt-1 max-w-2xl text-sm text-text-muted">
              Le domande certificate che hai creato e quelle condivise con te. Da qui puoi riaprirle o usarle nelle dashboard.
            </p>
          </div>
          <Link href="/bi/esplora" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-bg transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Plus className="h-4 w-4" aria-hidden />
            Nuova analisi
          </Link>
        </header>

        {errore && (
          <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger bg-bg p-3 text-sm text-danger">
            <span>{errore}</span>
            <button type="button" onClick={() => void carica()} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <RefreshCw className="h-4 w-4" aria-hidden />
              Riprova
            </button>
          </div>
        )}

        {caricamento ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-text-muted">
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            Carico le analisi…
          </div>
        ) : analisi.length === 0 ? (
          <section className="flex min-h-64 flex-col items-center justify-center border-y border-dashed border-border py-10 text-center">
            <BarChart3 className="mb-3 h-9 w-9 text-primary" aria-hidden />
            <h2 className="font-tenorite text-xl font-bold">Ancora nessuna analisi</h2>
            <p className="mt-1 max-w-md text-sm text-text-muted">
              Crea una domanda certificata: resterà qui e potrai aggiungerla a qualsiasi dashboard.
            </p>
            <Link href="/bi/esplora" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-bg hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <Plus className="h-4 w-4" aria-hidden />
              Crea la prima analisi
            </Link>
          </section>
        ) : (
          <div className="divide-y divide-border border-y border-border bg-bg">
            {analisi.map((voce) => {
              const duplicazione = azioneInCorso === `duplica-${voce.id}`;
              const eliminazione = azioneInCorso === `elimina-${voce.id}`;
              return (
                <article key={voce.id} className="grid gap-4 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-tenorite text-lg font-bold">{voce.titolo}</h2>
                      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">
                        {voce.visibilita === "condivisa" ? <Users className="h-3 w-3" aria-hidden /> : null}
                        {voce.chiave ? "Di sistema" : voce.modificabile ? "Propria" : "Condivisa"}
                      </span>
                    </div>
                    {voce.descrizione && <p className="mt-1 text-sm text-text-muted">{voce.descrizione}</p>}
                    <p className="mt-2 text-xs text-text-muted">
                      Aggiornata il {new Date(voce.aggiornato_il).toLocaleDateString("it-IT")}
                    </p>
                    {voce.utilizzi.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        <LayoutDashboard className="h-4 w-4 text-primary" aria-hidden />
                        <span>Usata in</span>
                        {voce.utilizzi.map((utilizzo) => (
                          <Link key={`${utilizzo.pagina_id}-${voce.id}`} href={`/bi/dashboard/${utilizzo.dashboard_id}`} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            {utilizzo.dashboard_titolo} / {utilizzo.pagina_titolo}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-text-muted">Non ancora usata in una dashboard.</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/bi/esplora?analisi=${encodeURIComponent(voce.id)}`} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-primary hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      {voce.modificabile ? "Apri nell’editor" : "Apri come copia"}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                    <button type="button" onClick={() => void duplica(voce)} disabled={azioneInCorso !== null} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
                      {duplicazione ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                      Duplica
                    </button>
                    {voce.modificabile && (
                      <button type="button" onClick={() => void elimina(voce)} disabled={azioneInCorso !== null} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-danger hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
                        {eliminazione ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                        Elimina
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
