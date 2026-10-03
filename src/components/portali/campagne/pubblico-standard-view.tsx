"use client";

import { useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PubblicoStandardResponse } from "@/lib/portali/campagne/tipi";
import { chiamaApi } from "./api-client";
import { Campo, Messaggio, Pannello } from "./ui";

/** Un elenco di valori brevi (agenti, categorie) come etichette che si aggiungono e si tolgono. */
function Etichette({
  valori,
  onChange,
  segnaposto,
}: {
  valori: string[];
  onChange: (v: string[]) => void;
  segnaposto: string;
}) {
  const [bozza, setBozza] = useState("");
  const aggiungi = () => {
    const v = bozza.trim();
    if (v && !valori.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...valori, v]);
    setBozza("");
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {valori.length === 0 ? <span className="text-xs text-text-muted">Nessuno</span> : null}
        {valori.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary-dark">
            {v}
            <button type="button" onClick={() => onChange(valori.filter((x) => x !== v))} aria-label={`Togli ${v}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={bozza}
          onChange={(e) => setBozza(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              aggiungi();
            }
          }}
          placeholder={segnaposto}
          className="max-w-xs"
        />
        <Button type="button" variant="outline" onClick={aggiungi} disabled={!bozza.trim()}>
          Aggiungi
        </Button>
      </div>
    </div>
  );
}

/**
 * Lo scenario standard: a chi si rivolge, di norma, una campagna. Si configura
 * la prima volta e viene riproposto a ogni campagna nuova. Vale per quelle create
 * DOPO: le campagne esistenti hanno la loro fotografia dei destinatari.
 */
export function PubblicoStandardView({ iniziale }: { iniziale: PubblicoStandardResponse }) {
  const [dati, setDati] = useState(iniziale);
  const [agenti, setAgenti] = useState(iniziale.config.agenti);
  const [categorie, setCategorie] = useState(iniziale.config.categorie_commerciali);
  const [extra, setExtra] = useState(new Set(iniziale.config.clienti_extra));
  const [filtro, setFiltro] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [esito, setEsito] = useState<{ tipo: "errore" | "ok"; testo: string } | null>(null);

  const modificato =
    JSON.stringify(agenti) !== JSON.stringify(dati.config.agenti) ||
    JSON.stringify(categorie) !== JSON.stringify(dati.config.categorie_commerciali) ||
    JSON.stringify([...extra].sort()) !== JSON.stringify([...dati.config.clienti_extra].sort());

  // Per agente, perché "una selezione di quelli di VALERIA BATTELANI o DANIELE BONI" si sceglie così.
  const perAgente = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    const gruppi = new Map<string, PubblicoStandardResponse["candidati"]>();
    for (const c of dati.candidati) {
      if (t && !`${c.ragione_sociale} ${c.codice_cliente}`.toLowerCase().includes(t)) continue;
      const k = c.agente_nome ?? "(senza agente)";
      gruppi.set(k, [...(gruppi.get(k) ?? []), c]);
    }
    return [...gruppi.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [dati.candidati, filtro]);

  const alternaExtra = (codice: string) =>
    setExtra((s) => {
      const n = new Set(s);
      if (n.has(codice)) n.delete(codice);
      else n.add(codice);
      return n;
    });

  async function salva() {
    setOccupato(true);
    setEsito(null);
    const r = await chiamaApi<PubblicoStandardResponse>("/api/portali/campagne/pubblico-standard", {
      metodo: "PUT",
      corpo: { agenti, categorie_commerciali: categorie, clienti_extra: [...extra] },
    });
    setOccupato(false);
    if (!r.ok) {
      setEsito({ tipo: "errore", testo: r.errore });
      return;
    }
    setDati(r.dati);
    setAgenti(r.dati.config.agenti);
    setCategorie(r.dati.config.categorie_commerciali);
    setExtra(new Set(r.dati.config.clienti_extra));
    setEsito({ tipo: "ok", testo: `Salvato. Il pubblico standard raggiunge ${r.dati.raggiunti.toLocaleString("it-IT")} clienti.` });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-tenorite text-2xl font-bold text-text">Pubblico standard</h1>
        <p className="mt-1 text-sm text-text-muted">
          A chi si rivolge, di norma, una campagna. Viene riproposto a ogni nuova campagna; per una campagna mirata si sceglie a parte per categoria.
          I rivenditori sono esclusi sempre.
        </p>
      </div>

      <Pannello>
        <p className="font-tenorite text-3xl font-bold text-text">{dati.raggiunti.toLocaleString("it-IT")}</p>
        <p className="text-sm text-text-muted">clienti raggiunti oggi dalla regola salvata (rivenditori esclusi)</p>
      </Pannello>

      <Pannello titolo="Regola">
        <div className="grid gap-6 sm:grid-cols-2">
          <Campo etichetta="Tutti i clienti degli agenti">
            <Etichette valori={agenti} onChange={setAgenti} segnaposto="es. AIRFLUID" />
          </Campo>
          <Campo etichetta="…con categoria commerciale">
            <Etichette valori={categorie} onChange={setCategorie} segnaposto="es. Attivo" />
          </Campo>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          «Attivo» lascia fuori i «Potenziale»: si scrive solo a chi è già cliente.
        </p>
      </Pannello>

      <Pannello titolo={`Clienti di altri agenti da includere · ${extra.size}`}>
        <p className="mb-3 text-sm text-text-muted">
          Una selezione dei clienti che non rientrano nella regola (di norma quelli di VALERIA BATTELANI e DANIELE BONI).
        </p>
        <Input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Cerca per nome o codice…" className="mb-3 max-w-xs" />
        {perAgente.length === 0 ? (
          <p className="text-sm text-text-muted">Nessun cliente da mostrare.</p>
        ) : (
          <div className="max-h-96 space-y-4 overflow-y-auto rounded-xl border border-border p-3">
            {perAgente.map(([agente, lista]) => (
              <div key={agente}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {agente} · {lista.filter((c) => extra.has(c.codice_cliente)).length} / {lista.length}
                </p>
                <ul>
                  {lista.map((c) => (
                    <li key={c.codice_cliente}>
                      <label className="flex cursor-pointer items-center gap-3 py-1 text-sm">
                        <input type="checkbox" checked={extra.has(c.codice_cliente)} onChange={() => alternaExtra(c.codice_cliente)} />
                        <span className="min-w-0 flex-1 truncate">{c.ragione_sociale}</span>
                        <span className="shrink-0 text-xs text-text-muted">
                          {c.codice_cliente}
                          {c.cat_commerciale ? ` · ${c.cat_commerciale}` : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Pannello>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={salva} disabled={occupato || !modificato || agenti.length === 0 || categorie.length === 0}>
          {occupato ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salva pubblico standard
        </Button>
        {esito ? <Messaggio tipo={esito.tipo}>{esito.testo}</Messaggio> : null}
      </div>
    </div>
  );
}
