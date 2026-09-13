"use client";

/**
 *
 * L'analista conversazionale.
 *
 * Ogni numero che pronuncia viene da un'interrogazione certificata, mostrata
 * sotto la risposta e rieseguibile. Sono visibili anche il modello usato e il
 * costo della domanda: senza, non si può decidere se l'analista conviene.
 */

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Braces,
  ChevronDown,
  Download,
  Database,
  FileSpreadsheet,
  FileText,
  Loader2,
  Save,
  Search,
  Send,
  Sparkles,
  TrendingUp,
  User,
} from "lucide-react";
import { BadgeCertificata, euro } from "./primitivi";
import { Markdown } from "./markdown";
import { GraficoDaAnalisi } from "./grafico-da-risultato";
import { graficiPossibili, type TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type {
  RisultatoQuery,
  SerieAnalisi,
  SerieAnalisiEseguita,
  SpecQuery,
} from "@/lib/prototipo-bi/tipi";

interface Passo {
  tipo: "interrogazione" | "sql" | "previsione" | "documento" | "risposta" | "errore";
  descrizione: string;
  spec?: SpecQuery;
  sql?: string;
  colonne?: string[];
  righe?: number;
  totale?: number;
}

interface MetodoPrevisione {
  nome: string;
  stima: number;
  spiegazione: string;
  nonApplicabile?: string;
}

interface Previsione {
  anno: number;
  consuntivoAlGiorno: number;
  giornoLimite: string;
  metodi: MetodoPrevisione[];
  stimaCentrale: number;
  minimo: number;
  massimo: number;
  incertezzaPct: number;
  avvisi: string[];
}

interface DocumentoProposto {
  formato: "excel" | "word";
  titolo: string;
  commento?: string;
  blocchi: Array<{ titolo: string; spec?: SpecQuery; sql?: string }>;
}

interface AnalisiProposta {
  titolo: string;
  spec: SpecQuery;
  serie?: SerieAnalisi[];
  grafico: TipoGrafico;
  motivoGrafico: string;
  commento?: string;
  risultato: RisultatoQuery;
  risultatiSerie?: SerieAnalisiEseguita[];
}

interface NumeroCitato {
  testo: string;
  valore: number;
  posizione: number;
  verificato: boolean;
  fonte?: string;
}

interface EsitoVerifica {
  numeri: NumeroCitato[];
  nonVerificati: number;
}

interface Messaggio {
  ruolo: "utente" | "analista";
  testo: string;
  interpretazione?: string | null;
  verifica?: EsitoVerifica | null;
  correzioneApplicata?: boolean;
  passi?: Passo[];
  previsioni?: Previsione[];
  documenti?: DocumentoProposto[];
  analisi?: AnalisiProposta[];
  modello?: string;
  complessita?: string;
  motivoModello?: string;
  consumo?: { tokenIngresso: number; tokenUscita: number; costoUsd: number } | null;
  errore?: boolean;
}

const ESEMPI = [
  { tipo: "KPI certificato", testo: "Come sta andando l'ordinato quest'anno rispetto allo stesso periodo dell'anno scorso?" },
  { tipo: "Previsione", testo: "A che importo pensi che chiuderemo il fatturato 2026?" },
  { tipo: "Scomposizione", testo: "Quali clienti sono calati di più e di quanto?" },
  { tipo: "Report Excel", testo: "Preparami un report Excel con ordinato e preventivi per business unit" },
  { tipo: "SQL avanzato", testo: "Con CTE e ranking SQL, mostrami i 20 articoli scoperti più costosi per fornitore" },
  { tipo: "Report Word", testo: "Crea un report Word sulla copertura costi e sulla marginalità per mese" },
];

const LIVELLI = [
  { chiave: "semplice", nome: "Veloce", nota: "lettura diretta, modello economico" },
  { chiave: "analitica", nome: "Analisi", nota: "confronti e scomposizioni" },
  { chiave: "profonda", nome: "Approfondita", nota: "previsioni, scenari, documenti" },
] as const;

const NOMI_GRAFICI: Record<TipoGrafico, string> = {
  linee: "Linee",
  barre: "Barre",
  combo: "Combinato",
  torta: "Torta",
  anelli: "Anelli",
  areeImpilate: "Aree impilate",
  pareto: "Pareto",
  bullet: "Bullet",
  heatmap: "Mappa di calore",
  quadranti: "Quadranti",
  imbuto: "Imbuto",
  treemap: "Mappa ad albero",
  sparkline: "Sparkline",
  kpi: "KPI",
  tabella: "Tabella",
};

function BloccoPrevisione({ p }: { p: Previsione }) {
  const validi = p.metodi.filter((m) => !m.nonApplicabile);
  return (
    <div className="mt-3 rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 bg-bg-page flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-primary" aria-hidden />
        <span className="text-xs font-tenorite uppercase tracking-wide text-text-muted">
          Previsione {p.anno} · calcolata dal motore, non stimata dal modello
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-baseline gap-3 flex-wrap mb-3">
          <span className="font-tenorite font-bold text-xl">{euro(p.stimaCentrale)}</span>
          <span className="text-sm text-text-muted">
            intervallo {euro(p.minimo)} – {euro(p.massimo)}
          </span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              p.incertezzaPct > 15
                ? "bg-warning/15 text-warning"
                : "bg-success/15 text-success"
            }`}
          >
            ±{p.incertezzaPct.toFixed(0)}%
          </span>
        </div>

        <div className="space-y-2">
          {validi.map((m) => (
            <div key={m.nome} className="text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{m.nome}</span>
                <span className="tabular-nums">{euro(m.stima)}</span>
              </div>
              <p className="text-text-muted leading-snug mt-0.5">{m.spiegazione}</p>
            </div>
          ))}
        </div>

        {p.avvisi.length > 0 && (
          <div className="mt-3 pt-2 border-t border-border space-y-1">
            {p.avvisi.map((a, i) => (
              <p key={i} className="text-[11px] text-warning leading-snug">
                {a}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BottoneDocumento({ doc }: { doc: DocumentoProposto }) {
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function scarica() {
    setInCorso(true);
    setErrore(null);
    try {
      const r = await fetch("/api/bi/esporta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          doc.formato === "excel"
            ? { tipo: "query-excel", blocchi: doc.blocchi }
            : {
                tipo: "report-word",
                approfondimenti: doc.blocchi,
                commento: doc.commento,
              }
        ),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Errore");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const est = doc.formato === "excel" ? "xlsx" : "docx";
      a.download = `BI_${doc.titolo.replace(/[^\w\s-]/g, "").slice(0, 50)}.${est}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore");
    } finally {
      setInCorso(false);
    }
  }

  const Icona = doc.formato === "excel" ? FileSpreadsheet : FileText;
  return (
    <div className="mt-3">
      <button
        onClick={() => void scarica()}
        disabled={inCorso}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
      >
        {inCorso ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        ) : (
          <Icona className="w-4 h-4" aria-hidden />
        )}
        <span className="font-medium">{doc.titolo}</span>
        <Download className="w-3.5 h-3.5 opacity-60" aria-hidden />
      </button>
      <p className="text-[11px] text-text-muted mt-1">
        {doc.blocchi.length} {doc.blocchi.length === 1 ? "tabella" : "tabelle"} ·{" "}
        {doc.formato === "excel" ? "Excel" : "Word"} · i dati vengono ricalcolati al momento
        del download
      </p>
      {errore && <p className="text-[11px] text-danger mt-1">{errore}</p>}
    </div>
  );
}

function BloccoAnalisi({ analisi }: { analisi: AnalisiProposta }) {
  const [tipoScelto, setTipoScelto] = useState<TipoGrafico>(analisi.grafico);
  const [salvataggio, setSalvataggio] = useState<"pronto" | "in_corso" | "salvata" | "errore">(
    "pronto"
  );
  const [messaggio, setMessaggio] = useState("");

  async function salva() {
    if (salvataggio === "in_corso") return;
    setSalvataggio("in_corso");
    setMessaggio("");
    try {
      const risposta = await fetch("/api/bi/analisi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titolo: analisi.titolo,
          descrizione: analisi.commento,
          spec: analisi.spec,
          serie: analisi.serie ?? null,
          grafico: tipoScelto,
        }),
      });
      const corpo: unknown = await risposta.json();
      if (!risposta.ok) {
        const errore =
          corpo && typeof corpo === "object" && "error" in corpo
            ? String(corpo.error)
            : "Salvataggio non riuscito.";
        throw new Error(errore);
      }
      setSalvataggio("salvata");
      setMessaggio("Analisi salvata.");
    } catch (errore) {
      setSalvataggio("errore");
      setMessaggio(errore instanceof Error ? errore.message : "Salvataggio non riuscito.");
    }
  }

  return (
    <section className="mt-4 min-w-0 overflow-hidden rounded-xl border border-border bg-bg-page">
      <header className="px-4 pt-4">
        <h2 className="font-tenorite text-base font-semibold leading-snug break-words">
          {analisi.titolo}
        </h2>
        {analisi.commento && (
          <p className="mt-1 text-sm leading-relaxed text-text-muted break-words">
            {analisi.commento}
          </p>
        )}
      </header>

      <div className="min-w-0 px-2 py-3 sm:px-4">
        <GraficoDaAnalisi
          serie={analisi.risultatiSerie ?? [{ ruolo: "principale", nome: analisi.spec.metrica, spec: analisi.spec, risultato: analisi.risultato }]}
          tipo={tipoScelto}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="min-w-0 text-xs text-text-muted">
          Tipo di grafico
          <select
            value={tipoScelto}
            onChange={(evento) => {
              setTipoScelto(evento.target.value as TipoGrafico);
              if (salvataggio === "salvata") {
                setSalvataggio("pronto");
                setMessaggio("");
              }
            }}
            title={analisi.motivoGrafico}
            className="mt-1 block min-h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary sm:w-auto"
          >
            {graficiPossibili(analisi.risultatiSerie ?? analisi.risultato).map((tipo) => (
              <option key={tipo} value={tipo}>
                {NOMI_GRAFICI[tipo]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void salva()}
            disabled={salvataggio === "in_corso" || salvataggio === "salvata"}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-bg px-3 text-sm font-medium text-text transition-colors hover:bg-bg-page focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {salvataggio === "in_corso" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            {salvataggio === "in_corso" ? "Salvataggio…" : "Salva"}
          </button>
          <p
            aria-live="polite"
            className={`text-xs ${salvataggio === "errore" ? "text-warning" : "text-text-muted"}`}
          >
            {messaggio}
          </p>
        </div>
      </div>
      <p className="px-4 pb-3 text-[11px] leading-relaxed text-text-muted">
        {analisi.motivoGrafico}
      </p>
    </section>
  );
}

export function AnalistaView({
  dataMinima,
  dataMassima,
}: {
  dataMinima: string | null;
  dataMassima: string | null;
}) {
  const [messaggi, setMessaggi] = useState<Messaggio[]>([]);
  const [bozza, setBozza] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [livello, setLivello] = useState<string>("");
  const fine = useRef<HTMLDivElement>(null);

  async function invia(domanda: string) {
    const testo = domanda.trim();
    if (!testo || inCorso) return;

    const storico = messaggi.map((m) => ({ ruolo: m.ruolo, testo: m.testo }));
    setMessaggi((m) => [...m, { ruolo: "utente", testo }]);
    setBozza("");
    setInCorso(true);

    try {
      const r = await fetch("/api/bi/analista", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domanda: testo,
          storico,
          complessita: livello || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Errore");
      setMessaggi((m) => [
        ...m,
        {
          ruolo: "analista",
          testo: j.testo,
          interpretazione: j.interpretazione,
          verifica: j.verifica,
          correzioneApplicata: j.correzioneApplicata,
          passi: j.passi,
          previsioni: j.previsioni,
          documenti: j.documenti,
          analisi: j.analisi,
          modello: j.modello,
          complessita: j.complessita,
          motivoModello: j.motivoModello,
          consumo: j.consumo,
        },
      ]);
    } catch (e) {
      setMessaggi((m) => [
        ...m,
        { ruolo: "analista", testo: e instanceof Error ? e.message : "Errore", errore: true },
      ]);
    } finally {
      setInCorso(false);
      setTimeout(() => fine.current?.scrollIntoView({ behavior: "smooth" }), 60);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-160px)] w-full min-w-0 max-w-3xl flex-col px-4 py-6 sm:py-8">
      <header className="mb-5">
        <div className="flex items-center gap-2 text-primary mb-1">
          <Sparkles className="w-5 h-5" aria-hidden />
          <span className="font-tenorite text-sm uppercase tracking-wide">Analista</span>
        </div>
        <h1 className="font-tenorite text-2xl font-bold">Chiedi ai dati</h1>
        <p className="text-sm text-text-muted mt-1">
          Usa metriche certificate per i KPI e SQL di sola lettura per analisi complesse, join e
          funzioni finestra. Le previsioni sono calcolate dal motore, non stimate a occhio. Dati
          dal <strong>{dataMinima ?? "n/d"}</strong> al <strong>{dataMassima ?? "n/d"}</strong>.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1.5"><Database className="h-3.5 w-3.5 text-primary" aria-hidden /> Metriche certificate</span>
          <span className="inline-flex items-center gap-1.5"><Braces className="h-3.5 w-3.5 text-warning" aria-hidden /> SQL complesso, sola lettura</span>
          <span className="inline-flex items-center gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5 text-success" aria-hidden /> Report Word ed Excel</span>
        </div>
      </header>

      {messaggi.length === 0 && (
        <div className="mb-6 space-y-2">
          <p className="text-xs uppercase tracking-wide text-text-muted font-tenorite">
            Prova a chiedere
          </p>
          {ESEMPI.map((e) => (
            <button
              key={e.testo}
              onClick={() => void invia(e.testo)}
              className="flex w-full items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="min-w-0 flex-1">{e.testo}</span>
              <span className="mt-0.5 shrink-0 rounded-full bg-bg-page px-2 py-0.5 text-[10px] font-semibold text-text-muted">{e.tipo}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-4">
        {messaggi.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={`flex gap-3 ${m.ruolo === "utente" ? "justify-end" : ""}`}
          >
            {m.ruolo === "analista" && (
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" aria-hidden />
              </div>
            )}
            <div className={`max-w-[88%] min-w-0 ${m.ruolo === "utente" ? "order-first" : ""}`}>
              {m.ruolo === "utente" ? (
                <div className="rounded-xl px-4 py-3 text-[15px] leading-relaxed bg-primary text-white whitespace-pre-wrap">
                  {m.testo}
                </div>
              ) : (
                <div
                  className={`rounded-xl px-4 py-3 ${
                    m.errore
                      ? "bg-danger/10 border border-danger/30 text-danger"
                      : "bg-bg border border-border"
                  }`}
                >
                  {m.errore ? (
                    <p>{m.testo}</p>
                  ) : (
                    <>
                      {m.interpretazione && (
                        <div className="mb-3 rounded-lg bg-bg-page px-3 py-2 text-xs leading-relaxed text-text-muted break-words">
                          <span className="font-medium">Ho letto la domanda così:</span>{" "}
                          {m.interpretazione}
                        </div>
                      )}
                      <Markdown testo={m.testo} />
                      {m.analisi?.map((analisi, indice) => (
                        <BloccoAnalisi key={`${analisi.titolo}-${indice}`} analisi={analisi} />
                      ))}
                      {m.verifica && m.verifica.nonVerificati > 0 && (
                        <div
                          role="alert"
                          className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning break-words"
                        >
                          {m.verifica.nonVerificati === 1
                            ? "1 cifra non risulta"
                            : `${m.verifica.nonVerificati} cifre non risultano`}{" "}
                          dai dati interrogati:{" "}
                          <span className="font-tenorite font-semibold">
                            {m.verifica.numeri
                              .filter((numero) => !numero.verificato)
                              .map((numero) => numero.testo)
                              .join(", ")}
                          </span>{" "}
                          — verificale prima di usarle.
                        </div>
                      )}
                    </>
                  )}

                  {m.previsioni?.map((p, k) => (
                    <BloccoPrevisione key={k} p={p} />
                  ))}
                  {m.documenti?.map((d, k) => (
                    <BottoneDocumento key={k} doc={d} />
                  ))}
                </div>
              )}

              {m.ruolo === "analista" && !m.errore && (
                <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px] text-text-muted">
                  {m.modello && (
                    <span title={m.motivoModello}>
                      {m.modello}
                      {m.complessita && ` · ${m.complessita}`}
                    </span>
                  )}
                  {m.consumo && (
                    <span title={`${m.consumo.tokenIngresso} token in, ${m.consumo.tokenUscita} out`}>
                      {m.consumo.costoUsd < 0.01
                        ? `${(m.consumo.costoUsd * 100).toFixed(2)} ¢`
                        : `$${m.consumo.costoUsd.toFixed(3)}`}
                    </span>
                  )}
                  {m.passi && m.passi.some((p) => p.tipo === "interrogazione" || (p.tipo === "sql" && p.sql)) && (
                    <details className="inline">
                      <summary className="cursor-pointer hover:text-text inline-flex items-center gap-1">
                        <Search className="w-3 h-3" aria-hidden />
                        {m.passi.filter((p) => p.tipo === "interrogazione" || (p.tipo === "sql" && p.sql)).length} interrogazioni
                        <ChevronDown className="w-3 h-3" aria-hidden />
                      </summary>
                      <div className="mt-2 space-y-2">
                        {m.passi
                          .filter((p) => p.tipo !== "risposta")
                          .map((p, k) => (
                            <div
                              key={k}
                              className={`rounded p-2 ${
                                p.tipo === "errore" ? "bg-danger/5 text-danger" : "bg-bg-page"
                              }`}
                            >
                              <div className="font-medium mb-1">
                                {p.tipo === "sql" && <Braces className="mr-1 inline h-3 w-3 text-warning" aria-hidden />}
                                {p.descrizione}
                                {p.totale !== undefined && (
                                  <span className="ml-2 text-text-muted">
                                    → {euro(p.totale)} · {p.righe} righe
                                  </span>
                                )}
                              </div>
                              {p.spec && (
                                <div>
                                  <BadgeCertificata />
                                  <pre className="mt-1 text-[10px] text-text-muted overflow-x-auto">{JSON.stringify(p.spec, null, 2)}</pre>
                                </div>
                              )}
                              {p.sql && (
                                <div>
                                  <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-warning">SQL sola lettura</span>
                                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-text-muted">{p.sql}</pre>
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
            {m.ruolo === "utente" && (
              <div className="w-8 h-8 rounded-full bg-bg-page flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-text-muted" aria-hidden />
              </div>
            )}
          </motion.div>
        ))}

        {inCorso && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            </div>
            <div className="rounded-xl px-4 py-3 bg-bg border border-border text-sm text-text-muted">
              Interrogo i dati…
            </div>
          </div>
        )}
        <div ref={fine} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void invia(bozza);
        }}
        className="sticky bottom-0 min-w-0 bg-bg-page pb-2 pt-4"
      >
        <div className="mb-2 flex flex-col gap-2 text-xs sm:flex-row sm:items-center">
          <span className="text-text-muted">Approfondimento</span>
          <div className="grid w-full grid-cols-2 gap-0.5 rounded-md border border-border bg-bg-page p-0.5 sm:flex sm:w-auto">
            <button
              type="button"
              onClick={() => setLivello("")}
              className={`px-2 py-1 rounded transition-colors ${
                livello === "" ? "bg-bg shadow-sm text-primary font-medium" : "text-text-muted"
              }`}
              title="Il livello viene dedotto dalla domanda"
            >
              Automatico
            </button>
            {LIVELLI.map((l) => (
              <button
                key={l.chiave}
                type="button"
                onClick={() => setLivello(l.chiave)}
                title={l.nota}
                className={`px-2 py-1 rounded transition-colors ${
                  livello === l.chiave
                    ? "bg-bg shadow-sm text-primary font-medium"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {l.nome}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 gap-2">
          <input
            value={bozza}
            onChange={(e) => setBozza(e.target.value)}
            placeholder="Fai una domanda sui dati commerciali…"
            disabled={inCorso}
            className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-4 py-3 text-sm disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={inCorso || !bozza.trim()}
            className="px-4 py-3 rounded-xl bg-primary text-white hover:bg-primary-dark disabled:opacity-40"
            aria-label="Invia"
          >
            <Send className="w-4 h-4" aria-hidden />
          </button>
        </div>
        <p className="text-[11px] text-text-muted mt-2">
          Le metriche certificate e le query SQL esplorative sono sempre distinte. SQL accetta
          solo SELECT/WITH sulle viste BI autorizzate: l’Analista non scrive SQL con effetti sul
          database e nessun comando può modificarlo.
        </p>
      </form>
    </div>
  );
}
