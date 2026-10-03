"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { descriviAnomalia, ORDINE_TIPI, TITOLO_TIPO } from "@/lib/portali/campagne/anomalie-testi";
import type { Anomalia } from "@/lib/portali/campagne/tipi";
import { chiamaApi, formattaDataOra } from "./api-client";
import { Copia } from "./copia";
import { Messaggio, Pannello } from "./ui";

interface Esito {
  tipo: "errore" | "ok";
  testo: string;
}

/** Una anomalia con quello che si puo' farne. Usata dalla pagina e dalla scheda cliente. */
export function CartaAnomalia({ anomalia, mostraCliente = true }: { anomalia: Anomalia; mostraCliente?: boolean }) {
  const router = useRouter();
  const d = descriviAnomalia(anomalia);
  const [modo, setModo] = useState<"ignora" | null>(null);
  const [nota, setNota] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [esito, setEsito] = useState<Esito | null>(null);

  const scambiabile = anomalia.tipo === "ordine_invertito" && anomalia.stato === "aperta";
  const aperta = anomalia.stato === "aperta";

  async function agisci(corpo: Record<string, unknown>, ok: string) {
    setOccupato(true);
    setEsito(null);
    const r = await chiamaApi(`/api/portali/campagne/anomalie/${anomalia.id}`, { metodo: "PATCH", corpo });
    setOccupato(false);
    if (!r.ok) {
      setEsito({ tipo: "errore", testo: r.errore });
      return;
    }
    setModo(null);
    setEsito({ tipo: "ok", testo: ok });
    router.refresh();
  }

  return (
    <li className="py-4">
      <div className="flex items-start gap-3">
        <TriangleAlert
          className={`mt-0.5 h-5 w-5 shrink-0 ${anomalia.gravita === "errore" ? "text-danger" : "text-warning"}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text">
            {d.titolo}
            {mostraCliente ? <span className="font-normal text-text-muted"> · {anomalia.ragione_sociale ?? anomalia.codice_cliente}</span> : null}
          </p>
          <p className="mt-1 text-sm text-text">{d.cosa}</p>
          <p className="mt-1 text-sm text-text-muted">{d.azione}</p>

          {d.da_copiare.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {d.da_copiare.map((c) => (
                <Copia key={c.etichetta} etichetta={c.etichetta} valore={c.valore} />
              ))}
            </div>
          ) : null}

          <p className="mt-2 text-xs text-text-muted">
            Rilevata {formattaDataOra(anomalia.aperta_il)}
            {anomalia.stato === "ignorata" ? ` · lasciata così: ${anomalia.nota ?? ""}` : ""}
          </p>

          {aperta && modo === null ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {scambiabile ? (
                <Button
                  size="sm"
                  disabled={occupato}
                  onClick={() => {
                    if (window.confirm("Hai scambiato le buste fisiche? Il programma assegnerà gli ordini come indicato."))
                      void agisci({ azione: "applica_scambio" }, "Scambio applicato.");
                  }}
                >
                  {occupato ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Applica scambio
                </Button>
              ) : null}
              <Link
                href={`/campagne/clienti/${encodeURIComponent(anomalia.codice_cliente)}`}
                className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-bg-page"
              >
                Apri il cliente
              </Link>
              <Button size="sm" variant="ghost" onClick={() => setModo("ignora")}>
                Lascia così
              </Button>
            </div>
          ) : null}

          {modo === "ignora" ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-text">Perché la lasci così?</span>
                  <Input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} />
                </label>
              </div>
              <Button size="sm" disabled={occupato || nota.trim().length < 3} onClick={() => agisci({ azione: "ignora", nota }, "Anomalia lasciata così.")}>
                Conferma
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setModo(null)}>
                Chiudi
              </Button>
            </div>
          ) : null}

          {esito ? (
            <div className="mt-2">
              <Messaggio tipo={esito.tipo}>{esito.testo}</Messaggio>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Le anomalie raggruppate per tipo, dalle piu' urgenti. */
export function AnomalieView({ anomalie }: { anomalie: Anomalia[] }) {
  if (anomalie.length === 0) {
    return (
      <Pannello>
        <p className="text-sm font-semibold text-text">Nessuna anomalia</p>
        <p className="mt-1 text-sm text-text-muted">Gli ordini e le buste in lavorazione sono coerenti con i dati di Impresa.</p>
      </Pannello>
    );
  }

  return (
    <div className="space-y-6">
      {ORDINE_TIPI.map((tipo) => {
        const lista = anomalie.filter((a) => a.tipo === tipo);
        if (lista.length === 0) return null;
        return (
          <Pannello key={tipo} titolo={`${TITOLO_TIPO[tipo]} · ${lista.length}`}>
            <ul className="divide-y divide-border">
              {lista.map((a) => (
                <CartaAnomalia key={a.id} anomalia={a} />
              ))}
            </ul>
          </Pannello>
        );
      })}
    </div>
  );
}
