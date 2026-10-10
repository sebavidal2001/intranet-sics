"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import { euro, numero, percentuale } from "@/components/prototipo-bi/primitivi";
import type { MisuraSalvata } from "@/lib/prototipo-bi/misure-catalogo";
import type { EsitoProposta } from "@/lib/prototipo-bi/proposta-misura";
import type { MisuraDefinita, UnitaMisura } from "@/lib/prototipo-bi/tipi";

/**
 * «Nuova misura a parole».
 *
 * Chi non è pratico del programma descrive in italiano l'indicatore che gli
 * serve; l'assistente lo traduce in una definizione fatta SOLO di metriche
 * certificate, il sistema la rilegge a parole, la prova su un periodo noto e
 * mostra il valore di ogni pezzo accanto al risultato, così si può controllare
 * a mano. Si salva solo dopo aver visto tutto questo.
 *
 * Il componente non calcola niente e non si fida di niente: quello che arriva
 * dall'assistente è una proposta, e il server la rivalida di nuovo al
 * salvataggio.
 */

export function formatta(valore: number, unita: UnitaMisura | string): string {
  if (unita === "euro") return euro(valore, false);
  if (unita === "percentuale") return percentuale(valore);
  if (unita === "giorni") return `${valore.toLocaleString("it-IT", { maximumFractionDigits: 1 })} giorni`;
  return numero(valore);
}

function messaggioDa(corpo: unknown, ripiego: string): string {
  if (typeof corpo === "object" && corpo !== null) {
    const { error, suggerimento } = corpo as { error?: unknown; suggerimento?: unknown };
    if (typeof error === "string") {
      return typeof suggerimento === "string" && suggerimento ? `${error} ${suggerimento}` : error;
    }
  }
  return ripiego;
}

type Fase = "scrivi" | "attesa" | "proposta" | "salvataggio";

export function CreaMisura({
  onChiudi,
  onSalvata,
  testoIniziale = "",
}: {
  /** Per partire da una misura che c'e' gia': il testo e' una variante da completare. */
  testoIniziale?: string;
  onChiudi: () => void;
  /** La misura e' gia' nel catalogo: chi apre la finestra decide come usarla. */
  onSalvata: (misura: MisuraSalvata) => void;
}) {
  const [fase, setFase] = useState<Fase>("scrivi");
  const [testo, setTesto] = useState(testoIniziale);
  const [risposta, setRisposta] = useState("");
  const [proposta, setProposta] = useState<EsitoProposta | null>(null);
  const [nome, setNome] = useState("");
  const [errore, setErrore] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const area = campo.current;
    area?.focus();
    // Partendo da una misura esistente il cursore va in fondo: il resto della frase e' da scrivere.
    if (area && testoIniziale) area.setSelectionRange(testoIniziale.length, testoIniziale.length);
    // Solo all'apertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function suEsc(evento: KeyboardEvent) {
      if (evento.key === "Escape") onChiudi();
    }
    window.addEventListener("keydown", suEsc);
    return () => window.removeEventListener("keydown", suEsc);
  }, [onChiudi]);

  async function proponi(richiesta: string) {
    setFase("attesa");
    setErrore("");
    try {
      const res = await fetch("/api/bi/misure/proponi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testo: richiesta }),
      });
      const corpo: unknown = await res.json();
      if (!res.ok) throw new Error(messaggioDa(corpo, "Non riesco a preparare la proposta."));
      const esito = corpo as EsitoProposta;
      setProposta(esito);
      if (esito.tipo === "misura" && esito.misura) setNome(esito.misura.nome);
      setFase(esito.tipo === "misura" ? "proposta" : "scrivi");
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Non riesco a preparare la proposta.");
      setFase("scrivi");
    }
  }

  async function salva() {
    if (!proposta?.misura) return;
    const misura: MisuraDefinita = { ...proposta.misura, nome: nome.trim() };
    setFase("salvataggio");
    setErrore("");
    try {
      const res = await fetch("/api/bi/misure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ misura }),
      });
      const corpo: unknown = await res.json();
      if (!res.ok) throw new Error(messaggioDa(corpo, "Salvataggio non riuscito."));
      const salvata = (corpo as { misura?: MisuraSalvata }).misura;
      if (!salvata?.misura) throw new Error("Il salvataggio non ha restituito la misura.");
      onSalvata(salvata);
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Salvataggio non riuscito.");
      setFase("proposta");
    }
  }

  const chiarimento = proposta?.tipo === "chiarimento" ? proposta.chiarimento : null;
  const occupato = fase === "attesa" || fase === "salvataggio";
  const prova = proposta?.prova;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Nuova misura a parole"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-bg shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="font-tenorite text-xl font-bold">Nuova misura a parole</h2>
            <p className="mt-1 text-xs text-text-muted">
              Descrivi l’indicatore che ti serve. L’assistente lo costruisce solo con le metriche certificate: non
              inventa numeri e non scrive formule.
            </p>
          </div>
          <button type="button" onClick={onChiudi} className="rounded-lg p-2 text-text-muted hover:bg-bg-page" aria-label="Chiudi">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto p-5">
          {fase !== "proposta" && fase !== "salvataggio" && (
            <>
              <label className="block text-sm font-medium">
                Cosa vuoi misurare?
                <textarea
                  ref={campo}
                  value={testo}
                  onChange={(e) => setTesto(e.target.value)}
                  rows={3}
                  maxLength={500}
                  disabled={occupato}
                  placeholder="Per esempio: margine sul fatturato dei soli componenti"
                  className="mt-1 w-full rounded-lg border border-border bg-bg-page p-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>

              {chiarimento && (
                <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3" role="status">
                  <p className="text-sm">{chiarimento}</p>
                  <label className="block text-xs text-text-muted">
                    La tua risposta
                    <input
                      value={risposta}
                      onChange={(e) => setRisposta(e.target.value)}
                      disabled={occupato}
                      className="mt-1 w-full rounded-lg border border-border bg-bg p-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>
                </div>
              )}

              {errore && (
                <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
                  {errore}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={occupato || (chiarimento ? risposta.trim().length < 2 : testo.trim().length < 8)}
                  onClick={() => void proponi(chiarimento ? `${testo.trim()} — ${risposta.trim()}` : testo.trim())}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-bg focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                >
                  {fase === "attesa" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                  {fase === "attesa" ? "Sto pensando…" : chiarimento ? "Rispondi" : "Proponi la misura"}
                </button>
              </div>
            </>
          )}

          {(fase === "proposta" || fase === "salvataggio") && proposta?.misura && (
            <>
              <section aria-label="Come ho capito la richiesta" className="space-y-1">
                <h3 className="font-tenorite text-sm font-bold uppercase tracking-wide">Ho capito così</h3>
                <p className="rounded-lg bg-bg-page p-3 text-sm">{proposta.descrizione}</p>
                {proposta.nota && (
                  <p className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs text-text">{proposta.nota}</p>
                )}
              </section>

              {prova && (
                <section aria-label="Prova sui dati" className="space-y-1">
                  <h3 className="font-tenorite text-sm font-bold uppercase tracking-wide">
                    Prova sul {prova.periodo.anno ?? "periodo"}
                  </h3>
                  <p className="text-xs text-text-muted">
                    Il valore di ogni pezzo e il risultato, sugli stessi dati: puoi ricontrollarli a mano.
                  </p>
                  <dl className="divide-y divide-border rounded-lg border border-border text-sm">
                    {prova.foglie.map((f, i) => (
                      <div key={`${f.descrizione}-${i}`} className="flex items-baseline justify-between gap-3 px-3 py-2">
                        <dt className="min-w-0 text-text-muted">{f.descrizione}</dt>
                        <dd className="shrink-0 font-medium">{formatta(f.valore, f.unita)}</dd>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-3 bg-bg-page px-3 py-2">
                      <dt className="font-semibold">Risultato</dt>
                      <dd className="shrink-0 font-tenorite text-base font-bold text-primary">
                        {formatta(prova.risultato.totale, prova.risultato.unita)}
                      </dd>
                    </div>
                  </dl>
                  {prova.risultato.avvisi.length > 0 && (
                    <ul className="space-y-1 pt-1" aria-label="Avvertenze">
                      {prova.risultato.avvisi.map((avviso) => (
                        <li key={avviso} className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs">
                          {avviso}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <label className="block text-sm font-medium">
                Nome della misura
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  maxLength={80}
                  disabled={occupato}
                  className="mt-1 w-full rounded-lg border border-border bg-bg-page p-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="mt-1 block text-xs font-normal text-text-muted">
                  Resta nel catalogo con il tuo nome come autore e si riusa, senza assistente, in qualsiasi riquadro.
                </span>
              </label>

              {errore && (
                <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
                  {errore}
                </p>
              )}

              <p className="text-xs text-text-muted">
                {proposta.dalCache
                  ? "Proposta già preparata in precedenza: nessun costo."
                  : `Preparata da ${proposta.modelli.join(" e poi ")} · costo ${proposta.consumo.costoUsd.toLocaleString("it-IT", { maximumFractionDigits: 4 })} $.`}
              </p>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={occupato}
                  onClick={() => {
                    setProposta(null);
                    setErrore("");
                    setFase("scrivi");
                  }}
                  className="min-h-10 rounded-lg border border-border bg-bg-page px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                >
                  Riformula
                </button>
                <button
                  type="button"
                  disabled={occupato || nome.trim().length < 3}
                  onClick={() => void salva()}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-bg focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                >
                  {fase === "salvataggio" && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
                  Salva e usa
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
