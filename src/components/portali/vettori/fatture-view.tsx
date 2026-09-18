"use client";

import { useCallback, useRef, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Link2,
  Link2Off,
  Loader2,
  TriangleAlert,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MisureSpedizione } from "./misure-spedizione";
import type { MisuraRiga } from "@/lib/portali/vettori/misure";

/**
 * Caricamento e acquisizione delle fatture dei vettori.
 *
 * La pagina mostra **che cosa ha capito** dal PDF prima di scrivere qualsiasi
 * cosa: quante righe ha letto, se quadrano con i totali stampati, a quali bolle
 * si sono agganciate e quanto avrebbero dovuto costare. Solo dopo si acquisisce.
 *
 * Anteprima e acquisizione passano dallo stesso endpoint e dallo stesso codice:
 * quello che si vede qui è esattamente quello che verrà scritto.
 */

interface Controllo {
  atteso_totale: number;
  scostamento: number | null;
  esito: string;
  listino_etichetta: string | null;
  zona_codice: string | null;
  peso_tassabile: number | null;
  peso_reale: number | null;
  peso_volumetrico: number | null;
  peso_applicato: string | null;
  avvertenze: string[];
  atteso_nolo?: number;
  atteso_adeguamento?: number;
  atteso_carburante?: number;
  atteso_dettaglio?: Array<{ codice: string; descrizione: string; importo: number }>;
}

interface Riga {
  dettaglio?: Record<string, unknown>;
  riga_numero: number;
  data: string | null;
  riferimento: string | null;
  controparte: string | null;
  direzione: string | null;
  colli: number | null;
  peso: number | null;
  peso_tassato: number | null;
  nolo: number | null;
  totale: number | null;
  abbinamento: "numero" | "assistito" | "nessuno";
  motivo_abbinamento: string;
  controllo: Controllo | null;
}

interface Confronto {
  voce: string;
  dichiarato: number | null;
  calcolato: number;
  differenza: number | null;
  ok: boolean;
}

interface Riepilogo {
  righe: number;
  agganciate: number;
  daConfermare: number;
  senzaCandidati: number;
  inLinea: number;
  daVerificare: number;
  anomalie: number;
  nonValutabili: number;
  totaleFatturato: number;
  totaleAtteso: number;
  differenza: number;
}

interface Anteprima {
  nomeFile: string;
  origineMetadati: {
    numero: "documento" | "assente";
    data: "documento" | "assente";
  };
  fattura: {
    vettore: string;
    numero: string | null;
    data: string | null;
    avvertenze: string[];
    righeNonLette: string[];
  };
  quadratura: { ok: boolean; confronti: Confronto[]; note: string[] };
  riepilogo: Riepilogo;
  righe: Riga[];
}

const NOMI: Record<string, string> = {
  gls: "GLS",
  tnt: "TNT",
  fedex: "FedEx",
  trading_post: "Trading Post",
};

export function estremiDalNomeFile(nomeFile: string): { numero: string; data: string } | null {
  const parti = /^FAT-BM_([^_]+)_.+_(\d{4})_(\d{2})\.pdf$/i.exec(nomeFile);
  if (!parti) return null;
  const anno = Number(parti[2]);
  const mese = Number(parti[3]);
  if (mese < 1 || mese > 12) return null;
  const ultimoGiorno = new Date(Date.UTC(anno, mese, 0)).toISOString().slice(0, 10);
  return { numero: parti[1], data: ultimoGiorno };
}

const COLORE_ESITO: Record<string, string> = {
  in_linea: "var(--color-success)",
  da_verificare: "var(--color-warning)",
  anomalia: "var(--color-danger)",
  non_valutabile: "var(--color-text-muted)",
};

const eur = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const num = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : n.toLocaleString("it-IT", { maximumFractionDigits: d });
const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toFixed(1)}%`;

export function FattureView() {
  const [file, setFile] = useState<File | null>(null);
  const [anteprima, setAnteprima] = useState<Anteprima | null>(null);
  const [salvata, setSalvata] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState<"lettura" | "salvataggio" | null>(null);
  const [sopra, setSopra] = useState(false);
  const [direzione, setDirezione] = useState("entrata");
  const [misure, setMisure] = useState<MisuraRiga[]>([]);
  const [numeroFattura, setNumeroFattura] = useState("");
  const [dataFattura, setDataFattura] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const invia = useCallback(async (
    f: File,
    soloAnteprima: boolean,
    correzioni: MisuraRiga[] = [],
    ricalcolo = false,
    estremi?: { numero: string; data: string }
  ) => {
    setErrore(null);
    setInCorso(soloAnteprima ? "lettura" : "salvataggio");
    if (soloAnteprima) {
      if (!ricalcolo) { setAnteprima(null); setMisure([]); }
      setSalvata(null);
    }
    try {
      const body = new FormData();
      body.append("file", f);
      body.append("misure", JSON.stringify(correzioni));
      if (estremi?.numero.trim()) body.append("numeroFattura", estremi.numero.trim());
      if (estremi?.data) body.append("dataFattura", estremi.data);
      const res = await fetch(
        `/api/portali/vettori/fatture/acquisisci${soloAnteprima ? "?anteprima=1" : ""}`,
        { method: "POST", body }
      );
      const dati = await res.json();
      if (!res.ok) {
        setErrore(
          res.status === 401
            ? "La sessione è scaduta: ricarica la pagina e rientra, poi ricarica il file."
            : (dati.error ?? "Errore nella lettura della fattura.")
        );
        return;
      }
      if (soloAnteprima) {
        setFile(f);
        setAnteprima(dati as Anteprima);
        if (!ricalcolo) {
          const proposti = estremiDalNomeFile(f.name);
          setNumeroFattura(dati.fattura.numero ?? proposti?.numero ?? "");
          setDataFattura(dati.fattura.data ?? proposti?.data ?? "");
          setDirezione(dati.righe.some((x: Riga) => x.direzione === "entrata") ? "entrata" : dati.righe.some((x: Riga) => x.direzione === "uscita") ? "uscita" : "ignota");
        }
      } else {
        setSalvata(
          `Acquisita: ${dati.esito.righe} spedizioni, ${dati.esito.spedizioni_nuove} nuove bolle collegate, ${dati.esito.anomalie} anomalie da decidere.`
        );
      }
    } catch {
      setErrore("Non è stato possibile contattare il server.");
    } finally {
      setInCorso(null);
    }
  }, []);

  const q = anteprima?.quadratura;
  const estremiAssenti = Boolean(anteprima && (!anteprima.fattura.numero || !anteprima.fattura.data));
  const propostaDalNome = file ? estremiDalNomeFile(file.name) : null;
  const visibili = anteprima?.righe.filter((r) => direzione === "tutte" || (direzione === "ignota" ? !r.direzione : r.direzione === direzione)) ?? [];
  const somma = (fn: (r: Riga) => number) => Math.round(visibili.reduce((s, x) => s + fn(x), 0) * 100) / 100;
  const r = anteprima ? {
    righe: visibili.length, agganciate: visibili.filter((x) => x.abbinamento === "numero").length,
    daConfermare: visibili.filter((x) => x.abbinamento === "assistito").length, senzaCandidati: visibili.filter((x) => x.abbinamento === "nessuno").length,
    anomalie: visibili.filter((x) => x.controllo?.esito === "anomalia").length,
    daVerificare: visibili.filter((x) => x.controllo?.esito === "da_verificare").length,
    inLinea: visibili.filter((x) => x.controllo?.esito === "in_linea").length,
    nonValutabili: visibili.filter((x) => !x.controllo || x.controllo.esito === "non_valutabile").length,
    totaleFatturato: somma((x) => x.totale ?? 0), totaleAtteso: somma((x) => x.controllo?.atteso_totale ?? 0),
    differenza: somma((x) => (x.totale ?? 0) - (x.controllo?.atteso_totale ?? 0)),
  } : null;

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="font-tenorite text-2xl font-bold text-text">Fatture dei vettori</h1>
        <p className="text-sm text-text-muted mt-1 max-w-2xl">
          Trascina qui il PDF ricevuto dal vettore. Il programma legge le righe, le
          confronta con i totali stampati, le aggancia alle bolle e calcola quanto
          sarebbero dovute costare. <strong>Niente viene salvato finché non
          confermi.</strong>
        </p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setSopra(true);
        }}
        onDragLeave={() => setSopra(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSopra(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void invia(f, true);
        }}
        className="rounded-xl border-2 border-dashed p-10 text-center transition-colors"
        style={{
          borderColor: sopra ? "#00a1be" : "var(--color-border)",
          background: sopra ? "rgba(0,161,190,0.05)" : "var(--color-bg)",
        }}
      >
        {inCorso === "lettura" ? (
          <div className="flex flex-col items-center gap-3 text-text-muted">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
            <p className="text-sm">Leggo la fattura e cerco le bolle…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-7 h-7 text-border" />
            <div>
              <p className="text-sm text-text font-medium">
                Trascina qui il PDF della fattura
              </p>
              <p className="text-xs text-text-muted mt-1">
                GLS, TNT e Trading Post si leggono da soli. FedEx no: le sue fatture
                non contengono testo.
              </p>
            </div>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void invia(f, true);
              }}
            />
            <Button type="button" variant="secondary" onClick={() => input.current?.click()}>
              Scegli un file
            </Button>
          </div>
        )}
      </div>

      {errore && (
        <div
          className="mt-4 rounded-lg border p-4 flex items-start gap-3"
          style={{ borderColor: "var(--color-danger)", background: "rgba(239,68,68,0.05)" }}
        >
          <TriangleAlert className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <p className="text-sm text-text">{errore}</p>
        </div>
      )}

      {salvata && (
        <div
          className="mt-4 rounded-lg border p-4 flex items-start gap-3"
          style={{ borderColor: "var(--color-success)", background: "rgba(34,197,94,0.06)" }}
        >
          <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
          <p className="text-sm text-text">{salvata}</p>
        </div>
      )}

      {anteprima && q && r && !salvata && (
        <>
          {/* --------------------------- quadratura --------------------------- */}
          <div
            className="mt-6 rounded-xl border overflow-hidden"
            style={{
              borderColor: q.ok ? "var(--color-success)" : "var(--color-warning)",
              background: "var(--color-bg)",
            }}
          >
            <div
              className="px-5 py-3 flex items-center gap-3"
              style={{ background: q.ok ? "rgba(34,197,94,0.08)" : "rgba(245,158,11,0.08)" }}
            >
              {q.ok ? (
                <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-warning shrink-0" />
              )}
              <div className="min-w-0">
                <p className="font-tenorite font-bold text-text">
                  {q.ok ? "La fattura quadra" : "La fattura non quadra"}
                </p>
                <p className="text-xs text-text-muted">
                  {NOMI[anteprima.fattura.vettore] ?? anteprima.fattura.vettore}
                  {anteprima.fattura.numero ? ` · fattura ${anteprima.fattura.numero}` : ""}
                  {anteprima.fattura.data ? ` · ${anteprima.fattura.data}` : ""} ·{" "}
                  {anteprima.righe.length} spedizioni lette
                </p>
                {anteprima.origineMetadati?.numero === "documento" && anteprima.origineMetadati.data === "documento" && (
                  <p className="mt-1 text-xs text-success">Numero e data letti dal documento.</p>
                )}
              </div>
            </div>

            <details className="px-5 py-4" open={!q.ok}>
              <summary className="cursor-pointer text-sm text-primary mb-3">Dettagli della quadratura</summary>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[460px]">
                  <thead>
                    <tr className="text-text-muted text-[11px] uppercase tracking-wider">
                      <th className="text-left font-semibold pb-1.5">Voce</th>
                      <th className="text-right font-semibold pb-1.5">In fattura</th>
                      <th className="text-right font-semibold pb-1.5">Dalle righe</th>
                      <th className="text-right font-semibold pb-1.5">Differenza</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.confronti.map((c) => (
                      <tr key={c.voce} className="border-t border-border/50">
                        <td className="py-1.5 text-text">
                          {c.voce}
                          {c.dichiarato == null && (
                            <span className="text-text-muted"> — non dichiarata</span>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{num(c.dichiarato)}</td>
                        <td className="py-1.5 text-right tabular-nums">{num(c.calcolato)}</td>
                        <td
                          className="py-1.5 text-right tabular-nums font-medium"
                          style={{
                            color: c.ok ? "var(--color-text-muted)" : "var(--color-danger)",
                          }}
                        >
                          {c.differenza == null ? "—" : num(c.differenza)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {[...q.note, ...anteprima.fattura.avvertenze].map((n) => (
                <p key={n} className="text-[12px] text-text-muted mt-2 leading-snug">
                  {n}
                </p>
              ))}

              {anteprima.fattura.righeNonLette.length > 0 && (
                <div className="mt-3">
                  <p className="text-[12px] font-medium text-danger mb-1">Righe non lette:</p>
                  <ul className="space-y-0.5">
                    {anteprima.fattura.righeNonLette.map((x) => (
                      <li key={x} className="text-[11px] text-text-muted font-mono truncate">
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </details>
          </div>

          {estremiAssenti && (
            <section className="mt-4 rounded-xl border border-warning bg-bg p-5" aria-labelledby="estremi-fattura">
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div className="w-full">
                  <h2 id="estremi-fattura" className="font-tenorite font-bold text-text">
                    Indica gli estremi della fattura
                  </h2>
                  <p className="mt-1 text-sm text-text-muted">
                    Il dettaglio spedizioni non contiene numero e data. Confronta entrambi con la fattura cartacea prima di acquisire.
                  </p>
                  {propostaDalNome && (
                    <p className="mt-2 text-sm font-medium text-warning">
                      I valori proposti vengono dal NOME DEL FILE, non dal documento: vanno verificati sulla fattura cartacea.
                    </p>
                  )}
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium text-text">
                      Numero fattura
                      <input
                        className="mt-1 block w-full rounded-md border border-border bg-bg px-3 py-2 font-normal text-text"
                        value={numeroFattura}
                        maxLength={100}
                        required
                        disabled={Boolean(anteprima.fattura.numero)}
                        onChange={(evento) => setNumeroFattura(evento.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-text">
                      Data fattura
                      <input
                        type="date"
                        className="mt-1 block w-full rounded-md border border-border bg-bg px-3 py-2 font-normal text-text"
                        value={dataFattura}
                        required
                        disabled={Boolean(anteprima.fattura.data)}
                        onChange={(evento) => setDataFattura(evento.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* --------------------------- riepilogo ---------------------------- */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tessera
              titolo="Agganciate alle bolle"
              valore={`${r.agganciate} / ${r.righe}`}
              nota={
                r.daConfermare > 0
                  ? `${r.daConfermare} da confermare a mano`
                  : "nessuna in coda"
              }
              colore="var(--color-primary)"
            />
            <Tessera
              titolo="Senza bolla"
              valore={String(r.senzaCandidati)}
              nota={
                r.senzaCandidati > 0
                  ? "fatturate ma non risultano a gestionale"
                  : "nessuna"
              }
              colore={r.senzaCandidati > 0 ? "var(--color-danger)" : "var(--color-success)"}
            />
            <Tessera
              titolo="Anomalie di importo"
              valore={String(r.anomalie)}
              nota={`${r.daVerificare} da verificare · ${r.inLinea} in linea · ${r.nonValutabili} non valutabili`}
              colore={r.anomalie > 0 ? "var(--color-danger)" : r.nonValutabili > 0 ? "var(--color-warning)" : "var(--color-success)"}
            />
            <Tessera
              titolo="Fatturato contro atteso"
              valore={r.nonValutabili > 0 ? "Confronto incompleto" : eur(r.differenza)}
              nota={`${eur(r.totaleFatturato)} contro ${eur(r.totaleAtteso)}`}
              colore={r.differenza > 0 ? "var(--color-warning)" : "var(--color-text-muted)"}
            />
          </div>

          <div className="flex flex-wrap gap-2 mt-4" role="group" aria-label="Direzione delle spedizioni">
            {[["entrata", "Arrivi da fornitori"], ["uscita", "Invii a clienti"], ["ignota", "Da classificare"], ["tutte", "Tutte"]].map(([v, label]) => <Button key={v} variant={direzione === v ? "default" : "outline"} aria-pressed={direzione === v} onClick={() => setDirezione(v)}>{label} ({anteprima.righe.filter((x) => v === "tutte" || (v === "ignota" ? !x.direzione : x.direzione === v)).length})</Button>)}
          </div>
          <p className="mt-2 text-sm text-text-muted">Totali riferiti alla direzione selezionata. La quadratura e l’acquisizione comprendono l’intera fattura.</p>
          {/* ------------------------------ righe ----------------------------- */}
          {r.nonValutabili > 0 && <p role="status" className="mt-4 text-sm text-warning">
            {r.nonValutabili} righe non sono valutabili: zero anomalie non significa che siano corrette.
            Apri “Completa i dati” sulla spedizione per vedere il motivo e correggerlo.
          </p>}
          <div className="mt-4 rounded-xl border border-border bg-bg overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <h2 className="font-tenorite font-bold text-sm text-text">Spedizioni lette</h2>
            </div>
            <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_8rem_8rem_8rem] gap-4 px-5 py-2 bg-bg-page text-sm text-text-muted" aria-hidden="true">
              <span>Spedizione</span><span className="text-right">Fatturato</span><span className="text-right">Atteso</span><span className="text-right">Differenza</span>
            </div>
            {visibili.length === 0 && <p className="p-5 text-sm text-text-muted">Nessuna spedizione in questa direzione.</p>}
            {visibili.map((riga) => {
              const c = riga.controllo;
              const valutabile = c && c.esito !== "non_valutabile";
              const esito = { in_linea: "In linea", da_verificare: "Da verificare", anomalia: "Anomalia", non_valutabile: "Dati da completare" }[c?.esito ?? "non_valutabile"];
              return <article key={riga.riga_numero} className="border-t border-border/50 px-5 py-4" aria-label={`Spedizione ${riga.riferimento ?? riga.riga_numero}`}>
                <div className="grid grid-cols-3 md:grid-cols-[minmax(0,1fr)_8rem_8rem_8rem] gap-4 items-start">
                  <div className="col-span-3 md:col-span-1 min-w-0">
                    <p className="font-medium text-text break-words">{riga.controparte ?? "Controparte da identificare"}</p>
                    <p className="mt-1 text-sm text-text-muted">{riga.data ?? "Data assente"} · Bolla {riga.riferimento ?? "assente"}</p>
                    <p className="mt-1 text-sm font-medium" style={{ color: COLORE_ESITO[c?.esito ?? "non_valutabile"] }}>{esito}</p>
                  </div>
                  <div className="md:text-right tabular-nums"><span className="block md:hidden text-xs text-text-muted mb-1">Fatturato</span>{eur(riga.totale)}</div>
                  <div className="md:text-right tabular-nums"><span className="block md:hidden text-xs text-text-muted mb-1">Atteso</span>{valutabile ? eur(c.atteso_totale) : "Da completare"}</div>
                  <div className="md:text-right tabular-nums"><span className="block md:hidden text-xs text-text-muted mb-1">Differenza</span><strong>{valutabile && riga.totale != null ? eur(riga.totale - c.atteso_totale) : "—"}</strong><span className="block text-sm text-text-muted">{valutabile ? pct(c.scostamento) : ""}</span></div>
                </div>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-primary w-fit">{valutabile ? "Dettagli e misure" : "Completa i dati"}</summary>
                  <div className="mt-4 grid gap-5 lg:grid-cols-2">
                    <div className="space-y-3">
                      <p className="flex items-start gap-2">{riga.abbinamento === "numero" ? <Link2 className="w-4 h-4 shrink-0 text-success" /> : <Link2Off className="w-4 h-4 shrink-0 text-warning" />}{riga.motivo_abbinamento}</p>
                      <p>Direzione: {riga.direzione === "entrata" ? "Arrivo da fornitore" : riga.direzione === "uscita" ? "Invio a cliente" : "Da classificare"}</p>
                      <dl className="grid grid-cols-2 gap-2 tabular-nums">
                        <dt>Peso reale</dt><dd>{num(c?.peso_reale ?? riga.peso)} kg</dd>
                        <dt>Peso volumetrico</dt><dd>{c?.peso_volumetrico ? `${num(c.peso_volumetrico)} kg` : "Misure mancanti"}</dd>
                        <dt>Peso tassabile</dt><dd>{num(c?.peso_tassabile ?? riga.peso_tassato ?? riga.peso)} kg</dd>
                      </dl>
                      {riga.dettaglio?.formulaVolumetrico ? <p className="text-text-muted">{String(riga.dettaglio.formulaVolumetrico)}</p> : null}
                      {!salvata && <MisureSpedizione numero={riga.riga_numero} direzione={riga.direzione} iniziale={misure.find((m) => m.riga === riga.riga_numero)} condizioniAttuali={JSON.parse(String(riga.dettaglio?.condizioniApplicate ?? "[]")) as string[]} disabled={inCorso !== null} onApplica={(m) => {
                        const nuove = [...misure.filter((x) => x.riga !== m.riga), m]; setMisure(nuove);
                        if (file) void invia(file, true, nuove, true);
                      }} />}
                    </div>
                    <div className="space-y-3">
                      <p className="text-text-muted">{c?.listino_etichetta ?? "Listino non disponibile"}{c?.zona_codice ? ` · zona ${c.zona_codice}` : ""}</p>
                      {valutabile && <dl className="grid grid-cols-2 gap-2 tabular-nums">
                        <dt>Nolo</dt><dd className="text-right">{eur(c.atteso_nolo)}</dd>
                        {c.atteso_dettaglio?.map((v) => <div key={v.codice} className="col-span-2 grid grid-cols-2 gap-2"><dt>{v.descrizione}</dt><dd className="text-right">{eur(v.importo)}</dd></div>)}
                        <dt>Adeguamento</dt><dd className="text-right">{eur(c.atteso_adeguamento)}</dd>
                        <dt>Fuel</dt><dd className="text-right">{eur(c.atteso_carburante)}</dd>
                        <dt className="font-semibold">Totale atteso</dt><dd className="text-right font-semibold">{eur(c.atteso_totale)}</dd>
                      </dl>}
                      <ul className="space-y-2 text-text-muted">{(c?.avvertenze ?? ["Data della spedizione assente: impossibile scegliere il listino."]).map((avviso) => <li key={avviso}>{avviso}</li>)}</ul>
                    </div>
                  </div>
                </details>
              </article>;
            })}

            <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-4 flex-wrap">
              <p className="text-xs text-text-muted max-w-xl">
                {q.ok
                  ? "Acquisendo, la fattura entra in archivio con le righe agganciate alle bolle e i controlli calcolati. Le anomalie restano da decidere."
                  : "Finché non quadra, la fattura non può essere acquisita: le righe che mancano non si vedono guardando quelle lette."}
              </p>
              <Button
                type="button"
                disabled={!q.ok || inCorso !== null || !file || Boolean(errore) || !numeroFattura.trim() || !dataFattura}
                onClick={() => file && void invia(file, false, misure, false, { numero: numeroFattura, data: dataFattura })}
              >
                {inCorso === "salvataggio" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Acquisisco…
                  </>
                ) : (
                  "Acquisisci la fattura"
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
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
  colore: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">
        {titolo}
      </p>
      <p
        className="font-tenorite text-2xl font-bold mt-1 tabular-nums"
        style={{ color: colore }}
      >
        {valore}
      </p>
      <p className="text-[11px] text-text-muted mt-0.5 leading-snug">{nota}</p>
    </div>
  );
}
