"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ControlloEseguito } from "@/lib/portali/campagne/tipi";
import { chiamaApi, formattaDataOra } from "./api-client";

/**
 * «Ultimo aggiornamento dei dati di Impresa» e il pulsante per ricontrollare.
 * I dati sono quelli del caricamento notturno: ricontrollare non li rinfresca,
 * rilegge e riconfronta quelli che ci sono. Serve dopo aver corretto un ordine
 * in Impresa SOLO se nel frattempo e' passata la notte; il testo lo dice.
 */
export function Ricontrolla({ ultimo }: { ultimo: ControlloEseguito | null }) {
  const router = useRouter();
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function lancia() {
    setOccupato(true);
    setErrore(null);
    const r = await chiamaApi("/api/portali/campagne/controllo", { metodo: "POST", corpo: {} });
    setOccupato(false);
    if (!r.ok) setErrore(r.errore);
    else router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
      <span>
        {ultimo && ultimo.esito !== "in_corso" ? (
          <>
            Dati di Impresa del <strong className="text-text">{formattaDataOra(ultimo.dati_del)}</strong> · ultimo controllo{" "}
            {formattaDataOra(ultimo.finito_il)}
            {ultimo.esito === "errore" ? " (fallito)" : ""}
          </>
        ) : (
          "Il controllo con Impresa non è ancora stato eseguito."
        )}
      </span>
      <Button size="sm" variant="outline" onClick={lancia} disabled={occupato}>
        {occupato ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Ricontrolla
      </Button>
      {errore ? <span className="text-danger">{errore}</span> : null}
    </div>
  );
}
