"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  LIVELLI,
  coperturaNodo,
  etichettaSelettore,
  livelloSelettore,
  nomeValore,
  percorsoNodo,
  profondita,
  scegli,
  statoNodo,
  togli,
  type Livello,
  type SelettoreArticolo,
} from "@/lib/portali/campagne/albero";
import type { AlberoRisposta, ArticoloTrovato, ConteggioPromossi, NodoAlbero } from "@/lib/portali/campagne/tipi";
import { chiamaApi } from "./api-client";

const num = (n: number) => n.toLocaleString("it-IT");
const NOME_LIVELLO: Record<Livello, string> = { fornitore: "Fornitore", gruppo: "Gruppo", categoria: "Categoria", articolo: "Articolo" };
const PAGINA = 100;
const BASE = "/api/portali/campagne/articoli";

/** Una casella con lo stato «alcune»: un ramo con dentro solo alcune scelte. */
function Casella({
  stato,
  onChange,
  etichetta,
  disabled,
  titolo,
}: {
  stato: "incluso" | "parziale" | "no";
  onChange: () => void;
  etichetta: string;
  disabled?: boolean;
  titolo?: string;
}) {
  const rif = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (rif.current) rif.current.indeterminate = stato === "parziale";
  }, [stato]);
  return (
    <input
      ref={rif}
      type="checkbox"
      checked={stato === "incluso"}
      onChange={onChange}
      disabled={disabled}
      title={titolo}
      aria-label={etichetta}
      className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[#00a1be] disabled:cursor-default disabled:opacity-60"
    />
  );
}

/**
 * Gli articoli promossi di una campagna, scelti scendendo l'anagrafica:
 * fornitore > gruppo > categoria > articolo. Si spunta un nodo a qualsiasi livello
 * («tutto questo fornitore», «solo questa categoria», «solo questo articolo») e la
 * selezione e' l'unione. In alto il totale: quanti articoli prende e quanti sono stati
 * davvero venduti, perche' una selezione senza venduto non da' niente all'Analisi.
 */
export function AlberoArticoli({
  selezione,
  onChange,
  disabled = false,
}: {
  selezione: SelettoreArticolo[];
  onChange: (s: SelettoreArticolo[]) => void;
  disabled?: boolean;
}) {
  const [testo, setTesto] = useState("");
  const [q, setQ] = useState("");
  const [conteggio, setConteggio] = useState<ConteggioPromossi | null>(null);
  const [contando, setContando] = useState(false);

  // La ricerca parte un attimo dopo l'ultimo tasto: l'anagrafica ha 25.000 articoli.
  useEffect(() => {
    const t = setTimeout(() => setQ(testo.trim().length >= 2 ? testo.trim() : ""), 350);
    return () => clearTimeout(t);
  }, [testo]);

  // Il totale si ricalcola a ogni cambio di selezione, senza martellare il server.
  const firma = JSON.stringify(selezione);
  useEffect(() => {
    if (selezione.length === 0) {
      setConteggio(null);
      return;
    }
    let attuale = true;
    setContando(true);
    const t = setTimeout(async () => {
      const r = await chiamaApi<ConteggioPromossi>(`${BASE}/conteggio`, { corpo: { selettori: selezione } });
      if (!attuale) return;
      setContando(false);
      setConteggio(r.ok ? r.dati : null);
    }, 400);
    return () => {
      attuale = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);

  const aggiungi = (nodo: SelettoreArticolo) => onChange(scegli(selezione, nodo));
  const rimuovi = (nodo: SelettoreArticolo) => onChange(togli(selezione, nodo));

  return (
    <div className="space-y-4">
      {/* ─── Cosa e' stato scelto ─── */}
      <div className="rounded-xl border border-border bg-bg-page/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-text">
            {selezione.length === 0 ? "Nessuna scelta" : `${num(selezione.length)} ${selezione.length === 1 ? "scelta" : "scelte"}`}
          </p>
          <p className="text-xs text-text-muted" aria-live="polite">
            {contando ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Conto gli articoli…
              </span>
            ) : conteggio ? (
              <>
                <strong className="text-text">{num(conteggio.articoli)}</strong> articoli, di cui{" "}
                <strong className={conteggio.venduti === 0 ? "text-warning" : "text-text"}>{num(conteggio.venduti)}</strong> venduti dal 13/01/2025
              </>
            ) : null}
          </p>
        </div>
        {selezione.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {selezione.map((s) => {
              const livello = livelloSelettore(s);
              return (
                <li key={etichettaSelettore(s)} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-white py-1 pl-3 pr-1.5 text-xs shadow-sm">
                  <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-dark">
                    {livello ? NOME_LIVELLO[livello] : ""}
                  </span>
                  <span className="min-w-0 truncate font-medium text-text" title={etichettaSelettore(s)}>
                    {etichettaSelettore(s)}
                  </span>
                  {!disabled ? (
                    <button
                      type="button"
                      onClick={() => rimuovi(s)}
                      aria-label={`Togli ${etichettaSelettore(s)}`}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-bg-page hover:text-danger"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-text-muted">Sfoglia qui sotto: spunta un fornitore, un gruppo, una categoria o un singolo articolo.</p>
        )}
        {conteggio && conteggio.articoli > 0 && conteggio.venduti === 0 ? (
          <p className="mt-2 text-xs text-warning">Nessuno di questi articoli compare nel fatturato: l&apos;Analisi non avrebbe acquisti da confrontare.</p>
        ) : null}
      </div>

      {/* ─── Ricerca ─── */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
        <Input
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          placeholder="Cerca un fornitore, un codice o una descrizione…"
          aria-label="Cerca nell'anagrafica articoli"
          className="pl-9"
          disabled={disabled}
        />
      </div>

      {q ? <ArticoliTrovati q={q} selezione={selezione} onScegli={aggiungi} onTogli={rimuovi} disabled={disabled} /> : null}

      {/* ─── L'albero ─── */}
      <div className="overflow-hidden rounded-xl border border-border bg-white">
        <ElencoNodi
          key={q}
          genitore={{}}
          q={q}
          selezione={selezione}
          onChange={onChange}
          disabled={disabled}
          radice
        />
      </div>
    </div>
  );
}

// ─── Articoli trovati dalla ricerca ────────────────────────────────────────
function ArticoliTrovati({
  q,
  selezione,
  onScegli,
  onTogli,
  disabled,
}: {
  q: string;
  selezione: SelettoreArticolo[];
  onScegli: (s: SelettoreArticolo) => void;
  onTogli: (s: SelettoreArticolo) => void;
  disabled: boolean;
}) {
  const [stato, setStato] = useState<{ articoli: ArticoloTrovato[]; totale: number } | "caricamento" | "errore">("caricamento");

  useEffect(() => {
    let attuale = true;
    setStato("caricamento");
    chiamaApi<{ articoli: ArticoloTrovato[]; totale: number }>(`${BASE}?cerca=${encodeURIComponent(q)}&limit=8`).then((r) => {
      if (attuale) setStato(r.ok ? r.dati : "errore");
    });
    return () => {
      attuale = false;
    };
  }, [q]);

  if (stato === "caricamento") return <p className="text-xs text-text-muted">Cerco gli articoli…</p>;
  if (stato === "errore") return <p className="text-xs text-danger">Ricerca non riuscita. Riprova.</p>;
  if (stato.articoli.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-white">
      <p className="border-b border-border bg-bg-page/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
        Articoli che corrispondono{stato.totale > stato.articoli.length ? ` · primi ${stato.articoli.length} di ${num(stato.totale)}` : ""}
      </p>
      <ul className="divide-y divide-border">
        {stato.articoli.map((a) => {
          const nodo: SelettoreArticolo = { f: a.fornitore, g: a.gruppo, c: a.categoria, a: a.codice };
          const st = statoNodo(nodo, selezione);
          const copertura = coperturaNodo(nodo, selezione);
          return (
            <li key={a.codice}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-bg-page/60">
                <Casella
                  stato={st}
                  disabled={disabled || copertura !== null}
                  titolo={copertura ? `Già compreso: ${etichettaSelettore(copertura)}` : undefined}
                  etichetta={`Scegli l'articolo ${a.codice}`}
                  onChange={() => (st === "incluso" ? onTogli(nodo) : onScegli(nodo))}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <span className="font-semibold text-text">{a.codice}</span>
                    <span className="text-text-muted"> · {a.descrizione ?? ""}</span>
                  </span>
                  <span className="block truncate text-xs text-text-muted">{etichettaSelettore({ f: a.fornitore, g: a.gruppo, c: a.categoria })}</span>
                </span>
                {copertura ? <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary-dark">già compreso</span> : null}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Un livello dell'albero ────────────────────────────────────────────────
/**
 * I figli di un nodo: si caricano quando il ramo si apre, a pagine da 100. Ogni figlio che
 * non e' un articolo puo' aprirsi a sua volta con un altro `ElencoNodi`.
 */
function ElencoNodi({
  genitore,
  q,
  selezione,
  onChange,
  disabled,
  radice = false,
}: {
  genitore: SelettoreArticolo;
  q: string;
  selezione: SelettoreArticolo[];
  onChange: (s: SelettoreArticolo[]) => void;
  disabled: boolean;
  radice?: boolean;
}) {
  const livello = LIVELLI[profondita(genitore)];
  const [nodi, setNodi] = useState<NodoAlbero[]>([]);
  const [totale, setTotale] = useState(0);
  const [stato, setStato] = useState<"caricamento" | "pronto" | "errore">("caricamento");
  const [aperto, setAperto] = useState<string | null>(null);

  async function carica(offset: number) {
    setStato("caricamento");
    const p = new URLSearchParams();
    if (genitore.f !== undefined) p.set("f", genitore.f);
    if (genitore.g !== undefined) p.set("g", genitore.g);
    if (genitore.c !== undefined) p.set("c", genitore.c);
    if (q) p.set("q", q);
    p.set("limit", String(PAGINA));
    p.set("offset", String(offset));
    const r = await chiamaApi<AlberoRisposta>(`${BASE}?${p.toString()}`);
    if (!r.ok) {
      setStato("errore");
      return;
    }
    setNodi((x) => (offset === 0 ? r.dati.nodi : [...x, ...r.dati.nodi]));
    setTotale(r.dati.totale);
    setStato("pronto");
  }

  useEffect(() => {
    void carica(0);
    // Il livello si ricarica solo se cambia il percorso o la ricerca: `key` sul componente lo garantisce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Solo ai fornitori, con una ricerca attiva: prenderli tutti con un clic («tutti i listini AIGNEP»).
  const tuttiCaricati = nodi.length >= totale;
  function sceglieTutti() {
    let s = selezione;
    for (const n of nodi) s = scegli(s, percorsoNodo(genitore, n.livello, n.valore));
    onChange(s);
  }

  return (
    <div>
      {radice && q && stato === "pronto" && nodi.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-bg-page/60 px-4 py-2 text-xs">
          <span className="text-text-muted">
            {num(totale)} {totale === 1 ? "fornitore corrisponde" : "fornitori corrispondono"} a «{q}»
          </span>
          <button
            type="button"
            onClick={sceglieTutti}
            disabled={disabled || !tuttiCaricati}
            title={tuttiCaricati ? undefined : "Restringi la ricerca: ce ne sono troppi per sceglierli tutti insieme"}
            className="font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            Scegli tutti i {num(nodi.length)} fornitori
          </button>
        </div>
      ) : null}

      <ul className={radice ? "max-h-[28rem] divide-y divide-border overflow-y-auto" : "divide-y divide-border"}>
        {nodi.map((n) => {
          const percorso = percorsoNodo(genitore, n.livello, n.valore);
          const foglia = n.livello === "articolo";
          const st = statoNodo(percorso, selezione);
          const copertura = coperturaNodo(percorso, selezione);
          const apribile = !foglia;
          const chiave = `${n.livello}:${n.valore}`;
          const eAperto = aperto === chiave;
          return (
            <li key={chiave}>
              <div className="flex items-center gap-3 px-4 py-2 hover:bg-bg-page/60">
                <Casella
                  stato={st}
                  disabled={disabled || copertura !== null}
                  titolo={copertura ? `Già compreso: ${etichettaSelettore(copertura)}` : undefined}
                  etichetta={`Scegli ${NOME_LIVELLO[n.livello].toLowerCase()} ${nomeValore(n.valore)}`}
                  onChange={() => {
                    // Un nodo scelto in proprio si toglie; uno parziale o libero si sceglie intero (e assorbe le scelte sotto).
                    if (st === "incluso") onChange(togli(selezione, percorso));
                    else onChange(scegli(selezione, percorso));
                  }}
                />
                {apribile ? (
                  <button
                    type="button"
                    onClick={() => setAperto(eAperto ? null : chiave)}
                    aria-expanded={eAperto}
                    aria-label={`Apri ${NOME_LIVELLO[n.livello].toLowerCase()} ${nomeValore(n.valore)}`}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {eAperto ? <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />}
                    <span className="min-w-0 truncate text-sm font-semibold text-text">{nomeValore(n.valore)}</span>
                    <span className="hidden shrink-0 rounded bg-bg-page px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted sm:inline">
                      {NOME_LIVELLO[n.livello]}
                    </span>
                  </button>
                ) : (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      <span className="font-semibold text-text">{n.valore}</span>
                      <span className="text-text-muted"> · {n.descrizione ?? ""}</span>
                    </span>
                  </span>
                )}
                {copertura ? <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary-dark">già compreso</span> : null}
                {apribile ? <span className="shrink-0 text-xs text-text-muted">{num(n.n)} articoli</span> : null}
              </div>
              {eAperto ? (
                <div className="ml-6 border-l-2 border-primary/20 bg-bg-page/40">
                  <ElencoNodi key={`${chiave}|${q}`} genitore={percorso} q={q} selezione={selezione} onChange={onChange} disabled={disabled} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {stato === "caricamento" ? (
        <p className="flex items-center gap-2 px-4 py-3 text-xs text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Carico {livello === "fornitore" ? "i fornitori" : livello === "gruppo" ? "i gruppi" : livello === "categoria" ? "le categorie" : "gli articoli"}…
        </p>
      ) : null}
      {stato === "errore" ? (
        <p className="px-4 py-3 text-xs text-danger">
          Non riesco a caricare questo livello.{" "}
          <button type="button" onClick={() => carica(nodi.length)} className="font-medium underline">
            Riprova
          </button>
        </p>
      ) : null}
      {stato === "pronto" && nodi.length === 0 ? <p className="px-4 py-3 text-sm text-text-muted">{q ? "Nessun risultato." : "Niente da mostrare."}</p> : null}
      {stato === "pronto" && nodi.length < totale ? (
        <button type="button" onClick={() => carica(nodi.length)} className="w-full border-t border-border px-4 py-2 text-left text-sm font-medium text-primary hover:bg-bg-page/60">
          Mostra altri {num(Math.min(PAGINA, totale - nodi.length))} (di {num(totale - nodi.length)})
        </button>
      ) : null}
    </div>
  );
}

