"use client";

/**
 *
 * L'analista mattutino. Tre voci, novanta secondi di lettura.
 * Il silenzio è un risultato valido: se non c'è niente di rilevante, lo dice.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Sunrise,
  ThumbsDown,
  ThumbsUp,
  Eye,
  EyeOff,
} from "lucide-react";
import { Scheda, BadgeCertificata, euro } from "./primitivi";
import type { Briefing, FamigliaRilevatore } from "@/lib/prototipo-bi/tipi";

interface SegnaleGrezzo {
  id: string;
  famiglia: FamigliaRilevatore;
  titolo: string;
  descrizione: string;
  punteggio: number;
  magnitudineEuro: number;
  direzione: "positivo" | "negativo" | "neutro";
  selezionato: boolean;
}

const ETICHETTE_FAMIGLIA: Record<FamigliaRilevatore, string> = {
  scostamento_budget: "Scostamento budget",
  rottura_serie: "Rottura di serie",
  clienti_dormienti: "Clienti dormienti",
  concentrazione: "Concentrazione",
  pipeline: "Pipeline preventivi",
  portafoglio: "Portafoglio",
  qualita_dato: "Qualità del dato",
  margine: "Margine",
  clienti_ritornati: "Clienti ritornati",
  consegne: "Consegne",
  costi_acquisto: "Costi d'acquisto",
  fornitori: "Fornitori",
  carico_acquisti: "Carico acquisti",
};

export function BriefingView() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [segnali, setSegnali] = useState<SegnaleGrezzo[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [budgetConfigurato, setBudgetConfigurato] = useState(true);
  const [mostraScartati, setMostraScartati] = useState(false);
  const [riscontri, setRiscontri] = useState<Record<string, boolean>>({});
  const [esportando, setEsportando] = useState(false);

  const carica = useCallback(async (rigenera = false) => {
    setCaricamento(true);
    setErrore(null);
    try {
      const r = await fetch(`/api/bi/briefing?grezzo=1${rigenera ? "&rigenera=1" : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Errore");
      setBriefing(j.briefing);
      setSegnali(j.segnali ?? []);
      setBudgetConfigurato(Boolean(j.configurazioneBudget));
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore");
    } finally {
      setCaricamento(false);
    }
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  async function inviaRiscontro(segnaleId: string, famiglia: string, utile: boolean) {
    setRiscontri((r) => ({ ...r, [segnaleId]: utile }));
    await fetch("/api/bi/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segnaleId, famiglia, utile }),
    });
  }

  async function scaricaReport() {
    setEsportando(true);
    try {
      const r = await fetch("/api/bi/esporta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "report-word",
          approfondimenti: [
            {
              titolo: "Ordinato per business unit (anno corrente)",
              spec: { metrica: "ordinato", raggruppa: ["bu"], ordina: "valore_desc" },
            },
            {
              titolo: "Ordinato per agente (anno corrente)",
              spec: { metrica: "ordinato", raggruppa: ["agente"], ordina: "valore_desc" },
            },
          ],
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Errore");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BI_Report_Direzionale_${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore esportazione");
    } finally {
      setEsportando(false);
    }
  }

  const scartati = segnali.filter((s) => !s.selezionato);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <header className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-primary mb-1">
            <Sunrise className="w-5 h-5" aria-hidden />
            <span className="font-tenorite text-sm uppercase tracking-wide">
              Briefing dell&apos;analista
            </span>
          </div>
          <h1 className="font-tenorite text-2xl font-bold">
            {briefing?.destinatario ? `Buongiorno, ${briefing.destinatario}` : "Briefing"}
          </h1>
          {briefing && (
            <p className="text-sm text-text-muted mt-1">
              Dati al <strong>{briefing.dataRiferimento || "n/d"}</strong>
              {briefing.runRicevutoIl && (
                <> · caricamento del {new Date(briefing.runRicevutoIl).toLocaleString("it-IT")}</>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void carica(true)}
            disabled={caricamento}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border hover:bg-bg-page transition-colors disabled:opacity-50"
          >
            {caricamento ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="w-4 h-4" aria-hidden />
            )}
            Rigenera
          </button>
          <button
            onClick={() => void scaricaReport()}
            disabled={esportando || !briefing}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {esportando ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            ) : (
              <FileText className="w-4 h-4" aria-hidden />
            )}
            Report Word
          </button>
        </div>
      </header>

      {!budgetConfigurato && (
        <div className="mb-5 p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm flex gap-2">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden />
          <span>
            Budget e BEP non ancora configurati per l&apos;anno corrente: i rilevatori di
            scostamento non possono girare.{" "}
            <a href="/bi/configurazione" className="text-primary underline">
              Configurali qui
            </a>
            .
          </span>
        </div>
      )}

      {errore && (
        <div className="mb-5 p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
          {errore}
        </div>
      )}

      {caricamento && !briefing && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-bg-page animate-pulse" />
          ))}
        </div>
      )}

      {briefing && briefing.voci.length === 0 && (
        <Scheda>
          <div className="flex items-start gap-3 py-4">
            <CheckCircle2 className="w-6 h-6 text-success shrink-0" aria-hidden />
            <div>
              <p className="font-tenorite font-semibold">Niente di rilevante oggi.</p>
              <p className="text-sm text-text-muted mt-1">
                Sono stati valutati {briefing.segnaliValutati} segnali, nessuno ha superato le
                soglie. Il silenzio è un risultato valido: un sistema che trova sempre qualcosa
                insegna a ignorarlo.
              </p>
            </div>
          </div>
        </Scheda>
      )}

      <div className="space-y-3">
        {briefing?.voci.map((v, i) => (
          <motion.article
            key={v.segnaleId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.08, ease: "easeOut" }}
            className={`rounded-xl border p-4 ${
              v.famiglia === "qualita_dato"
                ? "border-warning/40 bg-warning/5"
                : "border-border bg-bg"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-tenorite font-bold text-sm shrink-0">
                {v.ordine}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-text-muted font-tenorite">
                    {ETICHETTE_FAMIGLIA[v.famiglia] ?? v.famiglia}
                  </span>
                  <BadgeCertificata certificata={v.certificata} />
                </div>
                <p className="text-[15px] leading-relaxed">{v.testo}</p>

                {v.azioneSuggerita && (
                  <p className="mt-2 text-sm text-primary font-medium">
                    → {v.azioneSuggerita}
                  </p>
                )}

                {v.prove.length > 0 && (
                  <details className="mt-2.5">
                    <summary className="text-xs text-text-muted cursor-pointer hover:text-text">
                      Come è stato calcolato ({v.prove.length}{" "}
                      {v.prove.length === 1 ? "interrogazione" : "interrogazioni"})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {v.prove.map((p, k) => (
                        <div key={k} className="text-xs bg-bg-page rounded p-2">
                          <div className="font-medium mb-1">{p.descrizione}</div>
                          <pre className="text-[10px] text-text-muted overflow-x-auto">
                            {JSON.stringify(p.spec, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-text-muted">Utile?</span>
                  <button
                    onClick={() => void inviaRiscontro(v.segnaleId, v.famiglia, true)}
                    className={`p-1.5 rounded transition-colors ${
                      riscontri[v.segnaleId] === true
                        ? "bg-success/15 text-success"
                        : "text-text-muted hover:bg-bg-page"
                    }`}
                    aria-label="Utile"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" aria-hidden />
                  </button>
                  <button
                    onClick={() => void inviaRiscontro(v.segnaleId, v.famiglia, false)}
                    className={`p-1.5 rounded transition-colors ${
                      riscontri[v.segnaleId] === false
                        ? "bg-danger/15 text-danger"
                        : "text-text-muted hover:bg-bg-page"
                    }`}
                    aria-label="Non utile"
                  >
                    <ThumbsDown className="w-3.5 h-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          </motion.article>
        ))}
      </div>

      {briefing && (
        <footer className="mt-6 text-xs text-text-muted space-y-2">
          <p>
            Segnali valutati: <strong>{briefing.segnaliValutati}</strong> · selezionati:{" "}
            <strong>{briefing.voci.length}</strong> · redazione:{" "}
            <strong>
              {briefing.motoreAI === "openrouter" ? "assistita dall'AI" : "deterministica"}
            </strong>
          </p>
          {briefing.nota && <p className="text-warning">{briefing.nota}</p>}

          {scartati.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => setMostraScartati((v) => !v)}
                className="inline-flex items-center gap-1.5 text-text-muted hover:text-text"
              >
                {mostraScartati ? (
                  <EyeOff className="w-3.5 h-3.5" aria-hidden />
                ) : (
                  <Eye className="w-3.5 h-3.5" aria-hidden />
                )}
                {mostraScartati ? "Nascondi" : "Mostra"} i {scartati.length} segnali non
                selezionati
              </button>
              {mostraScartati && (
                <div className="mt-2 space-y-1.5">
                  {scartati.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-start justify-between gap-3 p-2 rounded bg-bg-page"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-text">{s.titolo}</div>
                        <div className="text-text-muted">
                          {ETICHETTE_FAMIGLIA[s.famiglia] ?? s.famiglia} ·{" "}
                          {euro(s.magnitudineEuro)}
                        </div>
                      </div>
                      <span className="tabular-nums text-text-muted shrink-0">
                        {s.punteggio.toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <p className="pt-1 italic">
                    Questa lista è lo strumento di taratura: mostra cosa il sistema ha visto e
                    ha deciso di non dire.
                  </p>
                </div>
              )}
            </div>
          )}

          <p className="pt-2 border-t border-border">
            <Download className="w-3 h-3 inline mr-1" aria-hidden />
            L&apos;analista scompone gli scostamenti ma non ne ipotizza le cause: dove si
            concentra un numero è aritmetica, perché sia successo lo sa chi legge.
          </p>
        </footer>
      )}
    </div>
  );
}
