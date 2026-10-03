"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { CampagnaRiepilogo } from "@/lib/portali/campagne/tipi";

type Voce = Pick<CampagnaRiepilogo, "id" | "codice" | "nome">;

/** Da quante campagne in su compare la ricerca dentro il menu. */
const SOGLIA_RICERCA = 6;

/**
 * Il menu per scegliere le campagne dei filtri: un pulsante che riassume la scelta e,
 * aperto, un elenco con una casella per campagna (con ricerca quando sono tante).
 * Le caselle restano nella pagina anche a menu chiuso, con il loro `name`: il modulo
 * dei filtri e' un normale form GET e invia le campagne scelte senza altro codice.
 */
export function SelezioneCampagne({ campagne, selezionate }: { campagne: Voce[]; selezionate: string[] }) {
  const [scelte, setScelte] = useState<Set<string>>(new Set(selezionate));
  const [aperto, setAperto] = useState(false);
  const [q, setQ] = useState("");
  const radice = useRef<HTMLDivElement>(null);
  const idPannello = useId();

  // Si chiude cliccando fuori o con Esc.
  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => {
      if (radice.current && !radice.current.contains(e.target as Node)) setAperto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAperto(false);
    };
    document.addEventListener("mousedown", fuori);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuori);
      document.removeEventListener("keydown", esc);
    };
  }, [aperto]);

  const t = q.trim().toLowerCase();
  const visibili = useMemo(() => campagne.filter((c) => !t || `${c.codice} ${c.nome}`.toLowerCase().includes(t)), [campagne, t]);

  const alterna = (id: string) =>
    setScelte((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const imposta = (ids: string[], dentro: boolean) =>
    setScelte((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (dentro) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  const nScelte = campagne.filter((c) => scelte.has(c.id)).length;
  const riassunto =
    nScelte === 0
      ? "Tutte le campagne"
      : nScelte <= 2
        ? campagne.filter((c) => scelte.has(c.id)).map((c) => c.codice).join(", ")
        : `${nScelte} campagne scelte`;

  return (
    <div ref={radice} className="relative inline-block">
      <button
        type="button"
        onClick={() => setAperto((a) => !a)}
        aria-expanded={aperto}
        aria-controls={idPannello}
        className={`flex h-10 min-w-64 items-center justify-between gap-3 rounded-lg border bg-white px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          nScelte > 0 ? "border-primary text-primary-dark" : "border-border text-text hover:border-primary/50"
        }`}
      >
        <span className="truncate">{riassunto}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${aperto ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {/* `hidden` e non smontato: le caselle devono restare nel modulo anche a menu chiuso. */}
      <div
        id={idPannello}
        hidden={!aperto}
        className="absolute left-0 top-full z-40 mt-1.5 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-border bg-white shadow-[0_12px_32px_rgba(15,23,32,0.14)]"
      >
        {campagne.length >= SOGLIA_RICERCA ? (
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca una campagna…"
              aria-label="Cerca una campagna"
              className="h-9 w-full rounded-lg border border-border bg-bg-page pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        ) : null}
        <div className="flex items-center justify-between border-b border-border bg-bg-page/60 px-3 py-1.5 text-xs">
          <span className="text-text-muted">{nScelte === 0 ? "Nessuna scelta = tutte" : `${nScelte} su ${campagne.length}`}</span>
          <span className="flex gap-3">
            <button type="button" onClick={() => imposta(visibili.map((c) => c.id), true)} disabled={visibili.length === 0} className="font-medium text-primary hover:underline disabled:opacity-40">
              Scegli {t ? "i visibili" : "tutte"}
            </button>
            <button type="button" onClick={() => imposta(campagne.map((c) => c.id), false)} disabled={nScelte === 0} className="font-medium text-text-muted hover:text-primary hover:underline disabled:opacity-40">
              Nessuna
            </button>
          </span>
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {campagne.map((c) => {
            const scelta = scelte.has(c.id);
            const nascosta = !visibili.includes(c);
            return (
              <li key={c.id} hidden={nascosta}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-bg-page/70">
                  <input type="checkbox" name="campagna_id" value={c.id} checked={scelta} onChange={() => alterna(c.id)} className="peer sr-only" />
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-1 ${
                      scelta ? "border-primary bg-primary text-white" : "border-border bg-white"
                    }`}
                    aria-hidden
                  >
                    {scelta ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-text">{c.codice}</span>
                    <span className="block truncate text-xs text-text-muted">{c.nome}</span>
                  </span>
                </label>
              </li>
            );
          })}
          {visibili.length === 0 ? <li className="px-3 py-5 text-center text-sm text-text-muted">Nessuna campagna corrisponde.</li> : null}
        </ul>
      </div>
    </div>
  );
}
