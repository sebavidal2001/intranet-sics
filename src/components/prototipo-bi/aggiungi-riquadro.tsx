"use client";

/**
 * Le tre strade per aggiungere un riquadro convergono qui, così libreria,
 * builder e Analista rispettano la stessa sequenza: ottenere un'analisi
 * persistita e poi collegarla una sola volta alla pagina corrente.
 */

import { useEffect, useRef, useState } from "react";
import { Bot, Library, LoaderCircle, Plus, Wrench, X } from "lucide-react";
import { EditorAnalisi } from "./editor-analisi";
import { GraficoDaAnalisi } from "./grafico-da-risultato";
import type { FiltriPagina } from "@/lib/prototipo-bi/filtri-pagina";
import type { TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type {
  RisultatoQuery,
  SerieAnalisi,
  SerieAnalisiEseguita,
  SpecQuery,
} from "@/lib/prototipo-bi/tipi";

export interface AnalisiAggiungibile {
  id: string;
  titolo: string;
  descrizione: string | null;
  spec: SpecQuery;
  serie?: SerieAnalisi[] | null;
  grafico: TipoGrafico | null;
  autore_id: string;
  visibilita: "privata" | "condivisa";
}

export interface RiquadroCreato {
  id: string;
  pagina_id: string;
  analisi_id: string;
  titolo: string | null;
  posizione: number;
  larghezza: number;
  altezza: number;
  grafico: TipoGrafico | null;
}

interface AnalisiProposta {
  titolo: string;
  spec: SpecQuery;
  serie?: SerieAnalisi[];
  grafico: TipoGrafico;
  risultato: RisultatoQuery;
  risultatiSerie?: SerieAnalisiEseguita[];
  commento?: string;
}

interface ProprietaAggiungiRiquadro {
  paginaId: string;
  filtriPagina: FiltriPagina;
  analisiPresenti: string[];
  onAggiunta: (analisi: AnalisiAggiungibile, riquadro: RiquadroCreato) => void;
  onChiudi: () => void;
}

type Scheda = "libreria" | "costruisci" | "ai";

function messaggioErrore(valore: unknown, ripiego: string): string {
  if (valore && typeof valore === "object" && "error" in valore && typeof valore.error === "string") {
    return valore.error;
  }
  return ripiego;
}

export function AggiungiRiquadro({
  paginaId,
  filtriPagina,
  analisiPresenti,
  onAggiunta,
  onChiudi,
}: ProprietaAggiungiRiquadro) {
  const [scheda, setScheda] = useState<Scheda>("libreria");
  const [analisi, setAnalisi] = useState<AnalisiAggiungibile[]>([]);
  const [caricamentoLibreria, setCaricamentoLibreria] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [domanda, setDomanda] = useState("");
  const [proposte, setProposte] = useState<AnalisiProposta[]>([]);
  const [analistaInCorso, setAnalistaInCorso] = useState(false);
  const [azioneInCorso, setAzioneInCorso] = useState<string | null>(null);
  const bloccoAzione = useRef(false);

  async function leggiLibreria(): Promise<AnalisiAggiungibile[]> {
    const risposta = await fetch("/api/bi/analisi");
    const corpo = (await risposta.json()) as { analisi?: AnalisiAggiungibile[]; error?: string };
    if (!risposta.ok) throw new Error(messaggioErrore(corpo, "Impossibile leggere la libreria."));
    const disponibili = corpo.analisi ?? [];
    setAnalisi(disponibili);
    return disponibili;
  }

  useEffect(() => {
    let attivo = true;
    void leggiLibreria()
      .catch((causa: unknown) => {
        if (attivo) setErrore(causa instanceof Error ? causa.message : "Impossibile leggere la libreria.");
      })
      .finally(() => {
        if (attivo) setCaricamentoLibreria(false);
      });
    return () => {
      attivo = false;
    };
  }, []);

  async function aggancia(analisiScelta: AnalisiAggiungibile) {
    if (bloccoAzione.current) return;
    bloccoAzione.current = true;
    setAzioneInCorso(analisiScelta.id);
    setErrore(null);
    try {
      const risposta = await fetch(`/api/bi/dashboard/pagine/${paginaId}/riquadri`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analisi_id: analisiScelta.id }),
      });
      const corpo = (await risposta.json()) as { riquadro?: RiquadroCreato; error?: string };
      if (!risposta.ok || !corpo.riquadro) {
        throw new Error(messaggioErrore(corpo, "Impossibile aggiungere il riquadro."));
      }
      onAggiunta(analisiScelta, corpo.riquadro);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile aggiungere il riquadro.");
    } finally {
      bloccoAzione.current = false;
      setAzioneInCorso(null);
    }
  }

  async function agganciaSalvata(id: string) {
    try {
      const disponibili = await leggiLibreria();
      const salvata = disponibili.find((voce) => voce.id === id);
      if (!salvata) throw new Error("L'analisi salvata non è ancora disponibile nella libreria.");
      await aggancia(salvata);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile aggiungere l'analisi salvata.");
    }
  }

  async function chiediAllAnalista() {
    const testo = domanda.trim();
    if (!testo || analistaInCorso) return;
    setAnalistaInCorso(true);
    setErrore(null);
    setProposte([]);
    try {
      const risposta = await fetch("/api/bi/analista", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domanda: testo }),
      });
      const corpo = (await risposta.json()) as { analisi?: AnalisiProposta[]; error?: string };
      if (!risposta.ok) throw new Error(messaggioErrore(corpo, "L'Analista non ha risposto."));
      setProposte(corpo.analisi ?? []);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "L'Analista non ha risposto.");
    } finally {
      setAnalistaInCorso(false);
    }
  }

  async function salvaEaggancia(proposta: AnalisiProposta, indice: number) {
    if (bloccoAzione.current) return;
    bloccoAzione.current = true;
    const chiaveAzione = `ai-${indice}`;
    setAzioneInCorso(chiaveAzione);
    setErrore(null);
    try {
      const risposta = await fetch("/api/bi/analisi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titolo: proposta.titolo,
          descrizione: proposta.commento,
          spec: proposta.spec,
          serie: proposta.serie ?? null,
          grafico: proposta.grafico,
        }),
      });
      const corpo = (await risposta.json()) as { analisi?: AnalisiAggiungibile; error?: string };
      if (!risposta.ok || !corpo.analisi) {
        throw new Error(messaggioErrore(corpo, "Impossibile salvare la proposta."));
      }
      bloccoAzione.current = false;
      await aggancia(corpo.analisi);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile aggiungere la proposta.");
    } finally {
      bloccoAzione.current = false;
      setAzioneInCorso(null);
    }
  }

  const schede: Array<{ id: Scheda; etichetta: string; Icona: typeof Library }> = [
    { id: "libreria", etichetta: "Dalla libreria", Icona: Library },
    { id: "costruisci", etichetta: "Costruisci", Icona: Wrench },
    { id: "ai", etichetta: "Chiedi all'AI", Icona: Bot },
  ];

  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-border bg-bg" aria-label="Aggiungi riquadro">
      <header className="flex items-start justify-between gap-4 border-b border-border px-4 pt-4">
        <div>
          <h2 className="font-tenorite text-xl font-semibold">Aggiungi un riquadro</h2>
          <p className="mt-1 text-sm text-text-muted">Scegli il percorso più rapido per la domanda che hai in mente.</p>
        </div>
        <button type="button" onClick={onChiudi} className="rounded-lg p-2 text-text-muted hover:bg-bg-page hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Chiudi pannello">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-border px-4 pt-3" role="tablist" aria-label="Modalità di aggiunta">
        {schede.map(({ id, etichetta, Icona }) => (
          <button key={id} type="button" role="tab" aria-selected={scheda === id} onClick={() => setScheda(id)} className={`inline-flex min-h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${scheda === id ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text"}`}>
            <Icona className="h-4 w-4" aria-hidden />{etichetta}
          </button>
        ))}
      </div>

      {errore && <p role="alert" className="mx-4 mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{errore}</p>}

      <div className="p-4">
        {scheda === "libreria" && (
          <div className="divide-y divide-border border-y border-border">
            {caricamentoLibreria ? <p className="flex items-center justify-center py-8 text-sm text-text-muted"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden />Carico la libreria…</p> : analisi.length === 0 ? <div className="flex flex-col items-center py-8 text-center"><p className="font-tenorite text-lg font-semibold">Nessuna analisi disponibile</p><p className="mt-1 max-w-md text-sm text-text-muted">Costruisci qui la prima analisi oppure descrivila all’AI: verrà salvata e aggiunta subito alla pagina.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><button type="button" onClick={() => setScheda("costruisci")} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Wrench className="h-4 w-4" aria-hidden />Costruisci la prima analisi</button><button type="button" onClick={() => setScheda("ai")} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Bot className="h-4 w-4" aria-hidden />Chiedi all’AI</button></div></div> : analisi.map((voce) => {
              const presente = analisiPresenti.includes(voce.id);
              return <div key={voce.id} className="flex flex-col justify-between gap-3 py-3 sm:flex-row sm:items-center"><div><p className="font-tenorite text-base font-semibold">{voce.titolo}</p>{voce.descrizione && <p className="mt-0.5 text-sm text-text-muted">{voce.descrizione}</p>}</div><button type="button" disabled={presente || azioneInCorso !== null} onClick={() => void aggancia(voce)} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-primary hover:bg-bg-page disabled:cursor-not-allowed disabled:opacity-45">{azioneInCorso === voce.id ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}{presente ? "Già presente" : "Aggiungi alla pagina"}</button></div>;
            })}
          </div>
        )}

        {scheda === "costruisci" && (
          <div className="[&>main]:max-w-none [&>main]:p-0 [&>main>header]:hidden">
            <EditorAnalisi dentroUnaPagina periodoEreditato={filtriPagina.periodo} onSalvata={(id) => void agganciaSalvata(id)} />
          </div>
        )}

        {scheda === "ai" && (
          <div>
            <label htmlFor="domanda-riquadro" className="font-tenorite text-base font-semibold">Descrivi cosa vuoi vedere</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <textarea id="domanda-riquadro" value={domanda} onChange={(evento) => setDomanda(evento.target.value)} rows={3} placeholder="Per esempio: mostrami la conversione per agente negli ultimi mesi" className="min-w-0 flex-1 resize-y rounded-lg border border-border bg-bg-page px-3 py-2 text-sm outline-none placeholder:text-text-muted focus:ring-2 focus:ring-primary" />
              <button type="button" disabled={!domanda.trim() || analistaInCorso} onClick={() => void chiediAllAnalista()} className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">{analistaInCorso && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}Chiedi all’AI</button>
            </div>
            {!analistaInCorso && proposte.length === 0 && <p className="mt-4 text-sm text-text-muted">Le proposte useranno metriche certificate e mostreranno subito il grafico suggerito.</p>}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {proposte.map((proposta, indice) => (
                <article key={`${proposta.titolo}-${indice}`} className="overflow-hidden rounded-xl border border-border bg-bg-page">
                  <header className="px-4 pt-4"><h3 className="font-tenorite text-lg font-semibold">{proposta.titolo}</h3>{proposta.commento && <p className="mt-1 text-sm text-text-muted">{proposta.commento}</p>}</header>
                  <div className="min-h-48 p-4"><GraficoDaAnalisi serie={proposta.risultatiSerie ?? [{ ruolo: "principale", nome: proposta.spec.metrica, spec: proposta.spec, risultato: proposta.risultato }]} tipo={proposta.grafico} altezza={220} /></div>
                  <div className="border-t border-border p-3"><button type="button" disabled={azioneInCorso !== null} onClick={() => void salvaEaggancia(proposta, indice)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">{azioneInCorso === `ai-${indice}` ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}Aggiungi alla pagina</button></div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
