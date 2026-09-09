"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  PackageSearch,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  Direzione,
  EsitoStorico,
  RigaStorico,
  ValoriFiltro,
} from "@/lib/portali/vettori/storico";

/**
 * Storico delle spedizioni controllate — quello che nei fogli erano le due
 * tabelle «partenze» e «arrivi».
 *
 * La direzione è una **linguetta**, non una colonna: cambiano la chiave di
 * aggancio, il significato del porto e la controparte, e mescolarle renderebbe
 * ambiguo ogni totale. Il conteggio dell'altra linguetta è sempre visibile, così
 * si sa che c'è dell'altro senza doverci cliccare sopra.
 *
 * I filtri sono applicati **sul server**: i totali in cima devono valere per
 * tutto l'insieme filtrato, non per la pagina che si sta guardando. Filtrare in
 * pagina darebbe somme che cambiano scorrendo.
 */

interface Props {
  iniziali: EsitoStorico;
  valori: ValoriFiltro;
}

const MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

const ESITI = [
  { slug: "in_linea", nome: "In linea", colore: "var(--color-success)" },
  { slug: "da_verificare", nome: "Da verificare", colore: "var(--color-warning)" },
  { slug: "anomalia", nome: "Anomalia", colore: "var(--color-danger)" },
  { slug: "non_valutabile", nome: "Non valutabile", colore: "var(--color-text-muted)" },
] as const;

const ABBINAMENTI = [
  { slug: "numero", nome: "Per numero" },
  { slug: "assistito", nome: "Assistito" },
  { slug: "manuale", nome: "Manuale" },
  { slug: "nessuno", nome: "Senza bolla" },
] as const;

const ORDINI = [
  { slug: "data_desc", nome: "Data, dalla più recente" },
  { slug: "data_asc", nome: "Data, dalla più vecchia" },
  { slug: "importo_desc", nome: "Importo, dal più alto" },
  { slug: "importo_asc", nome: "Importo, dal più basso" },
  { slug: "scostamento_desc", nome: "Scarto dall'atteso" },
  { slug: "peso_desc", nome: "Peso, dal più alto" },
] as const;

const eur = (n: number | null | undefined, d = 2) =>
  n == null
    ? "—"
    : n.toLocaleString("it-IT", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: d,
      });
const num = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : n.toLocaleString("it-IT", { maximumFractionDigits: d });
const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

const coloreEsito = (e: string) =>
  ESITI.find((x) => x.slug === e)?.colore ?? "var(--color-text-muted)";

interface Filtri {
  direzione: Direzione;
  cerca: string;
  vettori: string[];
  esiti: string[];
  abbinamenti: string[];
  province: string[];
  anno: number | null;
  mese: number | null;
  da: string;
  a: string;
  soloAnomalie: boolean;
  pesoMin: string;
  pesoMax: string;
  importoMin: string;
  importoMax: string;
  scostamentoMin: string;
  ordine: string;
  pagina: number;
}

const FILTRI_INIZIALI: Filtri = {
  direzione: "uscita",
  cerca: "",
  vettori: [],
  esiti: [],
  abbinamenti: [],
  province: [],
  anno: null,
  mese: null,
  da: "",
  a: "",
  soloAnomalie: false,
  pesoMin: "",
  pesoMax: "",
  importoMin: "",
  importoMax: "",
  scostamentoMin: "",
  ordine: "data_desc",
  pagina: 1,
};

const numero = (v: string): number | null => {
  const n = Number(v.replace(",", "."));
  return v.trim() === "" || Number.isNaN(n) ? null : n;
};

function corpoRichiesta(f: Filtri, perPagina = 100) {
  return {
    direzione: f.direzione,
    cerca: f.cerca || null,
    vettori: f.vettori,
    esiti: f.esiti,
    abbinamenti: f.abbinamenti,
    province: f.province,
    anno: f.anno,
    mese: f.mese,
    da: f.da || null,
    a: f.a || null,
    soloAnomalie: f.soloAnomalie,
    pesoMin: numero(f.pesoMin),
    pesoMax: numero(f.pesoMax),
    importoMin: numero(f.importoMin),
    importoMax: numero(f.importoMax),
    // Si scrive «20» e si intende il 20%: la frazione è un dettaglio interno.
    scostamentoMin:
      numero(f.scostamentoMin) == null ? null : numero(f.scostamentoMin)! / 100,
    ordine: f.ordine,
    pagina: f.pagina,
    perPagina,
  };
}

export function StoricoView({ iniziali, valori }: Props) {
  const [filtri, setFiltri] = useState<Filtri>(FILTRI_INIZIALI);
  const [dati, setDati] = useState(iniziali);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [avanzati, setAvanzati] = useState(false);
  const [aperta, setAperta] = useState<string | null>(null);
  const [scaricando, setScaricando] = useState(false);
  const primoGiro = useRef(true);

  const aggiorna = useCallback(<K extends keyof Filtri>(chiave: K, valore: Filtri[K]) => {
    // Ogni cambio di filtro riporta a pagina 1: restare a pagina 7 di un
    // insieme che ora ne ha due mostra una tabella vuota senza spiegare perché.
    setFiltri((f) => ({ ...f, [chiave]: valore, pagina: chiave === "pagina" ? (valore as number) : 1 }));
  }, []);

  const commuta = useCallback((chiave: "vettori" | "esiti" | "abbinamenti" | "province", v: string) => {
    setFiltri((f) => {
      const attuale = f[chiave];
      return {
        ...f,
        [chiave]: attuale.includes(v) ? attuale.filter((x) => x !== v) : [...attuale, v],
        pagina: 1,
      };
    });
  }, []);

  // La ricerca libera aspetta mezzo secondo: interrogare a ogni tasto su un
  // archivio di migliaia di righe è lavoro sprecato per il database e sfarfallio
  // per chi guarda.
  useEffect(() => {
    if (primoGiro.current) {
      primoGiro.current = false;
      return;
    }
    const attesa = setTimeout(
      () => {
        let annullato = false;
        setInCorso(true);
        setErrore(null);
        fetch("/api/portali/vettori/spedizioni", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpoRichiesta(filtri)),
        })
          .then(async (res) => {
            const d = await res.json();
            if (annullato) return;
            if (!res.ok) {
              setErrore(d.error ?? "Errore nella lettura dello storico.");
              return;
            }
            setDati(d as EsitoStorico);
          })
          .catch(() => {
            if (!annullato) setErrore("Non è stato possibile contattare il server.");
          })
          .finally(() => {
            if (!annullato) setInCorso(false);
          });
        return () => {
          annullato = true;
        };
      },
      filtri.cerca ? 450 : 0
    );
    return () => clearTimeout(attesa);
  }, [filtri]);

  const scarica = useCallback(async () => {
    setScaricando(true);
    setErrore(null);
    try {
      const res = await fetch("/api/portali/vettori/spedizioni", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...corpoRichiesta(filtri, 500), formato: "csv" }),
      });
      if (!res.ok) {
        setErrore("Non è stato possibile produrre il file.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        (filtri.direzione === "entrata" ? "arrivi" : "partenze") +
        `-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErrore("Non è stato possibile contattare il server.");
    } finally {
      setScaricando(false);
    }
  }, [filtri]);

  const t = dati.totali;
  const differenza = t.fatturato - t.atteso;
  const conteggi = dati.per_direzione ?? {};
  const attivi = useMemo(() => {
    const n =
      filtri.vettori.length +
      filtri.esiti.length +
      filtri.abbinamenti.length +
      filtri.province.length +
      (filtri.cerca ? 1 : 0) +
      (filtri.anno ? 1 : 0) +
      (filtri.mese ? 1 : 0) +
      (filtri.da ? 1 : 0) +
      (filtri.a ? 1 : 0) +
      (filtri.soloAnomalie ? 1 : 0) +
      [filtri.pesoMin, filtri.pesoMax, filtri.importoMin, filtri.importoMax, filtri.scostamentoMin].filter(
        (x) => x !== ""
      ).length;
    return n;
  }, [filtri]);

  const pagine = Math.max(1, Math.ceil(t.righe / dati.per_pagina));

  return (
    <div className="max-w-[1400px] mx-auto">
      <header className="mb-4">
        <h1 className="font-tenorite text-2xl font-bold text-text">Storico spedizioni</h1>
        <p className="text-sm text-text-muted mt-1 max-w-3xl">
          Tutte le spedizioni controllate, come nei fogli: partenze e arrivi
          separati, con quanto è stato fatturato accanto a quanto sarebbe dovuto
          costare. Si filtra e si esporta.
        </p>
      </header>

      {/* ------------------------------ linguette ----------------------------- */}
      <div className="flex items-center gap-1 border-b border-border mb-4">
        {([
          { d: "uscita" as const, nome: "Partenze", nota: "spedizioni ai clienti" },
          { d: "entrata" as const, nome: "Arrivi", nota: "merce dai fornitori" },
        ]).map((x) => {
          const attiva = filtri.direzione === x.d;
          return (
            <button
              key={x.d}
              type="button"
              onClick={() => aggiorna("direzione", x.d)}
              className="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
              style={{
                borderColor: attiva ? "#00a1be" : "transparent",
                color: attiva ? "var(--color-text)" : "var(--color-text-muted)",
              }}
            >
              {x.nome}
              <span className="ml-2 text-xs tabular-nums text-text-muted">
                {conteggi[x.d] ?? 0}
              </span>
            </button>
          );
        })}
        <span className="ml-auto text-[11px] text-text-muted pb-2 hidden sm:block">
          {filtri.direzione === "uscita"
            ? "la fattura cita il nostro numero di bolla"
            : "la fattura cita il numero di bolla del fornitore"}
        </span>
      </div>

      {/* ------------------------------- filtri ------------------------------- */}
      <section className="rounded-xl border border-border bg-bg p-3 mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={filtri.cerca}
              onChange={(e) => aggiorna("cerca", e.target.value)}
              placeholder="Bolla, n. spedizione, cliente, fattura…"
              aria-label="Cerca nello storico"
              className="w-full h-9 rounded-lg border border-border bg-bg pl-9 pr-3 text-sm text-text"
            />
          </label>

          <select
            value={filtri.anno ?? ""}
            onChange={(e) => aggiorna("anno", e.target.value ? Number(e.target.value) : null)}
            aria-label="Anno della fattura"
            className="h-9 rounded-lg border border-border bg-bg px-2 text-sm text-text"
          >
            <option value="">Tutti gli anni</option>
            {valori.anni.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <select
            value={filtri.mese ?? ""}
            onChange={(e) => aggiorna("mese", e.target.value ? Number(e.target.value) : null)}
            aria-label="Mese della fattura"
            className="h-9 rounded-lg border border-border bg-bg px-2 text-sm text-text"
          >
            <option value="">Tutti i mesi</option>
            {MESI.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>

          <select
            value={filtri.ordine}
            onChange={(e) => aggiorna("ordine", e.target.value)}
            aria-label="Ordinamento"
            className="h-9 rounded-lg border border-border bg-bg px-2 text-sm text-text"
          >
            {ORDINI.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.nome}
              </option>
            ))}
          </select>

          <Button
            type="button"
            variant={avanzati ? "secondary" : "outline"}
            size="sm"
            onClick={() => setAvanzati((v) => !v)}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
            Altri filtri
            {attivi > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-white tabular-nums">
                {attivi}
              </span>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void scarica()}
            disabled={scaricando || t.righe === 0}
          >
            {scaricando ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5 mr-1.5" />
            )}
            CSV
          </Button>
        </div>

        {/* chip sempre visibili: vettore ed esito sono i due filtri di ogni giorno */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          {valori.vettori.map((v) => (
            <Chip
              key={v.codice}
              attivo={filtri.vettori.includes(v.codice)}
              onClick={() => commuta("vettori", v.codice)}
            >
              {v.nome}
            </Chip>
          ))}
          <span className="w-px h-5 bg-border mx-1" />
          {ESITI.map((e) => (
            <Chip
              key={e.slug}
              attivo={filtri.esiti.includes(e.slug)}
              colore={e.colore}
              onClick={() => commuta("esiti", e.slug)}
            >
              {e.nome}
            </Chip>
          ))}
          <Chip
            attivo={filtri.soloAnomalie}
            colore="var(--color-danger)"
            onClick={() => aggiorna("soloAnomalie", !filtri.soloAnomalie)}
          >
            Solo con anomalie aperte
          </Chip>
          {attivi > 0 && (
            <button
              type="button"
              onClick={() => setFiltri({ ...FILTRI_INIZIALI, direzione: filtri.direzione })}
              className="text-[11px] text-text-muted hover:text-text inline-flex items-center gap-1 ml-1"
            >
              <X className="w-3 h-3" />
              azzera
            </button>
          )}
        </div>

        {avanzati && (
          <div className="mt-3 pt-3 border-t border-border/60 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etichetta="Spedite dal">
              <input
                type="date"
                value={filtri.da}
                onChange={(e) => aggiorna("da", e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text"
              />
            </Campo>
            <Campo etichetta="Spedite al">
              <input
                type="date"
                value={filtri.a}
                onChange={(e) => aggiorna("a", e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text"
              />
            </Campo>
            <Campo etichetta="Peso tassato (kg), da / a">
              <div className="flex gap-1.5">
                <input
                  inputMode="decimal"
                  value={filtri.pesoMin}
                  onChange={(e) => aggiorna("pesoMin", e.target.value)}
                  placeholder="min"
                  className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text tabular-nums"
                />
                <input
                  inputMode="decimal"
                  value={filtri.pesoMax}
                  onChange={(e) => aggiorna("pesoMax", e.target.value)}
                  placeholder="max"
                  className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text tabular-nums"
                />
              </div>
            </Campo>
            <Campo etichetta="Fatturato (€), da / a">
              <div className="flex gap-1.5">
                <input
                  inputMode="decimal"
                  value={filtri.importoMin}
                  onChange={(e) => aggiorna("importoMin", e.target.value)}
                  placeholder="min"
                  className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text tabular-nums"
                />
                <input
                  inputMode="decimal"
                  value={filtri.importoMax}
                  onChange={(e) => aggiorna("importoMax", e.target.value)}
                  placeholder="max"
                  className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text tabular-nums"
                />
              </div>
            </Campo>
            <Campo etichetta="Scarto dall'atteso almeno (%)">
              <input
                inputMode="decimal"
                value={filtri.scostamentoMin}
                onChange={(e) => aggiorna("scostamentoMin", e.target.value)}
                placeholder="es. 20"
                className="w-full h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text tabular-nums"
              />
              <span className="block text-[10px] text-text-muted mt-1">
                In valore assoluto: prende anche gli addebiti troppo bassi.
              </span>
            </Campo>

            <div className="sm:col-span-2 lg:col-span-3">
              <p className="text-xs text-text-muted mb-1 font-medium">
                Come è stata agganciata alla bolla
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ABBINAMENTI.map((a) => (
                  <Chip
                    key={a.slug}
                    attivo={filtri.abbinamenti.includes(a.slug)}
                    onClick={() => commuta("abbinamenti", a.slug)}
                  >
                    {a.nome}
                  </Chip>
                ))}
              </div>

              {valori.province.length > 0 && (
                <>
                  <p className="text-xs text-text-muted mb-1 mt-3 font-medium">
                    {filtri.direzione === "uscita" ? "Provincia di destinazione" : "Provincia di provenienza"}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {[...valori.province].sort().map((p) => (
                      <Chip
                        key={p}
                        attivo={filtri.province.includes(p)}
                        onClick={() => commuta("province", p)}
                      >
                        {p}
                      </Chip>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------- totali ------------------------------- */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-4">
        <Tessera
          titolo={filtri.direzione === "uscita" ? "Partenze" : "Arrivi"}
          valore={num(t.righe, 0)}
          nota={`${num(t.colli, 0)} colli · ${num(t.kg, 0)} kg`}
        />
        <Tessera titolo="Fatturato" valore={eur(t.fatturato, 0)} nota="dalle fatture acquisite" />
        <Tessera titolo="Atteso" valore={eur(t.atteso, 0)} nota="secondo i listini" />
        <Tessera
          titolo="Differenza"
          valore={eur(differenza, 0)}
          nota={t.atteso > 0 ? `${((differenza / t.atteso) * 100).toFixed(1)}% sul dovuto` : "non calcolabile"}
          colore={differenza > 0 ? "var(--color-danger)" : "var(--color-success)"}
        />
        <Tessera
          titolo="Da decidere"
          valore={num(t.con_anomalie_aperte, 0)}
          nota={`${num(t.anomalie, 0)} righe fuori linea`}
          colore={t.con_anomalie_aperte > 0 ? "var(--color-warning)" : "var(--color-text-muted)"}
        />
      </div>

      {t.righe_bozza > 0 && (
        <div
          className="mb-4 rounded-lg border p-3 flex items-start gap-2.5"
          style={{ borderColor: "var(--color-warning)", background: "rgba(245,158,11,0.06)" }}
        >
          <TriangleAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-text leading-snug">
            {t.righe_bozza} righe vengono da fatture ancora in bozza — quelle che non
            quadrano con i totali stampati. Compaiono nell&apos;elenco marcate, ma{" "}
            <strong>non entrano nei totali qui sopra</strong>: una lettura parziale
            sommata darebbe un numero che nessuno può difendere.
          </p>
        </div>
      )}

      {errore && (
        <div
          className="mb-4 rounded-lg border p-4 flex items-start gap-3"
          style={{ borderColor: "var(--color-danger)", background: "rgba(239,68,68,0.05)" }}
        >
          <TriangleAlert className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <p className="text-sm text-text">{errore}</p>
        </div>
      )}

      {/* ------------------------------- elenco ------------------------------- */}
      <section className="rounded-xl border border-border bg-bg overflow-hidden">
        {inCorso && (
          <div className="px-4 py-1.5 text-[11px] text-text-muted flex items-center gap-2 border-b border-border">
            <Loader2 className="w-3 h-3 animate-spin" />
            aggiorno…
          </div>
        )}

        {dati.righe.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <PackageSearch className="w-8 h-8 text-border mx-auto mb-3" />
            <p className="text-sm text-text font-medium">
              {attivi > 0
                ? "Nessuna spedizione con questi filtri."
                : `Nessuna ${filtri.direzione === "uscita" ? "partenza" : "arrivo"} in archivio.`}
            </p>
            <p className="text-xs text-text-muted mt-1 max-w-md mx-auto">
              {attivi > 0
                ? "Prova ad allargare il periodo o ad azzerare i filtri."
                : "Lo storico si riempie man mano che le fatture vengono acquisite nella pagina Fatture: ogni riga controllata resta qui."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[980px]">
              <thead>
                <tr className="text-text-muted text-[11px] uppercase tracking-wider bg-bg-page">
                  <th className="w-6" />
                  <th className="text-left font-semibold px-3 py-2">Data</th>
                  <th className="text-left font-semibold px-3 py-2">Bolla</th>
                  <th className="text-left font-semibold px-3 py-2">
                    {filtri.direzione === "uscita" ? "Cliente" : "Fornitore"}
                  </th>
                  <th className="text-left font-semibold px-3 py-2">Vettore</th>
                  <th className="text-center font-semibold px-3 py-2">PV</th>
                  <th className="text-right font-semibold px-3 py-2">Colli</th>
                  <th className="text-right font-semibold px-3 py-2">Kg</th>
                  <th className="text-right font-semibold px-3 py-2">Fatturato</th>
                  <th className="text-right font-semibold px-3 py-2">Atteso</th>
                  <th className="text-right font-semibold px-3 py-2">Scarto</th>
                </tr>
              </thead>
              <tbody>
                {dati.righe.map((r) => (
                  <Riga
                    key={r.id}
                    r={r}
                    aperta={aperta === r.id}
                    onApri={() => setAperta((v) => (v === r.id ? null : r.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagine > 1 && (
          <div className="px-4 py-2.5 border-t border-border flex items-center justify-between gap-3">
            <p className="text-xs text-text-muted tabular-nums">
              {(dati.pagina - 1) * dati.per_pagina + 1}–
              {Math.min(dati.pagina * dati.per_pagina, t.righe)} di {num(t.righe, 0)}
            </p>
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={dati.pagina <= 1 || inCorso}
                onClick={() => aggiorna("pagina", filtri.pagina - 1)}
              >
                Precedente
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={dati.pagina >= pagine || inCorso}
                onClick={() => aggiorna("pagina", filtri.pagina + 1)}
              >
                Successiva
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Riga({
  r,
  aperta,
  onApri,
}: {
  r: RigaStorico;
  aperta: boolean;
  onApri: () => void;
}) {
  const differenza = r.fatturato != null && r.atteso != null ? r.fatturato - r.atteso : null;

  return (
    <>
      <tr
        className="border-t border-border/50 hover:bg-bg-page/60 cursor-pointer"
        onClick={onApri}
      >
        <td className="pl-2 text-text-muted">
          {aperta ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </td>
        <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">
          {r.data_spedizione ?? "—"}
          {r.stato_fattura === "bozza" && (
            <span className="ml-1.5 text-[9px] uppercase tracking-wider text-warning">bozza</span>
          )}
        </td>
        <td className="px-3 py-1.5 font-mono text-[12px] whitespace-nowrap">
          {r.riferimento ?? <span className="text-danger">senza bolla</span>}
        </td>
        <td className="px-3 py-1.5 max-w-[220px] truncate" title={r.controparte ?? ""}>
          {r.controparte ?? "—"}
        </td>
        <td className="px-3 py-1.5 whitespace-nowrap text-text-muted">{r.vettore_nome}</td>
        <td className="px-3 py-1.5 text-center text-text-muted">{r.provincia ?? "—"}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{r.colli ?? "—"}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">
          {num(r.peso_tassato ?? r.peso, 0)}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums font-medium">{eur(r.fatturato)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">{eur(r.atteso)}</td>
        <td
          className="px-3 py-1.5 text-right tabular-nums font-medium whitespace-nowrap"
          style={{ color: coloreEsito(r.esito) }}
        >
          {pct(r.scostamento)}
          {r.anomalie_aperte > 0 && (
            <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-danger text-white">
              {r.anomalie_aperte}
            </span>
          )}
        </td>
      </tr>

      {aperta && (
        <tr className="border-t border-border/30 bg-bg-page/40">
          <td />
          <td colSpan={10} className="px-3 py-3">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-[12px]">
              <Blocco titolo="Pesi">
                <Voce nome="Reale" valore={`${num(r.peso, 1)} kg`} />
                <Voce nome="Volumetrico" valore={`${num(r.peso_volumetrico, 1)} kg`} />
                <Voce nome="Tassato in fattura" valore={`${num(r.peso_tassato, 1)} kg`} />
                {r.peso_applicato && <Voce nome="Fa prezzo" valore={r.peso_applicato} />}
              </Blocco>

              <Blocco titolo="Composizione fatturata">
                <Voce nome="Nolo" valore={eur(r.nolo)} />
                <Voce nome="Supplementi" valore={eur(r.supplementi)} />
                <Voce nome="Adeguamento" valore={eur(r.adeguamento)} />
                <Voce nome="Carburante" valore={eur(r.carburante)} />
                <Voce nome="Totale" valore={eur(r.fatturato)} forte />
              </Blocco>

              <Blocco titolo="Controllo">
                <Voce nome="Atteso" valore={eur(r.atteso)} />
                <Voce
                  nome="Differenza"
                  valore={differenza == null ? "—" : eur(differenza)}
                  forte
                />
                <Voce nome="Listino" valore={r.listino ?? "—"} />
                <Voce nome="Zona" valore={r.zona ?? "—"} />
              </Blocco>

              <Blocco titolo="Documento">
                <Voce nome="Fattura" valore={`${r.fattura_numero ?? "—"} · ${r.data_fattura ?? "—"}`} />
                <Voce nome="N. spedizione vettore" valore={r.numero_spedizione ?? "—"} />
                <Voce nome="Porto" valore={r.porto_descrizione ?? "—"} />
                <Voce
                  nome="Aggancio bolla"
                  valore={
                    ABBINAMENTI.find((a) => a.slug === r.abbinamento)?.nome ?? r.abbinamento
                  }
                />
              </Blocco>
            </div>

            {r.avvertenze && r.avvertenze.length > 0 && (
              <ul className="mt-3 space-y-0.5">
                {r.avvertenze.map((a) => (
                  <li key={a} className="text-[11px] text-text-muted">
                    · {a}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Blocco({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
        {titolo}
      </p>
      <dl className="space-y-0.5">{children}</dl>
    </div>
  );
}

function Voce({
  nome,
  valore,
  forte,
}: {
  nome: string;
  valore: string;
  forte?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-text-muted">{nome}</dt>
      <dd className={`tabular-nums text-right ${forte ? "font-semibold text-text" : "text-text"}`}>
        {valore}
      </dd>
    </div>
  );
}

function Chip({
  attivo,
  colore,
  onClick,
  children,
}: {
  attivo: boolean;
  colore?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] px-2 py-0.5 rounded-lg border transition-colors"
      style={{
        borderColor: attivo ? (colore ?? "#00a1be") : "var(--color-border)",
        background: attivo ? `color-mix(in srgb, ${colore ?? "#00a1be"} 12%, transparent)` : "var(--color-bg)",
        color: attivo ? (colore ?? "#007a91") : "var(--color-text-muted)",
      }}
    >
      {children}
    </button>
  );
}

function Campo({
  etichetta,
  children,
}: {
  etichetta: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs">
      <span className="block text-text-muted mb-1 font-medium">{etichetta}</span>
      {children}
    </label>
  );
}

function Tessera({
  titolo,
  valore,
  nota,
  colore,
}: {
  titolo: string;
  valore: string;
  nota: string;
  colore?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
        {titolo}
      </p>
      <p
        className="font-tenorite text-xl font-bold mt-0.5 tabular-nums"
        style={{ color: colore ?? "var(--color-text)" }}
      >
        {valore}
      </p>
      <p className="text-[10px] text-text-muted mt-0.5 leading-snug">{nota}</p>
    </div>
  );
}
