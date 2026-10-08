"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";

const Esito = z.object({
  ok: z.literal(true),
  ricalcolo: z.enum(["riuscito", "fallito"]),
  fatturaId: z.string().uuid(),
});
const Avviso = z.object({
  fatturaId: z.string().uuid(),
  azione: z.enum(["aggancio", "sgancio"]),
});
type AvvisoSalvato = z.infer<typeof Avviso>;

const evento = "vettori:ricalcolo-aggancio";
const chiave = (rigaId: string) => `vettori:ricalcolo:${rigaId}`;

function leggi(rigaId: string): AvvisoSalvato | null {
  try {
    const testo = sessionStorage.getItem(chiave(rigaId));
    if (!testo) return null;
    const parsed = Avviso.safeParse(JSON.parse(testo));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function segnalaEsitoRicalcolo(rigaId: string, risposta: unknown, azione: AvvisoSalvato["azione"]): void {
  const parsed = Esito.safeParse(risposta);
  if (!parsed.success) return;
  if (parsed.data.ricalcolo === "fallito") {
    sessionStorage.setItem(chiave(rigaId), JSON.stringify({ fatturaId: parsed.data.fatturaId, azione }));
  } else {
    sessionStorage.removeItem(chiave(rigaId));
  }
  window.dispatchEvent(new Event(evento));
}

export function AvvisoRicalcolo({ rigaId }: { rigaId: string }) {
  const [avviso, setAvviso] = useState<AvvisoSalvato | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    const aggiorna = () => setAvviso(leggi(rigaId));
    aggiorna();
    window.addEventListener(evento, aggiorna);
    return () => window.removeEventListener(evento, aggiorna);
  }, [rigaId]);

  async function riprova() {
    if (!avviso) return;
    setInCorso(true);
    setErrore(null);
    try {
      const res = await fetch("/api/portali/vettori/agganci", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ azione: "ricalcola", fatturaId: avviso.fatturaId }),
      });
      const corpo: unknown = await res.json();
      if (!res.ok) {
        setErrore("Ricalcolo non riuscito. Riprova fra poco.");
        return;
      }
      const parsed = Esito.safeParse(corpo);
      if (!parsed.success || parsed.data.ricalcolo === "fallito") {
        setErrore("Ricalcolo non riuscito. Riprova fra poco.");
        return;
      }
      sessionStorage.removeItem(chiave(rigaId));
      setAvviso(null);
    } catch {
      setErrore("Non è stato possibile contattare il server.");
    } finally {
      setInCorso(false);
    }
  }

  if (!avviso) return null;
  return (
    <div role="alert" className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
      <p>
        {avviso.azione === "aggancio"
          ? "Bolla agganciata, ma il controllo dell'importo non è stato aggiornato: riprova fra poco o chiedi il ricalcolo."
          : "Bolla sganciata, ma il controllo dell'importo non è stato aggiornato: riprova fra poco o chiedi il ricalcolo."}
      </p>
      <Button type="button" size="sm" variant="outline" disabled={inCorso} onClick={() => void riprova()}>
        {inCorso ? "Ricalcolo in corso…" : "Ricalcola ora"}
      </Button>
      {errore ? <p className="mt-1">{errore}</p> : null}
    </div>
  );
}
