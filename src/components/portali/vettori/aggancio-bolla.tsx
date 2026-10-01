"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Aggancio di una riga di fattura gia' in archivio alla sua bolla.
 *
 * Mostra la proposta del modello, se e' gia' stata pagata, e le bolle candidate
 * ricalcolate adesso. Decide una persona dell'amministrazione: un aggancio
 * congela la bolla e rifa' il controllo della fattura.
 */

interface Candidata {
  etichetta: string;
  spedizioneId: string;
  numero: string | null;
  protocollo: string | null;
  data: string;
  controparte: string | null;
  localita: string | null;
  provincia: string | null;
  colli: number | null;
  peso: number | null;
  vettore: string | null;
  giaAgganciataA: number;
  congelata?: boolean;
  indizi: string[];
}

interface Proposta {
  esito: "scelta" | "nessuna" | "senza_candidati" | "errore";
  spedizioneId: string | null;
  sicurezza: "alta" | "media" | "bassa" | null;
  motivo: string | null;
}

interface Dettaglio {
  proposta: Proposta | null;
  candidate: Candidata[];
  puoDecidere: boolean;
}

const SICUREZZA: Record<string, string> = { alta: "sicurezza alta", media: "sicurezza media", bassa: "sicurezza bassa" };

function data(iso: string): string {
  const [a, m, g] = iso.slice(0, 10).split("-");
  return `${g}/${m}/${a}`;
}

export function AggancioBolla({ rigaId, onAgganciata }: { rigaId: string; onAgganciata: () => void }) {
  const [dettaglio, setDettaglio] = useState<Dettaglio | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const leggi = useCallback(async () => {
    setCaricamento(true);
    setErrore(null);
    try {
      const res = await fetch(`/api/portali/vettori/agganci?riga=${encodeURIComponent(rigaId)}`, { cache: "no-store" });
      const corpo = await res.json();
      if (!res.ok) {
        setErrore(corpo.error ?? "Non e' stato possibile leggere le bolle candidate.");
        return;
      }
      setDettaglio(corpo as Dettaglio);
    } catch {
      setErrore("Non e' stato possibile contattare il server.");
    } finally {
      setCaricamento(false);
    }
  }, [rigaId]);

  useEffect(() => {
    void leggi();
  }, [leggi]);

  async function invia(azione: "conferma" | "nessuna" | "proponi", spedizione?: string) {
    setInCorso(spedizione ?? azione);
    setErrore(null);
    try {
      const res = await fetch("/api/portali/vettori/agganci", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spedizione ? { azione, riga: rigaId, spedizione } : { azione, riga: rigaId }),
      });
      const corpo = await res.json();
      if (!res.ok) {
        setErrore(corpo.error ?? "Operazione non riuscita.");
        return;
      }
      if (azione === "conferma") onAgganciata();
      else await leggi();
    } catch {
      setErrore("Non e' stato possibile contattare il server.");
    } finally {
      setInCorso(null);
    }
  }

  if (caricamento) {
    return (
      <div className="mt-4 flex items-center gap-2 text-xs text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
        Cerco le bolle candidate…
      </div>
    );
  }

  const proposta = dettaglio?.proposta ?? null;
  const puo = dettaglio?.puoDecidere ?? false;

  return (
    <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3" aria-label="Aggancio alla bolla">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-tenorite text-sm font-bold text-text">Riga senza bolla</p>
          <p className="text-xs text-text-muted">
            Agganciarla alla sua bolla congela la bolla e rifà il controllo con il suo peso e le sue misure.
          </p>
        </div>
        {puo && !proposta ? (
          <Button type="button" size="sm" variant="outline" disabled={inCorso !== null} onClick={() => void invia("proponi")}>
            {inCorso === "proponi" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            Chiedi all&apos;AI
          </Button>
        ) : null}
      </div>

      {proposta ? (
        <div className="mt-2 rounded-md bg-white/80 p-2 text-xs text-text">
          <p className="font-semibold">
            <Sparkles className="mr-1 inline h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {proposta.esito === "scelta"
              ? `Proposta dell'AI${proposta.sicurezza ? ` · ${SICUREZZA[proposta.sicurezza]}` : ""}`
              : proposta.esito === "nessuna"
                ? "L'AI non riconosce nessuna delle bolle candidate"
                : proposta.esito === "senza_candidati"
                  ? "Nessuna bolla candidata trovata"
                  : "L'AI non ha risposto"}
          </p>
          {proposta.motivo ? <p className="mt-0.5 leading-relaxed text-text-muted">{proposta.motivo}</p> : null}
        </div>
      ) : null}

      {errore ? (
        <p role="alert" className="mt-2 text-xs text-red-700">{errore}</p>
      ) : null}

      {dettaglio && dettaglio.candidate.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {dettaglio.candidate.map((c) => {
            const proposta_ = proposta?.spedizioneId === c.spedizioneId;
            const bloccata = c.congelata === true;
            return (
              <li
                key={c.spedizioneId}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs ${proposta_ ? "border-primary bg-primary/5" : "border-border bg-white"}`}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-text">
                    {c.numero ?? "senza numero"}
                    {c.protocollo ? <span className="font-normal text-text-muted"> · prot. {c.protocollo}</span> : null}
                    <span className="font-normal text-text-muted"> · {data(c.data)}</span>
                    {proposta_ ? <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-white">proposta AI</span> : null}
                  </p>
                  <p className="text-text-muted">
                    {c.controparte ?? "—"}
                    {c.localita ? ` · ${c.localita}` : ""}
                    {c.provincia ? ` (${c.provincia})` : ""}
                    {" · "}
                    {c.peso != null ? `${c.peso.toLocaleString("it-IT")} kg` : "peso non registrato"}
                    {c.colli != null ? ` · ${c.colli} colli` : ""}
                    {c.vettore ? ` · ${c.vettore}` : ""}
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {c.indizi.join(" · ")}
                    {bloccata ? " · già agganciata a un'altra fattura" : c.giaAgganciataA > 0 ? " · già usata da un'altra riga" : ""}
                  </p>
                </div>
                {puo ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={proposta_ ? "default" : "outline"}
                    disabled={bloccata || inCorso !== null}
                    onClick={() => void invia("conferma", c.spedizioneId)}
                  >
                    {inCorso === c.spedizioneId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
                    Aggancia questa
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-text-muted">
          Nessuna bolla con numero, nome o data compatibili entro 10 giorni: va chiesta all&apos;amministrazione o al magazzino.
        </p>
      )}

      {puo && proposta && proposta.esito === "scelta" ? (
        <div className="mt-2 flex justify-end">
          <Button type="button" size="sm" variant="ghost" disabled={inCorso !== null} onClick={() => void invia("nessuna")}>
            <X className="h-4 w-4" aria-hidden="true" />
            Nessuna di queste
          </Button>
        </div>
      ) : null}
    </section>
  );
}
