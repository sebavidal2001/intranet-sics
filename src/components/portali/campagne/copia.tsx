"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Un valore pronto da copiare: l'articolo o la descrizione da incollare in Impresa.
 * Se gli appunti non sono disponibili (pagina non sicura, permesso negato) il testo
 * resta comunque selezionabile con un clic.
 */
export function Copia({ etichetta, valore }: { etichetta: string; valore: string }) {
  const [copiato, setCopiato] = useState(false);

  async function copia() {
    try {
      await navigator.clipboard.writeText(valore);
      setCopiato(true);
      setTimeout(() => setCopiato(false), 1500);
    } catch {
      // Fallback: la selezione manuale resta possibile grazie a select-all.
    }
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-page px-2.5 py-1.5 text-sm">
      <span className="text-xs text-text-muted">{etichetta}</span>
      <code className="select-all font-mono text-text">{valore}</code>
      <button
        type="button"
        onClick={copia}
        aria-label={`Copia ${etichetta}`}
        className="rounded p-1 text-text-muted transition-colors hover:bg-white hover:text-primary"
      >
        {copiato ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </button>
    </span>
  );
}
