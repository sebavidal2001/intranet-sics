/**
 * Il raccordo rende esplicito che il Cruscotto storico ha una versione nel
 * sistema Dashboard e consente di raggiungerla o copiarla con un solo gesto.
 */

"use client";

import { useState } from "react";
import { Copy, ExternalLink, LoaderCircle } from "lucide-react";

interface DashboardSistema {
  id: string;
  di_sistema?: boolean;
}

function messaggioErrore(valore: unknown, ripiego: string): string {
  if (valore && typeof valore === "object" && "error" in valore && typeof valore.error === "string") {
    return valore.error;
  }
  return ripiego;
}

export function RaccordoCruscottoDashboard() {
  const [azione, setAzione] = useState<"apri" | "duplica" | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  async function trovaCruscotto(): Promise<DashboardSistema> {
    const risposta = await fetch("/api/bi/dashboard");
    const corpo = (await risposta.json()) as { dashboard?: DashboardSistema[]; error?: string };
    if (!risposta.ok) throw new Error(messaggioErrore(corpo, "Impossibile trovare la versione Dashboard."));
    const dashboard = corpo.dashboard?.find((voce) => voce.di_sistema === true);
    if (!dashboard) throw new Error("La versione Dashboard del Cruscotto non è ancora disponibile.");
    return dashboard;
  }

  async function apri() {
    setAzione("apri");
    setErrore(null);
    try {
      const dashboard = await trovaCruscotto();
      window.location.assign(`/bi/dashboard/${dashboard.id}`);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile aprire la versione Dashboard.");
      setAzione(null);
    }
  }

  async function duplica() {
    setAzione("duplica");
    setErrore(null);
    try {
      const dashboard = await trovaCruscotto();
      const risposta = await fetch(`/api/bi/dashboard/${dashboard.id}/duplica`, { method: "POST" });
      const corpo = (await risposta.json()) as { dashboard?: { id: string }; error?: string };
      if (!risposta.ok || !corpo.dashboard) {
        throw new Error(messaggioErrore(corpo, "Impossibile duplicare il Cruscotto."));
      }
      window.location.assign(`/bi/dashboard/${corpo.dashboard.id}`);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile duplicare il Cruscotto.");
      setAzione(null);
    }
  }

  return (
    <section className="mb-5 flex flex-col justify-between gap-3 border-y border-border bg-bg py-4 sm:flex-row sm:items-center" aria-label="Versione Dashboard del Cruscotto">
      <div className="max-w-3xl">
        <h1 className="font-tenorite text-xl font-semibold">Cruscotto completo e versione Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted">
          Qui restano i pannelli compositi storici. La versione Dashboard contiene i grafici già personalizzabili: duplicala per aggiungere le tue analisi.
        </p>
        {errore && <p role="alert" className="mt-2 text-sm text-danger">{errore}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button type="button" onClick={() => void apri()} disabled={azione !== null} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-bg-page px-3 text-sm font-semibold text-text hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
          {azione === "apri" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <ExternalLink className="h-4 w-4" aria-hidden />}
          Apri versione Dashboard
        </button>
        <button type="button" onClick={() => void duplica()} disabled={azione !== null} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-bg hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
          {azione === "duplica" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          Duplica per modificare
        </button>
      </div>
    </section>
  );
}
