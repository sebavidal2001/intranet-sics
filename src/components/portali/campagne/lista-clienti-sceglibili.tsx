"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClientePubblico } from "@/lib/portali/campagne/regola";

const num = (n: number) => n.toLocaleString("it-IT");
const PAGINA = 150;

/**
 * L'elenco di clienti da spuntare uno per uno, uguale sotto un commerciale e sotto
 * una categoria di attività. Chi è già dentro per la regola (commerciale preso «Tutti»
 * con lo stato e le categorie giuste) si vede spuntato e bloccato: per toglierlo si
 * cambia la regola, non lo si sceglie di nuovo. Gli altri entrano come scelti a mano.
 */
export function ListaClientiSceglibili({
  clienti,
  extra,
  daRegola,
  onExtra,
  etichetta,
  mostraAgente = false,
  mostraCategoria = true,
}: {
  clienti: ClientePubblico[];
  /** I clienti scelti a mano. */
  extra: Set<string>;
  /** Il cliente è già dentro per la regola, a prescindere dalla scelta a mano. */
  daRegola: (c: ClientePubblico) => boolean;
  onExtra: (s: Set<string>) => void;
  etichetta: string;
  mostraAgente?: boolean;
  mostraCategoria?: boolean;
}) {
  const [q, setQ] = useState("");
  const [soloScelti, setSoloScelti] = useState(false);
  const [mostrati, setMostrati] = useState(PAGINA);

  const t = q.trim().toLowerCase();
  const visibili = useMemo(
    () =>
      clienti.filter(
        (c) =>
          (!t || `${c.ragione_sociale} ${c.codice_cliente} ${c.cat_attivita ?? ""} ${c.agente_nome ?? ""}`.toLowerCase().includes(t)) &&
          (!soloScelti || extra.has(c.codice_cliente))
      ),
    [clienti, t, soloScelti, extra]
  );
  // Quelli che si possono davvero spuntare: i già-dentro-per-regola non si toccano.
  const sceglibili = visibili.filter((c) => !daRegola(c));
  const sceltiQui = clienti.filter((c) => extra.has(c.codice_cliente)).length;
  const dentroPerRegola = clienti.filter(daRegola).length;

  function imposta(codici: string[], dentro: boolean) {
    const n = new Set(extra);
    for (const c of codici) {
      if (dentro) n.add(c);
      else n.delete(c);
    }
    onExtra(n);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setMostrati(PAGINA);
            }}
            placeholder="Cerca per nome, codice o commerciale…"
            aria-label={etichetta}
            className="pl-9"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
          <input type="checkbox" checked={soloScelti} onChange={(e) => setSoloScelti(e.target.checked)} className="accent-[#00a1be]" />
          Solo i scelti
        </label>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => imposta(sceglibili.map((c) => c.codice_cliente), true)} disabled={sceglibili.length === 0}>
            Scegli i {num(sceglibili.length)} visibili
          </Button>
          <Button size="sm" variant="ghost" onClick={() => imposta(visibili.map((c) => c.codice_cliente), false)} disabled={visibili.length === 0}>
            Togli i visibili
          </Button>
        </span>
      </div>
      <p className="mb-2 text-xs text-text-muted">
        <strong className="text-text">{num(sceltiQui)}</strong> scelti a mano su {num(clienti.length)}
        {dentroPerRegola > 0 ? <> · {num(dentroPerRegola)} già dentro per la regola</> : null}. I clienti scelti a mano entrano a prescindere dai filtri.
      </p>
      <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-white">
        {visibili.slice(0, mostrati).map((c) => {
          const regola = daRegola(c);
          return (
            <li key={c.codice_cliente}>
              <label className={`flex items-center gap-3 px-3 py-2 text-sm ${regola ? "cursor-default bg-bg-page/60" : "cursor-pointer hover:bg-bg-page/70"}`}>
                <input
                  type="checkbox"
                  checked={regola || extra.has(c.codice_cliente)}
                  disabled={regola}
                  onChange={(e) => imposta([c.codice_cliente], e.target.checked)}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[#00a1be] disabled:cursor-default disabled:opacity-60"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text">{c.ragione_sociale}</span>
                  <span className="block truncate text-xs text-text-muted">
                    {c.codice_cliente}
                    {mostraCategoria && c.cat_attivita ? ` · ${c.cat_attivita}` : ""}
                    {mostraAgente ? ` · ${c.agente_nome?.trim() || "senza agente"}` : ""}
                  </span>
                </span>
                {regola ? (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary-dark">già dentro</span>
                ) : (
                  <span className="shrink-0 text-xs text-text-muted">{c.cat_commerciale && c.cat_commerciale !== "-" ? c.cat_commerciale : ""}</span>
                )}
              </label>
            </li>
          );
        })}
        {visibili.length === 0 ? <li className="px-3 py-6 text-center text-sm text-text-muted">Nessun cliente corrisponde.</li> : null}
      </ul>
      {visibili.length > mostrati ? (
        <button type="button" onClick={() => setMostrati((m) => m + PAGINA)} className="mt-2 text-sm font-medium text-primary hover:underline">
          Mostra altri {num(Math.min(PAGINA, visibili.length - mostrati))} (di {num(visibili.length - mostrati)})
        </button>
      ) : null}
    </div>
  );
}
