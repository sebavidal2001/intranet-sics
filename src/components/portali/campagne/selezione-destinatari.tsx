"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CampagnaRiepilogo, CategoriaClienti, ClienteSelezione } from "@/lib/portali/campagne/tipi";
import { chiamaApi } from "./api-client";
import { Messaggio } from "./ui";

interface EsitoDestinatari {
  aggiunti: number;
  rimossi: number;
  non_validi: number;
  con_invio: number;
}

interface RispostaModifica {
  esito: EsitoDestinatari;
  campagna: CampagnaRiepilogo;
}

/**
 * Selezione dei destinatari di una campagna mirata: prima la categoria, poi i
 * singoli clienti. Si può prendere un'intera categoria o un cliente solo.
 * I rivenditori non compaiono: sono esclusi sempre.
 */
export function SelezioneDestinatari({
  campagnaId,
  bloccata,
  onAggiornata,
}: {
  campagnaId: string;
  /** Campagna terminata: si guarda e basta. */
  bloccata: boolean;
  onAggiornata: (c: CampagnaRiepilogo) => void;
}) {
  const base = `/api/portali/campagne/campagne/${campagnaId}/destinatari`;
  const [categorie, setCategorie] = useState<CategoriaClienti[] | null>(null);
  const [filtro, setFiltro] = useState("");
  const [aperta, setAperta] = useState<string | null>(null);
  const [clienti, setClienti] = useState<Record<string, ClienteSelezione[]>>({});
  const [occupato, setOccupato] = useState<string | null>(null);
  const [esito, setEsito] = useState<{ tipo: "errore" | "ok"; testo: string } | null>(null);

  async function carica() {
    setEsito(null);
    setOccupato("caricamento");
    const r = await chiamaApi<{ categorie: CategoriaClienti[] }>(base);
    setOccupato(null);
    if (r.ok) setCategorie(r.dati.categorie);
    else setEsito({ tipo: "errore", testo: r.errore });
  }

  async function apriCategoria(nome: string) {
    if (aperta === nome) {
      setAperta(null);
      return;
    }
    setAperta(nome);
    if (clienti[nome]) return;
    setOccupato(nome);
    const r = await chiamaApi<{ clienti: ClienteSelezione[] }>(`${base}?categoria=${encodeURIComponent(nome)}`);
    setOccupato(null);
    if (r.ok) setClienti((c) => ({ ...c, [nome]: r.dati.clienti }));
    else setEsito({ tipo: "errore", testo: r.errore });
  }

  /** Esegue la modifica e riallinea conteggi e righe aperte con la risposta. */
  async function modifica(corpo: Record<string, unknown>, chiave: string, dopo: (e: EsitoDestinatari) => void) {
    setOccupato(chiave);
    setEsito(null);
    const r = await chiamaApi<RispostaModifica>(base, { corpo });
    setOccupato(null);
    if (!r.ok) {
      setEsito({ tipo: "errore", testo: r.errore });
      return;
    }
    dopo(r.dati.esito);
    onAggiornata(r.dati.campagna);
    // Le righe già scaricate potrebbero essere cambiate: si tiene in cache solo
    // la categoria aperta, riletta adesso; le altre si rileggono quando si aprono.
    const [fresche, riga] = await Promise.all([
      chiamaApi<{ categorie: CategoriaClienti[] }>(base),
      aperta ? chiamaApi<{ clienti: ClienteSelezione[] }>(`${base}?categoria=${encodeURIComponent(aperta)}`) : null,
    ]);
    if (fresche.ok) setCategorie(fresche.dati.categorie);
    setClienti(aperta && riga?.ok ? { [aperta]: riga.dati.clienti } : {});
  }

  const messaggioEsito = (e: EsitoDestinatari) => {
    const parti = [];
    if (e.aggiunti) parti.push(`${e.aggiunti} aggiunti`);
    if (e.rimossi) parti.push(`${e.rimossi} rimossi`);
    if (e.con_invio) parti.push(`${e.con_invio} non toglibili (hanno già un invio)`);
    if (e.non_validi) parti.push(`${e.non_validi} ignorati`);
    setEsito({ tipo: "ok", testo: parti.length ? parti.join(", ") + "." : "Nessuna variazione." });
  };

  if (categorie === null) {
    return (
      <div>
        <Button variant="outline" onClick={carica} disabled={occupato === "caricamento"}>
          {occupato === "caricamento" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Scegli per categoria
        </Button>
        {esito ? <div className="mt-3"><Messaggio tipo={esito.tipo}>{esito.testo}</Messaggio></div> : null}
      </div>
    );
  }

  const visibili = categorie.filter((c) => c.categoria.toLowerCase().includes(filtro.trim().toLowerCase()));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtra le categorie…" className="max-w-xs" />
        <span className="text-xs text-text-muted">I rivenditori non compaiono: sono esclusi sempre.</span>
      </div>
      {esito ? <div className="mb-3"><Messaggio tipo={esito.tipo}>{esito.testo}</Messaggio></div> : null}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {visibili.map((c) => {
          const espansa = aperta === c.categoria;
          const tutte = c.selezionati === c.totale;
          return (
            <li key={c.categoria}>
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => apriCategoria(c.categoria)}
                  aria-expanded={espansa}
                  className="flex min-w-0 items-center gap-2 text-left text-sm font-medium text-text"
                >
                  {occupato === c.categoria ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : espansa ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">{c.categoria}</span>
                  <span className="shrink-0 text-xs font-normal text-text-muted">
                    {c.selezionati} / {c.totale}
                  </span>
                </button>
                {!bloccata ? (
                  <span className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={tutte || occupato !== null}
                      onClick={() => modifica({ azione: "aggiungi_categorie", categorie: [c.categoria] }, `cat+${c.categoria}`, messaggioEsito)}
                    >
                      Seleziona tutta
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={c.selezionati === 0 || occupato !== null}
                      onClick={() => modifica({ azione: "rimuovi_categorie", categorie: [c.categoria] }, `cat-${c.categoria}`, messaggioEsito)}
                    >
                      Deseleziona
                    </Button>
                  </span>
                ) : null}
              </div>

              {espansa && clienti[c.categoria] ? (
                <ul className="max-h-80 divide-y divide-border overflow-y-auto border-t border-border bg-bg-page">
                  {clienti[c.categoria].map((cl) => (
                    <li key={cl.codice_cliente} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={cl.selezionato}
                        disabled={bloccata || occupato !== null || (cl.selezionato && cl.ha_invio)}
                        onChange={() =>
                          modifica(
                            { azione: cl.selezionato ? "rimuovi" : "aggiungi", codici: [cl.codice_cliente] },
                            `cl${cl.codice_cliente}`,
                            messaggioEsito
                          )
                        }
                        aria-label={`Seleziona ${cl.ragione_sociale}`}
                      />
                      <span className="min-w-0 flex-1 truncate">{cl.ragione_sociale}</span>
                      <span className="shrink-0 text-xs text-text-muted">
                        {cl.codice_cliente}
                        {cl.agente_nome ? ` · ${cl.agente_nome}` : ""}
                        {cl.ha_invio ? " · ha già un invio" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
        {visibili.length === 0 ? <li className="px-3 py-3 text-sm text-text-muted">Nessuna categoria.</li> : null}
      </ul>
    </div>
  );
}
