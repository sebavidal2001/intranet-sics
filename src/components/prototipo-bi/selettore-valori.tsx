"use client";

/**
 * Scegliere i valori di un filtro invece di scriverli.
 *
 * Prima il filtro «classico» chiedeva di digitare il valore esatto («Valori
 * separati da virgola»): bastava una maiuscola diversa per non trovare niente,
 * e nessuno sapeva quali valori esistessero. Qui i valori si leggono dai dati:
 *
 *  · Business unit e Categoria → albero a matrioska: la business unit intera,
 *    oppure aperta e scelta per categorie (vedi lib/prototipo-bi/filtro-albero);
 *  · ogni altro campo → elenco ricercabile a scelta multipla.
 *
 * I valori arrivano dal motore con una query raggruppata sul campo, per la
 * metrica e il periodo della domanda: si propone solo cio' che c'e' davvero.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import {
  alberoDaRighe,
  filtroDaSelezione,
  ramiDi,
  riassuntoSelezione,
  selezioneDaFiltro,
  type NodoBu,
} from "@/lib/prototipo-bi/filtro-albero";
import type { ChiaveMetrica, Dimensione, Filtro, Periodo, SpecQuery } from "@/lib/prototipo-bi/tipi";

type Righe = { chiavi: Record<string, string>; etichetta: string; valore: number }[];

// I valori si chiedono una volta per combinazione: aprire e chiudere il
// selettore non deve rifare la query.
const cacheValori = new Map<string, Promise<Righe>>();

function caricaValori(spec: SpecQuery): Promise<Righe> {
  const chiave = JSON.stringify(spec);
  let p = cacheValori.get(chiave);
  if (!p) {
    p = fetch("/api/bi/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specs: [{ id: "valori", spec }] }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Valori non disponibili");
        const voce = (j.risultati ?? [])[0];
        if (voce?.errore) throw new Error(voce.errore);
        return (voce?.risultato?.righe ?? []) as Righe;
      })
      .catch((e) => {
        cacheValori.delete(chiave);
        throw e;
      });
    cacheValori.set(chiave, p);
  }
  return p;
}

export function eAlbero(campo: Dimensione): boolean {
  return campo === "bu" || campo === "categoria" || campo === "bu_categoria";
}

function valoriDi(filtro: Filtro | null | undefined): string[] {
  if (!filtro) return [];
  return (Array.isArray(filtro.valore) ? filtro.valore : [filtro.valore]).filter(Boolean);
}

export function SelettoreValori({
  campo,
  metrica,
  periodo,
  filtro,
  onChange,
  etichetta = "Valori",
}: {
  campo: Dimensione;
  metrica: ChiaveMetrica;
  periodo?: Periodo;
  filtro: Filtro | null | undefined;
  /** `null` = nessuna restrizione (niente scelto, o tutto scelto). */
  onChange: (filtro: Filtro | null) => void;
  etichetta?: string;
}) {
  const albero = eAlbero(campo);
  const [aperto, setAperto] = useState(false);
  const [righe, setRighe] = useState<Righe | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [cerca, setCerca] = useState("");
  const [espansi, setEspansi] = useState<Set<string>>(new Set());
  const contenitore = useRef<HTMLDivElement>(null);

  const spec = useMemo<SpecQuery>(
    () => ({
      metrica,
      raggruppa: albero ? ["bu", "categoria"] : [campo],
      ...(periodo ? { periodo } : {}),
      ordina: albero ? "etichetta" : "valore_desc",
    }),
    [metrica, campo, albero, periodo]
  );

  // Si carica alla prima apertura, e subito se c'e' gia' un filtro da riassumere.
  const serve = aperto || valoriDi(filtro).length > 0;
  useEffect(() => {
    if (!serve) return;
    let annullato = false;
    setErrore(null);
    caricaValori(spec)
      .then((r) => !annullato && setRighe(r))
      .catch((e) => !annullato && setErrore(e instanceof Error ? e.message : "Errore"));
    return () => {
      annullato = true;
    };
  }, [spec, serve]);

  // Chiusura cliccando fuori.
  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => {
      if (contenitore.current && !contenitore.current.contains(e.target as Node)) setAperto(false);
    };
    document.addEventListener("mousedown", fuori);
    return () => document.removeEventListener("mousedown", fuori);
  }, [aperto]);

  const nodi: NodoBu[] = useMemo(() => (albero && righe ? alberoDaRighe(righe) : []), [albero, righe]);
  const selezioneAlbero = useMemo(() => selezioneDaFiltro(nodi, filtro), [nodi, filtro]);
  const elenco = useMemo(
    () => (!albero && righe ? [...new Set(righe.map((r) => r.chiavi[campo] ?? r.etichetta).filter(Boolean))] : []),
    [albero, righe, campo]
  );
  const sceltiElenco = useMemo(() => new Set(valoriDi(filtro)), [filtro]);

  const riassunto = albero
    ? nodi.length > 0
      ? riassuntoSelezione(nodi, selezioneAlbero)
      : valoriDi(filtro).length > 0
        ? `${valoriDi(filtro).length} selezionati`
        : "Tutte"
    : sceltiElenco.size === 0
      ? "Tutti"
      : sceltiElenco.size === 1
        ? [...sceltiElenco][0]
        : `${sceltiElenco.size} selezionati`;

  const ago = cerca.trim().toLowerCase();

  function applicaAlbero(nuova: Set<string>) {
    onChange(filtroDaSelezione(nodi, nuova));
  }

  function alternaNodo(nodo: NodoBu) {
    const rami = ramiDi(nodo);
    const tutti = rami.every((r) => selezioneAlbero.has(r));
    const nuova = new Set(selezioneAlbero);
    for (const r of rami) {
      if (tutti) nuova.delete(r);
      else nuova.add(r);
    }
    applicaAlbero(nuova);
  }

  function alternaRamo(r: string) {
    const nuova = new Set(selezioneAlbero);
    if (nuova.has(r)) nuova.delete(r);
    else nuova.add(r);
    applicaAlbero(nuova);
  }

  function alternaValore(v: string) {
    const nuovi = new Set(sceltiElenco);
    if (nuovi.has(v)) nuovi.delete(v);
    else nuovi.add(v);
    const lista = [...nuovi];
    onChange(
      lista.length === 0
        ? null
        : lista.length === 1
          ? { campo, op: "eq", valore: lista[0] }
          : { campo, op: "in", valore: lista }
    );
  }

  return (
    <div ref={contenitore} className="relative">
      <button
        type="button"
        aria-label={etichetta}
        aria-expanded={aperto}
        onClick={() => setAperto((v) => !v)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-bg-page px-3 text-left text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <span className="truncate">{riassunto}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
      </button>

      {aperto && (
        <div
          role="dialog"
          aria-label={`Scegli ${etichetta.toLowerCase()}`}
          className="absolute z-30 mt-1 w-[min(22rem,90vw)] rounded-xl border border-border bg-bg p-2 shadow-lg"
        >
          <div className="mb-2 flex items-center gap-2">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-text-muted" aria-hidden />
              <span className="sr-only">Cerca</span>
              <input
                autoFocus
                value={cerca}
                onChange={(e) => setCerca(e.target.value)}
                placeholder="Cerca"
                className="h-9 w-full rounded-lg border border-border bg-bg-page pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2 text-xs text-text-muted hover:text-danger"
              title="Togli il filtro"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Nessuno
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto pr-1 text-sm">
            {errore && <p className="p-2 text-xs text-danger">{errore}</p>}
            {!righe && !errore && <p className="p-2 text-xs text-text-muted">Caricamento dei valori…</p>}

            {albero &&
              nodi
                .filter((n) => !ago || n.bu.toLowerCase().includes(ago) || n.categorie.some((c) => c.toLowerCase().includes(ago)))
                .map((n) => {
                  const rami = ramiDi(n);
                  const scelti = rami.filter((r) => selezioneAlbero.has(r)).length;
                  const tutti = scelti === rami.length;
                  const aperta = espansi.has(n.bu) || (ago !== "" && !n.bu.toLowerCase().includes(ago));
                  return (
                    <div key={n.bu}>
                      <div className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-bg-page">
                        <button
                          type="button"
                          aria-label={aperta ? `Chiudi ${n.bu}` : `Apri ${n.bu}`}
                          onClick={() =>
                            setEspansi((s) => {
                              const x = new Set(s);
                              if (x.has(n.bu)) x.delete(n.bu);
                              else x.add(n.bu);
                              return x;
                            })
                          }
                          className="rounded p-0.5 text-text-muted hover:text-text"
                        >
                          {aperta ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                        </button>
                        <label className="flex flex-1 cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={tutti}
                            ref={(el) => {
                              if (el) el.indeterminate = scelti > 0 && !tutti;
                            }}
                            onChange={() => alternaNodo(n)}
                            className="h-4 w-4 accent-[var(--color-primary)]"
                          />
                          <span className="font-medium">{n.bu}</span>
                          {scelti > 0 && !tutti && (
                            <span className="text-[11px] text-text-muted">
                              {scelti} di {rami.length}
                            </span>
                          )}
                        </label>
                      </div>
                      {aperta && (
                        <div className="ml-7 border-l border-border pl-2">
                          {n.categorie
                            .filter((c) => !ago || n.bu.toLowerCase().includes(ago) || c.toLowerCase().includes(ago))
                            .map((c) => {
                              const r = rami[n.categorie.indexOf(c)];
                              return (
                                <label key={r} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-bg-page">
                                  <input
                                    type="checkbox"
                                    checked={selezioneAlbero.has(r)}
                                    onChange={() => alternaRamo(r)}
                                    className="h-4 w-4 accent-[var(--color-primary)]"
                                  />
                                  <span>{c === "-" ? "(senza categoria)" : c}</span>
                                </label>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  );
                })}

            {!albero &&
              elenco
                .filter((v) => !ago || v.toLowerCase().includes(ago))
                .slice(0, 300)
                .map((v) => (
                  <label key={v} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-bg-page">
                    <input
                      type="checkbox"
                      checked={sceltiElenco.has(v)}
                      onChange={() => alternaValore(v)}
                      className="h-4 w-4 accent-[var(--color-primary)]"
                    />
                    <span className="truncate">{v}</span>
                  </label>
                ))}
            {!albero && righe && elenco.length > 300 && ago === "" && (
              <p className="p-2 text-[11px] text-text-muted">
                {elenco.length} valori: scrivi nella ricerca per trovare gli altri.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
