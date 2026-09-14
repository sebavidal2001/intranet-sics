"use client";

/**
 * Le tre strade per aggiungere un riquadro convergono qui.
 *
 * L'ordine delle schede non è neutro. Chi usa questo cruscotto non costruisce
 * grafici per mestiere: descrivere a parole quello che si vuole vedere è il
 * gesto che riesce a tutti, e va per primo. Spuntare i campi viene dopo, per
 * chi vuole mettere le mani. La raccolta di quelli già fatti è l'ultima: serve
 * quando si sa già cosa si cerca.
 *
 * Sotto restano lo stesso oggetto e la stessa sequenza — una `SpecQuery`
 * persistita, collegata una volta sola alla pagina corrente — ma l'utente non
 * ha motivo di saperlo, e infatti da nessuna parte gli viene detto.
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

type Scheda = "ai" | "costruisci" | "pronti";

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
  const [scheda, setScheda] = useState<Scheda>("ai");
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
      if (!salvata) throw new Error("Il riquadro è stato creato ma non è ancora leggibile: riprova fra un istante.");
      await aggancia(salvata);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Impossibile aggiungere il riquadro appena creato.");
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
    { id: "ai", etichetta: "Dillo a parole", Icona: Bot },
    { id: "costruisci", etichetta: "Scegli i campi", Icona: Wrench },
    { id: "pronti", etichetta: "Già pronti", Icona: Library },
  ];

  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-border bg-bg" aria-label="Aggiungi riquadro">
      <header className="flex items-start justify-between gap-4 border-b border-border px-4 pt-4">
        <div>
          <h2 className="font-tenorite text-xl font-semibold">Aggiungi un riquadro</h2>
          <p className="mt-1 text-sm text-text-muted">Il modo più veloce è descriverlo a parole. Se preferisci scegliere tu, spunta i campi.</p>
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
        {scheda === "pronti" && (
          <div className="divide-y divide-border border-y border-border">
            {caricamentoLibreria ? <p className="flex items-center justify-center py-8 text-sm text-text-muted"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden />Carico la libreria…</p> : analisi.length === 0 ? <div className="flex flex-col items-center py-8 text-center"><p className="font-tenorite text-lg font-semibold">Non c’è ancora niente di pronto</p><p className="mt-1 max-w-md text-sm text-text-muted">Descrivi a parole cosa vuoi vedere, oppure spunta i campi: il riquadro compare subito in questa pagina.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><button type="button" onClick={() => setScheda("costruisci")} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Wrench className="h-4 w-4" aria-hidden />Scegli i campi</button><button type="button" onClick={() => setScheda("ai")} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Bot className="h-4 w-4" aria-hidden />Dillo a parole</button></div></div> : analisi.map((voce) => {
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
            <label htmlFor="domanda-riquadro" className="font-tenorite text-base font-semibold">Che cosa vuoi vedere?</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <textarea id="domanda-riquadro" value={domanda} onChange={(evento) => setDomanda(evento.target.value)} rows={3} placeholder="Per esempio: l’ordinato per agente mese per mese, con il budget a confronto" className="min-w-0 flex-1 resize-y rounded-lg border border-border bg-bg-page px-3 py-2 text-sm outline-none placeholder:text-text-muted focus:ring-2 focus:ring-primary" />
              <button type="button" disabled={!domanda.trim() || analistaInCorso} onClick={() => void chiediAllAnalista()} className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">{analistaInCorso && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}Chiedi</button>
            </div>
            {!analistaInCorso && proposte.length === 0 && <p className="mt-4 text-sm text-text-muted">Scrivi come parleresti a un collega. L’AI sceglie i numeri giusti e il grafico adatto, e te lo mostra prima di aggiungerlo.</p>}
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
