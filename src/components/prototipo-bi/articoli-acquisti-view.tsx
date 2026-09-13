"use client";


import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Boxes,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { euro, numero, percentuale } from "./primitivi";
import type { ArticoloAcquisti, CruscottoArticoli } from "@/lib/prototipo-bi/articoli";

type Filtri = {
  cerca: string;
  categoria: string;
  fornitore: string;
  magazzino: string;
  critici: boolean;
};

const FILTRI_INIZIALI: Filtri = {
  cerca: "",
  categoria: "",
  fornitore: "",
  magazzino: "",
  critici: false,
};

function dataIt(v: string | null) {
  if (!v) return "n/d";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString("it-IT");
}

function Barra({ valore, massimo, colore = "bg-primary" }: { valore: number; massimo: number; colore?: string }) {
  const pct = massimo > 0 ? Math.max(2, Math.min(100, (valore / massimo) * 100)) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
      <div className={`h-full rounded-full ${colore}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatoCosto({ articolo }: { articolo: ArticoloAcquisti }) {
  if (articolo.costo === null || articolo.costo <= 0) {
    return <span className="text-[10px] font-semibold text-danger">costo assente</span>;
  }
  if (articolo.costoStale) {
    return <span className="text-[10px] font-semibold text-warning">costo da verificare</span>;
  }
  return <span className="text-[10px] font-semibold text-success">costo aggiornato</span>;
}

function RigaUrgenza({ articolo }: { articolo: ArticoloAcquisti }) {
  const [aperta, setAperta] = useState(false);
  return (
    <>
      <tr className="border-b border-border/70 align-top hover:bg-slate-50/80">
        <td className="py-3 pl-4 pr-2">
          <button
            type="button"
            onClick={() => setAperta((v) => !v)}
            className="group flex max-w-[320px] items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-expanded={aperta}
          >
            <span className="mt-0.5 rounded-md bg-slate-100 p-1 text-text-muted group-hover:text-primary">
              {aperta ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-text">{articolo.codice}</span>
              <span className="mt-0.5 block truncate text-xs text-text-muted">{articolo.descrizione}</span>
              <StatoCosto articolo={articolo} />
            </span>
          </button>
        </td>
        <td className="px-2 py-3 text-xs text-text-muted">
          <span className="block max-w-[150px] truncate text-text">{articolo.fornitore}</span>
          <span>{articolo.categoria}</span>
        </td>
        <td className="px-2 py-3 text-right tabular-nums">{numero(articolo.esistenza)}</td>
        <td className="px-2 py-3 text-right tabular-nums">{numero(articolo.ordiniClienti)}</td>
        <td className="px-2 py-3 text-right tabular-nums text-primary">{numero(articolo.ordiniFornitori)}</td>
        <td className="px-2 py-3 text-right tabular-nums font-bold text-danger">
          {numero(articolo.scoperto)}
        </td>
        <td className="py-3 pl-2 pr-4 text-right tabular-nums font-semibold">
          {articolo.valoreScoperto === null ? "n/d" : euro(articolo.valoreScoperto)}
        </td>
      </tr>
      {aperta && (
        <tr className="border-b border-border bg-slate-50">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
              <div><span className="block text-text-muted">Disponibilità</span><strong>{numero(articolo.disponibilita)}</strong></div>
              <div><span className="block text-text-muted">Impegni produzione</span><strong>{numero(articolo.impegniProduzione)}</strong></div>
              <div><span className="block text-text-muted">Ordini produzione</span><strong>{numero(articolo.ordiniProduzione)}</strong></div>
              <div><span className="block text-text-muted">Ultimo costo</span><strong>{articolo.costo === null ? "n/d" : euro(articolo.costo, false)}</strong></div>
              <div><span className="block text-text-muted">Data costo</span><strong>{articolo.dataCosto ?? "n/d"}</strong></div>
              <div><span className="block text-text-muted">Valore in arrivo</span><strong>{articolo.valoreInArrivo === null ? "n/d" : euro(articolo.valoreInArrivo)}</strong></div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function ArticoliAcquistiView() {
  const [filtri, setFiltri] = useState<Filtri>(FILTRI_INIZIALI);
  const [dati, setDati] = useState<CruscottoArticoli | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [mostraTutte, setMostraTutte] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCaricamento(true);
      setErrore(null);
      const p = new URLSearchParams();
      if (filtri.cerca) p.set("cerca", filtri.cerca);
      if (filtri.categoria) p.set("categoria", filtri.categoria);
      if (filtri.fornitore) p.set("fornitore", filtri.fornitore);
      if (filtri.magazzino) p.set("magazzino", filtri.magazzino);
      if (filtri.critici) p.set("critici", "1");
      try {
        const r = await fetch(`/api/bi/articoli?${p}`, { signal: controller.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Errore");
        setDati(j);
      } catch (e) {
        if (!controller.signal.aborted) setErrore(e instanceof Error ? e.message : "Errore");
      } finally {
        if (!controller.signal.aborted) setCaricamento(false);
      }
    }, filtri.cerca ? 280 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filtri, nonce]);

  const r = dati?.riepilogo;
  const massimoFornitore = useMemo(
    () => Math.max(0, ...(dati?.fornitori.map((f) => f.valoreInArrivo + f.valoreScoperto) ?? [])),
    [dati]
  );
  const massimoCategoria = useMemo(
    () => Math.max(0, ...(dati?.categorie.map((c) => c.valoreGiacenza) ?? [])),
    [dati]
  );
  const filtriAttivi = Object.values(filtri).filter(Boolean).length;
  const urgenzeVisibili = mostraTutte ? dati?.urgenze ?? [] : (dati?.urgenze ?? []).slice(0, 25);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-6 lg:px-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-primary">
            <ShoppingCart className="h-5 w-5" aria-hidden />
            <span className="font-tenorite text-sm uppercase tracking-wide">Presidio operativo</span>
          </div>
          <h1 className="font-tenorite text-2xl font-bold text-text">Articoli &amp; Acquisti</h1>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">
            Scorte, disponibilità e ordini fornitori letti insieme. Lo scoperto usa la disponibilità del gestionale, che include già gli arrivi confermati.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          disabled={caricamento}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${caricamento ? "animate-spin" : ""}`} aria-hidden />
          Aggiorna lettura
        </button>
      </header>

      <section aria-label="Filtri articoli" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-bg p-3">
        <label className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" aria-hidden />
          <span className="sr-only">Cerca codice, descrizione o fornitore</span>
          <input
            value={filtri.cerca}
            onChange={(e) => setFiltri((f) => ({ ...f, cerca: e.target.value }))}
            placeholder="Cerca codice, descrizione o fornitore"
            className="h-9 w-full rounded-lg border border-border bg-bg-page pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        {([
          ["categoria", "Tutte le categorie", dati?.filtri.categorie ?? []],
          ["fornitore", "Tutti i fornitori", dati?.filtri.fornitori ?? []],
          ["magazzino", "Tutti i magazzini", dati?.filtri.magazzini ?? []],
        ] as const).map(([campo, vuoto, opzioni]) => (
          <label key={campo}>
            <span className="sr-only">{vuoto}</span>
            <select
              value={filtri[campo]}
              onChange={(e) => setFiltri((f) => ({ ...f, [campo]: e.target.value }))}
              className="h-9 max-w-[220px] rounded-lg border border-border bg-bg px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">{vuoto}</option>
              {opzioni.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-bg-page">
          <input
            type="checkbox"
            checked={filtri.critici}
            onChange={(e) => setFiltri((f) => ({ ...f, critici: e.target.checked }))}
            className="accent-primary"
          />
          Solo scoperti
        </label>
        {filtriAttivi > 0 && (
          <button type="button" onClick={() => setFiltri(FILTRI_INIZIALI)} className="px-2 text-xs font-medium text-primary hover:underline">
            Azzera {filtriAttivi} {filtriAttivi === 1 ? "filtro" : "filtri"}
          </button>
        )}
      </section>

      {errore && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {errore}
        </div>
      )}

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mb-5 overflow-hidden rounded-2xl bg-slate-900 text-white"
        aria-busy={caricamento}
      >
        <div className="grid lg:grid-cols-[1.15fr_2fr]">
          <div className="flex min-h-[190px] flex-col justify-between bg-danger/90 p-5 lg:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-50">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Fabbisogno scoperto dopo gli arrivi registrati
            </div>
            <div>
              <div className="font-tenorite text-4xl font-bold tabular-nums lg:text-5xl">
                {r ? euro(r.valoreScoperto) : "—"}
              </div>
              <p className="mt-2 text-sm text-red-50">
                {r
                  ? `${numero(r.articoliCritici)} articoli · ${numero(r.quantitaScoperta)} unità`
                  : caricamento
                    ? "Calcolo in corso"
                    : "Dato non disponibile"}
              </p>
              <p className="mt-1 text-[11px] text-red-100/80">Valorizzazione all’ultimo costo disponibile; gli articoli senza costo restano esclusi dall’importo.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-700 lg:grid-cols-4 lg:divide-y-0">
            {[
              { icona: Boxes, nome: "Valore giacenza", valore: r ? euro(r.valoreGiacenza) : "—", nota: "esistenza positiva" },
              { icona: Truck, nome: "In arrivo", valore: r ? euro(r.valoreInArrivo) : "—", nota: "ordini fornitori" },
              { icona: PackageCheck, nome: "Articoli letti", valore: r ? numero(r.articoli) : "—", nota: r ? `${r.fornitori} fornitori` : "dato non disponibile" },
              { icona: ShieldCheck, nome: "Copertura costi", valore: r ? percentuale(r.coperturaCostiPct) : "—", nota: "articoli valorizzabili" },
            ].map((k) => (
              <div key={k.nome} className="flex min-h-[150px] flex-col justify-between p-4 lg:min-h-[190px] lg:p-5">
                <k.icona className="h-5 w-5 text-cyan-300" aria-hidden />
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">{k.nome}</div>
                  <div className="mt-1 font-tenorite text-xl font-bold tabular-nums lg:text-2xl">{k.valore}</div>
                  <div className="mt-1 text-[11px] text-slate-500">{k.nota}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-bg">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 className="font-tenorite text-base font-bold">Coda di presidio acquisti</h2>
              <p className="mt-0.5 text-xs text-text-muted">Prima gli scoperti valorizzati, poi le righe con domanda cliente. Apri una riga per vedere il calcolo.</p>
            </div>
            <span className="rounded-full bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger">{dati ? `${dati.urgenze.length} evidenze` : "—"}</span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="py-2.5 pl-4 pr-2 font-semibold">Articolo</th>
                  <th className="px-2 py-2.5 font-semibold">Fornitore / categoria</th>
                  <th className="px-2 py-2.5 text-right font-semibold">Esistenza</th>
                  <th className="px-2 py-2.5 text-right font-semibold">Ord. clienti</th>
                  <th className="px-2 py-2.5 text-right font-semibold">Ord. fornitori</th>
                  <th className="px-2 py-2.5 text-right font-semibold">Scoperto</th>
                  <th className="py-2.5 pl-2 pr-4 text-right font-semibold">Valore scoperto</th>
                </tr>
              </thead>
              <tbody>
                {urgenzeVisibili.map((a) => <RigaUrgenza key={a.codice} articolo={a} />)}
              </tbody>
            </table>
            {!caricamento && dati?.urgenze.length === 0 && (
              <div className="p-10 text-center text-sm text-text-muted">
                <PackageCheck className="mx-auto mb-2 h-6 w-6 text-success" aria-hidden />
                Nessuna criticità con i filtri attivi.
              </div>
            )}
            {caricamento && !dati && <div className="h-64 animate-pulse bg-slate-50" />}
            {!caricamento && (dati?.urgenze.length ?? 0) > 25 && (
              <div className="border-t border-border bg-slate-50 px-4 py-3 text-center">
                <button
                  type="button"
                  onClick={() => setMostraTutte((v) => !v)}
                  className="rounded-lg border border-border bg-bg px-3 py-2 text-xs font-semibold text-primary hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {mostraTutte ? "Mostra solo le prime 25" : `Mostra tutte le ${dati?.urgenze.length} priorità`}
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-bg p-4">
            <div className="mb-4 flex items-center gap-2">
              <CircleDollarSign className="h-4 w-4 text-warning" aria-hidden />
              <h2 className="font-tenorite text-sm font-bold uppercase tracking-wide text-text-muted">Qualità per decidere</h2>
            </div>
            <div className="divide-y divide-border text-sm">
              {[
                ["Costi mancanti", r ? numero(r.costiMancanti) : "—", "Impossibile valorizzare scorta e scoperto"],
                ["Costi da verificare", r ? numero(r.costiObsoleti) : "—", "Data ultimo costo oltre dodici mesi"],
                ["Fornitore mancante", r ? numero(r.fornitoriMancanti) : "—", "Articoli senza attribuzione acquisti"],
              ].map(([nome, valore, nota]) => (
                <div key={String(nome)} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div><div className="font-medium">{nome}</div><div className="mt-0.5 text-[11px] text-text-muted">{nota}</div></div>
                  <strong className="tabular-nums text-warning">{valore}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-bg p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-tenorite text-sm font-bold uppercase tracking-wide text-text-muted">Magazzini</h2>
              <Clock3 className="h-4 w-4 text-text-muted" aria-hidden />
            </div>
            <div className="space-y-3">
              {dati?.magazzini.map((m) => (
                <div key={m.nome}>
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <strong>{m.nome}</strong><span className="tabular-nums text-text-muted">disp. {numero(m.disponibilita)}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-text-muted"><span>esistenza {numero(m.esistenza)}</span><span>in arrivo {numero(m.ordiniFornitori)}</span></div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-bg p-4">
          <div className="mb-4 flex items-center gap-2"><Truck className="h-4 w-4 text-primary" aria-hidden /><h2 className="font-tenorite text-sm font-bold uppercase tracking-wide text-text-muted">Portafoglio per fornitore</h2></div>
          <div className="space-y-3">
            {dati?.fornitori.map((f) => (
              <div key={f.nome}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-xs"><strong className="truncate">{f.nome}</strong><span className="shrink-0 tabular-nums">{euro(f.valoreInArrivo)}</span></div>
                <Barra valore={f.valoreInArrivo + f.valoreScoperto} massimo={massimoFornitore} />
                <div className="mt-1 flex justify-between text-[11px] text-text-muted"><span>{f.articoli} articoli movimentati</span>{f.valoreScoperto > 0 && <span className="text-danger">scoperto {euro(f.valoreScoperto)}</span>}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-bg p-4">
          <div className="mb-4 flex items-center gap-2"><Boxes className="h-4 w-4 text-primary" aria-hidden /><h2 className="font-tenorite text-sm font-bold uppercase tracking-wide text-text-muted">Capitale e rischio per categoria</h2></div>
          <div className="space-y-3">
            {dati?.categorie.map((c) => (
              <div key={c.nome}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-xs"><strong className="truncate">{c.nome}</strong><span className="shrink-0 tabular-nums">{euro(c.valoreGiacenza)}</span></div>
                <Barra valore={c.valoreGiacenza} massimo={massimoCategoria} colore={c.valoreScoperto > 0 ? "bg-warning" : "bg-primary"} />
                <div className="mt-1 flex justify-between text-[11px] text-text-muted"><span>{c.articoliCritici} articoli scoperti</span>{c.valoreScoperto > 0 && <span className="text-danger">{euro(c.valoreScoperto)}</span>}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted">
        <span>Dati aggiornati il <strong>{dataIt(dati?.aggiornatoIl ?? null)}</strong></span>
        <span>I valori economici sono stime all’ultimo costo disponibile, non impegni contabili.</span>
      </footer>
    </main>
  );
}
