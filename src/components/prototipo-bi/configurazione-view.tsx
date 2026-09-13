"use client";

/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Budget & BEP: due numeri, le chiusure, l'incidenza delle business unit e le
 * quote dei commerciali. Da qui vengono generate le migliaia di righe
 * giornaliere che oggi sono mantenute a mano in tre Excel.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarOff,
  Check,
  Download,
  Loader2,
  Plus,
  Save,
  Trash2,
  Wand2,
} from "lucide-react";
import { Scheda, euro } from "./primitivi";
import { ImportaBudgetView } from "./importa-budget-view";
import type { ConfigurazioneAnno } from "@/lib/prototipo-bi/tipi";

interface Anteprima {
  giorniLavorativi: number;
  budgetGiornaliero: number;
  bepGiornaliero: number;
  perMese?: { mese: number; budget: number; bep: number; giorni: number }[];
  righeGenerate: number;
}

interface Suggerimenti {
  buDisponibili: string[];
  agentiDisponibili: { codice: string; nome: string }[];
  incidenzeStoriche: { bu: string; pesoPct: number }[];
  quoteStoriche: { agente: string; quotaPct: number }[];
}

const MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

export function ConfigurazioneView({ annoIniziale }: { annoIniziale: number }) {
  const [anno, setAnno] = useState(annoIniziale);
  const [config, setConfig] = useState<ConfigurazioneAnno | null>(null);
  const [anteprima, setAnteprima] = useState<Anteprima | null>(null);
  const [suggerimenti, setSuggerimenti] = useState<Suggerimenti | null>(null);
  const [avvisi, setAvvisi] = useState<string[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [salvataggio, setSalvataggio] = useState(false);
  const [salvato, setSalvato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const carica = useCallback(async (a: number) => {
    setCaricamento(true);
    setErrore(null);
    try {
      const r = await fetch(`/api/bi/configurazione?anno=${a}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Errore");
      setConfig(j.config);
      setAnteprima(j.anteprima);
      setSuggerimenti(j.suggerimenti);
      setAvvisi(j.avvisi ?? []);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore");
    } finally {
      setCaricamento(false);
    }
  }, []);

  useEffect(() => {
    void carica(anno);
  }, [anno, carica]);

  function aggiorna(patch: Partial<ConfigurazioneAnno>) {
    setConfig((c) => (c ? { ...c, ...patch } : c));
    setSalvato(false);
  }

  async function salva() {
    if (!config) return;
    setSalvataggio(true);
    setErrore(null);
    try {
      const r = await fetch("/api/bi/configurazione", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Errore");
      setAnteprima(j.anteprima);
      setAvvisi(j.avvisi ?? []);
      setSalvato(true);
      // Ricarica per avere l'anteprima mensile aggiornata.
      void carica(anno);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore");
    } finally {
      setSalvataggio(false);
    }
  }

  async function esporta() {
    const r = await fetch("/api/bi/esporta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "budget-excel", anno }),
    });
    if (!r.ok) {
      setErrore((await r.json()).error ?? "Errore esportazione");
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PROTOTIPO_Budget_BEP_${anno}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (caricamento && !config) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="h-64 rounded-xl bg-bg-page animate-pulse" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10 text-sm text-danger">
        {errore ?? "Configurazione non disponibile"}
      </div>
    );
  }

  const sommaBU = config.incidenzeBU.reduce((s, i) => s + i.pesoPct, 0);
  const sommaQuote = config.commerciali
    .filter((c) => !c.importoAnnuo)
    .reduce((s, c) => s + c.quotaPct, 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-tenorite text-2xl font-bold">Budget &amp; BEP</h1>
          <p className="text-sm text-text-muted mt-1">
            Due numeri all&apos;anno, le chiusure, le incidenze. Il resto — {" "}
            {anteprima ? anteprima.righeGenerate.toLocaleString("it-IT") : "migliaia di"} righe
            giornaliere — viene generato.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={anno}
            onChange={(e) => setAnno(Number(e.target.value))}
            className="px-3 py-2 text-sm rounded-lg border border-border bg-bg"
          >
            {[annoIniziale + 1, annoIniziale, annoIniziale - 1, annoIniziale - 2].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button
            onClick={() => void esporta()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border hover:bg-bg-page"
          >
            <Download className="w-4 h-4" aria-hidden />
            Excel
          </button>
          <button
            onClick={() => void salva()}
            disabled={salvataggio}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {salvataggio ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            ) : salvato ? (
              <Check className="w-4 h-4" aria-hidden />
            ) : (
              <Save className="w-4 h-4" aria-hidden />
            )}
            {salvato ? "Salvato" : "Salva"}
          </button>
        </div>
      </header>

      {errore && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
          {errore}
        </div>
      )}

      {avvisi.length > 0 && (
        <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm space-y-1">
          {avvisi.map((a, i) => (
            <div key={i} className="flex gap-2">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden />
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}

      <ImportaBudgetView onImportato={() => void carica(anno)} />

      <div className="flex items-center gap-3 pt-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-text-muted uppercase tracking-wide font-tenorite">
          oppure genera dagli importi annuali
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* ── Importi annuali ───────────────────────────────────────────────── */}
      <Scheda titolo="Importi annuali" sottotitolo="I due soli numeri da inserire a mano">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <label className="block">
            <span className="text-xs text-text-muted block mb-1">Budget annuo (€)</span>
            <input
              type="number"
              value={config.budgetAnnuo || ""}
              onChange={(e) => aggiorna({ budgetAnnuo: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg tabular-nums"
              placeholder="es. 7500000"
            />
          </label>
          <label className="block">
            <span className="text-xs text-text-muted block mb-1">BEP annuo (€)</span>
            <input
              type="number"
              value={config.bepAnnuo || ""}
              onChange={(e) => aggiorna({ bepAnnuo: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg tabular-nums"
              placeholder="es. 6200000"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-4 items-center text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={config.modalita === "giorni_lavorativi"}
              onChange={() => aggiorna({ modalita: "giorni_lavorativi" })}
            />
            <span>
              Per giorni lavorativi
              <span className="text-text-muted"> — consigliata</span>
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={config.modalita === "lineare_mese"}
              onChange={() => aggiorna({ modalita: "lineare_mese" })}
            />
            <span>Un dodicesimo al mese</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.escludiWeekend}
              onChange={(e) => aggiorna({ escludiWeekend: e.target.checked })}
            />
            <span>Escludi sabato e domenica</span>
          </label>
        </div>

        {anteprima && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 p-3 rounded-lg bg-bg-page text-sm">
            <div>
              <div className="text-xs text-text-muted">Giorni lavorativi</div>
              <div className="font-tenorite font-bold text-lg">{anteprima.giorniLavorativi}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Budget/giorno</div>
              <div className="font-tenorite font-bold text-lg">
                {euro(anteprima.budgetGiornaliero)}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted">BEP/giorno</div>
              <div className="font-tenorite font-bold text-lg">{euro(anteprima.bepGiornaliero)}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Righe generate</div>
              <div className="font-tenorite font-bold text-lg">
                {anteprima.righeGenerate.toLocaleString("it-IT")}
              </div>
            </div>
          </div>
        )}
      </Scheda>

      {/* ── Chiusure ──────────────────────────────────────────────────────── */}
      <Scheda
        titolo="Chiusure aziendali"
        sottotitolo="I giorni di chiusura non ricevono budget: è così che agosto smette di sembrare un crollo"
        azione={
          <button
            onClick={() =>
              aggiorna({
                chiusure: [
                  ...config.chiusure,
                  {
                    id: `ch-${Date.now()}`,
                    dal: `${anno}-08-10`,
                    al: `${anno}-08-23`,
                    descrizione: "Chiusura estiva",
                  },
                ],
              })
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border hover:bg-bg-page"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden />
            Aggiungi
          </button>
        }
      >
        {config.chiusure.length === 0 ? (
          <p className="text-sm text-text-muted py-3 flex items-center gap-2">
            <CalendarOff className="w-4 h-4" aria-hidden />
            Nessuna chiusura. Le festività nazionali sono già escluse automaticamente.
          </p>
        ) : (
          <div className="space-y-2">
            {config.chiusure.map((c, i) => (
              <div key={c.id} className="flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={c.dal}
                  onChange={(e) => {
                    const ch = [...config.chiusure];
                    ch[i] = { ...c, dal: e.target.value };
                    aggiorna({ chiusure: ch });
                  }}
                  className="px-2 py-1.5 text-sm rounded-lg border border-border bg-bg"
                />
                <span className="text-text-muted text-sm">→</span>
                <input
                  type="date"
                  value={c.al}
                  onChange={(e) => {
                    const ch = [...config.chiusure];
                    ch[i] = { ...c, al: e.target.value };
                    aggiorna({ chiusure: ch });
                  }}
                  className="px-2 py-1.5 text-sm rounded-lg border border-border bg-bg"
                />
                <input
                  value={c.descrizione}
                  onChange={(e) => {
                    const ch = [...config.chiusure];
                    ch[i] = { ...c, descrizione: e.target.value };
                    aggiorna({ chiusure: ch });
                  }}
                  className="flex-1 min-w-[160px] px-2 py-1.5 text-sm rounded-lg border border-border bg-bg"
                  placeholder="Descrizione"
                />
                <button
                  onClick={() =>
                    aggiorna({ chiusure: config.chiusure.filter((x) => x.id !== c.id) })
                  }
                  className="p-1.5 rounded text-text-muted hover:text-danger hover:bg-danger/10"
                  aria-label="Rimuovi"
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
      </Scheda>

      {/* ── Incidenza business unit ───────────────────────────────────────── */}
      <Scheda
        titolo="Incidenza business unit"
        sottotitolo={`Somma attuale: ${sommaBU.toFixed(1)}%`}
        azione={
          suggerimenti && suggerimenti.incidenzeStoriche.length > 0 ? (
            <button
              onClick={() => aggiorna({ incidenzeBU: suggerimenti.incidenzeStoriche })}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border hover:bg-bg-page"
            >
              <Wand2 className="w-3.5 h-3.5" aria-hidden />
              Usa pesi storici
            </button>
          ) : null
        }
      >
        <div className="space-y-2">
          {(config.incidenzeBU.length > 0
            ? config.incidenzeBU
            : (suggerimenti?.buDisponibili ?? []).map((bu) => ({ bu, pesoPct: 0 }))
          ).map((inc, i) => (
            <div key={inc.bu} className="flex items-center gap-3">
              <span className="flex-1 text-sm truncate">{inc.bu}</span>
              <input
                type="number"
                step="0.1"
                value={inc.pesoPct || ""}
                onChange={(e) => {
                  const base =
                    config.incidenzeBU.length > 0
                      ? [...config.incidenzeBU]
                      : (suggerimenti?.buDisponibili ?? []).map((bu) => ({ bu, pesoPct: 0 }));
                  base[i] = { ...base[i], pesoPct: Number(e.target.value) };
                  aggiorna({ incidenzeBU: base });
                }}
                className="w-24 px-2 py-1.5 text-sm rounded-lg border border-border bg-bg text-right tabular-nums"
                placeholder="0"
              />
              <span className="text-sm text-text-muted w-4">%</span>
              <span className="text-xs text-text-muted w-28 text-right tabular-nums">
                {euro((config.budgetAnnuo * (inc.pesoPct || 0)) / 100)}
              </span>
            </div>
          ))}
          {(suggerimenti?.buDisponibili.length ?? 0) === 0 && config.incidenzeBU.length === 0 && (
            <p className="text-sm text-text-muted py-2">
              Nessuna business unit rilevata: aggiorna prima lo snapshot dei dati.
            </p>
          )}
        </div>
      </Scheda>

      {/* ── Dettaglio commerciali ─────────────────────────────────────────── */}
      <Scheda
        titolo="Dettaglio per commerciale"
        sottotitolo={`Quote percentuali: ${sommaQuote.toFixed(1)}% · chi ha un importo esplicito non usa la quota`}
        azione={
          suggerimenti && suggerimenti.quoteStoriche.length > 0 ? (
            <button
              onClick={() =>
                aggiorna({
                  commerciali: suggerimenti.quoteStoriche.map((q) => ({
                    codiceAgente:
                      suggerimenti.agentiDisponibili.find((a) => a.nome === q.agente)?.codice ?? "",
                    agente: q.agente,
                    quotaPct: q.quotaPct,
                    importoAnnuo: null,
                    bu: null,
                  })),
                })
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border hover:bg-bg-page"
            >
              <Wand2 className="w-3.5 h-3.5" aria-hidden />
              Usa quote storiche
            </button>
          ) : null
        }
      >
        {config.commerciali.length === 0 ? (
          <p className="text-sm text-text-muted py-3">
            Nessun commerciale configurato. Usa le quote storiche per partire dalla ripartizione
            reale dell&apos;anno scorso, poi correggi.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_90px_130px] gap-3 text-xs text-text-muted uppercase font-tenorite">
              <span>Commerciale</span>
              <span className="text-right">Quota %</span>
              <span className="text-right">Importo annuo</span>
            </div>
            {config.commerciali.map((c, i) => (
              <div key={`${c.agente}-${i}`} className="grid grid-cols-[1fr_90px_130px] gap-3 items-center">
                <span className="text-sm truncate" title={c.agente}>
                  {c.agente}
                </span>
                <input
                  type="number"
                  step="0.1"
                  value={c.quotaPct || ""}
                  disabled={Boolean(c.importoAnnuo)}
                  onChange={(e) => {
                    const cc = [...config.commerciali];
                    cc[i] = { ...c, quotaPct: Number(e.target.value) };
                    aggiorna({ commerciali: cc });
                  }}
                  className="px-2 py-1.5 text-sm rounded-lg border border-border bg-bg text-right tabular-nums disabled:opacity-40"
                />
                <input
                  type="number"
                  value={c.importoAnnuo ?? ""}
                  onChange={(e) => {
                    const cc = [...config.commerciali];
                    cc[i] = {
                      ...c,
                      importoAnnuo: e.target.value === "" ? null : Number(e.target.value),
                    };
                    aggiorna({ commerciali: cc });
                  }}
                  className="px-2 py-1.5 text-sm rounded-lg border border-border bg-bg text-right tabular-nums"
                  placeholder="opzionale"
                />
              </div>
            ))}
          </div>
        )}
      </Scheda>

      {/* ── Anteprima mensile ─────────────────────────────────────────────── */}
      {anteprima?.perMese && anteprima.perMese.length > 0 && (
        <Scheda
          titolo="Anteprima della distribuzione"
          sottotitolo="Il mese con meno giorni lavorativi riceve meno budget: è il comportamento voluto"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-text-muted border-b border-border">
                  <th className="py-2 font-tenorite">Mese</th>
                  <th className="py-2 text-right font-tenorite">Giorni lav.</th>
                  <th className="py-2 text-right font-tenorite">Budget</th>
                  <th className="py-2 text-right font-tenorite">BEP</th>
                </tr>
              </thead>
              <tbody>
                {anteprima.perMese.map((m) => (
                  <tr key={m.mese} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 capitalize">{MESI[m.mese - 1]}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.giorni}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{euro(m.budget)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{euro(m.bep)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Scheda>
      )}

      <p className="text-xs text-text-muted">
        La configurazione è salvata in <code>prototipo-bi/dati/</code> sul computer locale.
        Nessuna scrittura sul database di produzione.
      </p>
    </div>
  );
}
