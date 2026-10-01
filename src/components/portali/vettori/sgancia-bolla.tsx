"use client";

import { useState } from "react";
import { Loader2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Annullare un aggancio fattura -> bolla sbagliato.
 *
 * Solo l'amministrazione. Il motivo resta nello storico della bolla (si
 * scongela: i numeri su cui il controllo era stato fatto tornano modificabili),
 * ma si sceglie con un clic fra quelli ricorrenti; la nota libera serve solo
 * per «Altro» o per aggiungere un dettaglio, come la bolla giusta.
 */

export const MOTIVI_SGANCIO = [
  "Bolla sbagliata",
  "Fornitore o cliente sbagliato",
  "DDT fatturato su due righe",
  "Altro",
] as const;

export function SganciaBolla({ rigaId, onSganciata }: { rigaId: string; onSganciata: () => void }) {
  const [aperto, setAperto] = useState(false);
  const [scelta, setScelta] = useState<(typeof MOTIVI_SGANCIO)[number] | null>(null);
  const [nota, setNota] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const notaPulita = nota.trim();
  const pronto = scelta !== null && (scelta !== "Altro" || notaPulita.length >= 3);
  const motivo = scelta === "Altro" ? notaPulita : notaPulita ? `${scelta}: ${notaPulita}` : scelta ?? "";

  async function sgancia() {
    setInCorso(true);
    setErrore(null);
    try {
      const res = await fetch("/api/portali/vettori/agganci", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ azione: "sgancia", riga: rigaId, motivo }),
      });
      const corpo = await res.json();
      if (!res.ok) {
        setErrore(corpo.error ?? "Sgancio non riuscito.");
        return;
      }
      onSganciata();
    } catch {
      setErrore("Non è stato possibile contattare il server.");
    } finally {
      setInCorso(false);
    }
  }

  if (!aperto) {
    return (
      <div className="mt-3">
        <Button type="button" size="sm" variant="ghost" onClick={() => setAperto(true)}>
          <Unlink className="h-4 w-4" aria-hidden="true" />
          Sgancia dalla bolla
        </Button>
      </div>
    );
  }

  return (
    <section className="mt-3 max-w-3xl rounded-lg border border-border bg-bg-page p-3" aria-label="Sgancio dalla bolla">
      <p className="font-tenorite text-sm font-bold text-text">Sgancia dalla bolla</p>
      <p className="text-xs text-text-muted">
        Da usare se questa riga di fattura è stata agganciata alla bolla sbagliata. La bolla torna libera, la riga torna fra
        quelle da agganciare e il controllo si rifà con i dati della fattura.
      </p>

      <fieldset className="mt-2">
        <legend className="text-[11px] font-semibold text-text">Perché?</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {MOTIVI_SGANCIO.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={scelta === m}
              onClick={() => setScelta(m)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                scelta === m ? "border-primary bg-primary text-white" : "border-border bg-white text-text hover:border-primary"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </fieldset>

      <label htmlFor={`nota-sgancio-${rigaId}`} className="mt-2 block text-[11px] font-semibold text-text">
        {scelta === "Altro" ? "Spiega il motivo" : "Nota (facoltativa)"}
      </label>
      <input
        id={`nota-sgancio-${rigaId}`}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="es. la bolla giusta è la 2734"
        maxLength={400}
        className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs focus:border-primary focus:outline-none"
      />
      {errore ? <p role="alert" className="mt-1 text-xs text-red-700">{errore}</p> : null}
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" variant="danger" disabled={inCorso || !pronto} onClick={() => void sgancia()}>
          {inCorso ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Unlink className="h-4 w-4" aria-hidden="true" />}
          Conferma sgancio
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={inCorso} onClick={() => setAperto(false)}>
          Annulla
        </Button>
      </div>
    </section>
  );
}
