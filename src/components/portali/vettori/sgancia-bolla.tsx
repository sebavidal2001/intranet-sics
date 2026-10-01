"use client";

import { useState } from "react";
import { Loader2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Annullare un aggancio fattura -> bolla sbagliato.
 *
 * Solo l'amministrazione, con un motivo: la bolla si scongela (se nessun'altra
 * riga la usa), la riga torna fra quelle da agganciare e il controllo si rifà.
 */
export function SganciaBolla({ rigaId, onSganciata }: { rigaId: string; onSganciata: () => void }) {
  const [aperto, setAperto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function sgancia() {
    setInCorso(true);
    setErrore(null);
    try {
      const res = await fetch("/api/portali/vettori/agganci", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ azione: "sgancia", riga: rigaId, motivo: motivo.trim() }),
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
      <label htmlFor={`motivo-sgancio-${rigaId}`} className="mt-2 block text-[11px] font-semibold text-text">
        Motivo (obbligatorio)
      </label>
      <input
        id={`motivo-sgancio-${rigaId}`}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="es. la bolla giusta è la 2734 di AIRON, non questa"
        maxLength={500}
        className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs focus:border-primary focus:outline-none"
      />
      {errore ? <p role="alert" className="mt-1 text-xs text-red-700">{errore}</p> : null}
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" variant="danger" disabled={inCorso || motivo.trim().length < 3} onClick={() => void sgancia()}>
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
