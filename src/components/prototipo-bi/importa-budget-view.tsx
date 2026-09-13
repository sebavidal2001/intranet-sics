"use client";

/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Import degli Excel Budget/BEP aziendali. Riconosce da solo i tre formati
 * in uso (settimanale per area, giornaliero per area, giornaliero per
 * commerciale) e li unisce senza raddoppiare i totali.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { Scheda, euro } from "./primitivi";

interface SerieImportata {
  anno: number;
  origine: string;
  formato: string;
  importatoIl: string;
  righe: number;
  budget: number;
  bep: number;
  aree: string[];
  agenti: string[];
}

export function ImportaBudgetView({ onImportato }: { onImportato?: () => void }) {
  const [serie, setSerie] = useState<SerieImportata[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [inCorso, setInCorso] = useState(false);
  const [avvisi, setAvvisi] = useState<string[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [trascinamento, setTrascinamento] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const carica = useCallback(async () => {
    setCaricamento(true);
    try {
      const r = await fetch("/api/bi/importa-budget");
      const j = await r.json();
      if (r.ok) setSerie(j.serie ?? []);
    } finally {
      setCaricamento(false);
    }
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  const invia = useCallback(
    async (files: FileList | File[]) => {
      const lista = Array.from(files);
      if (lista.length === 0) return;

      setInCorso(true);
      setErrore(null);
      setAvvisi([]);
      try {
        const form = new FormData();
        for (const f of lista) form.append("file", f);
        const r = await fetch("/api/bi/importa-budget", {
          method: "POST",
          body: form,
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Errore import");
        setAvvisi(j.avvisi ?? []);
        await carica();
        onImportato?.();
      } catch (e) {
        setErrore(e instanceof Error ? e.message : "Errore import");
      } finally {
        setInCorso(false);
        if (input.current) input.current.value = "";
      }
    },
    [carica, onImportato]
  );

  async function elimina(anno: number) {
    if (!window.confirm(`Rimuovere il budget importato per il ${anno}? Tornerà attiva la generazione da configurazione.`)) return;
    await fetch(`/api/bi/importa-budget?anno=${anno}`, { method: "DELETE" });
    await carica();
    onImportato?.();
  }

  return (
    <Scheda
      titolo="Importa da Excel"
      sottotitolo="I file aziendali BUDGET-BEP: si riconoscono da soli, anche tutti insieme"
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setTrascinamento(true);
        }}
        onDragLeave={() => setTrascinamento(false)}
        onDrop={(e) => {
          e.preventDefault();
          setTrascinamento(false);
          void invia(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
          trascinamento
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-bg-page"
        }`}
      >
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && void invia(e.target.files)}
        />
        {inCorso ? (
          <Loader2 className="w-7 h-7 mx-auto text-primary animate-spin" aria-hidden />
        ) : (
          <Upload className="w-7 h-7 mx-auto text-text-muted" aria-hidden />
        )}
        <p className="mt-2 text-sm font-medium">
          {inCorso ? "Lettura in corso…" : "Trascina qui i file, oppure clicca per sceglierli"}
        </p>
        <p className="text-xs text-text-muted mt-1">
          BUDGET-BEP.xlsx · BUDGET-BEP_GIORNALIERO.xlsx ·
          BUDGET-BEP_GIORNALIERO_COMMERCIALI.xlsx
        </p>
      </div>

      {errore && (
        <div className="mt-3 p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
          {errore}
        </div>
      )}

      {avvisi.length > 0 && (
        <div className="mt-3 p-3 rounded-lg bg-bg-page text-xs space-y-1">
          {avvisi.map((a, i) => (
            <div key={i} className="flex gap-2">
              {a.includes("raddoppierebbe") || a.includes("scartate") || a.includes("non contiene") ? (
                <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" aria-hidden />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" aria-hidden />
              )}
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Serie già importate ─────────────────────────────────────────── */}
      <div className="mt-4">
        {caricamento ? (
          <div className="h-16 rounded-lg bg-bg-page animate-pulse" />
        ) : serie.length === 0 ? (
          <p className="text-sm text-text-muted py-2">
            Nessun budget importato. In alternativa, più sotto, si possono inserire gli importi
            annuali e farli distribuire automaticamente.
          </p>
        ) : (
          <div className="space-y-2">
            {serie.map((s) => (
              <div
                key={s.anno}
                className="flex items-start gap-3 p-3 rounded-lg border border-border"
              >
                <FileSpreadsheet className="w-5 h-5 text-success shrink-0 mt-0.5" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <strong className="font-tenorite">{s.anno}</strong>
                    <span className="text-sm">
                      Budget <strong>{euro(s.budget)}</strong>
                      {s.bep > 0 && (
                        <>
                          {" "}
                          · BEP <strong>{euro(s.bep)}</strong>
                        </>
                      )}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success font-medium">
                      importato
                    </span>
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {s.righe.toLocaleString("it-IT")} righe · {s.aree.length} aree
                    {s.agenti.length > 0 && ` · ${s.agenti.length} commerciali`}
                    {" · "}
                    {new Date(s.importatoIl).toLocaleString("it-IT")}
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    {s.aree.join(", ")}
                    {s.agenti.length > 0 && (
                      <span className="block mt-0.5 text-primary">
                        {s.agenti.join(" · ")}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => void elimina(s.anno)}
                  className="p-1.5 rounded text-text-muted hover:text-danger hover:bg-danger/10 shrink-0"
                  aria-label={`Rimuovi ${s.anno}`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-text-muted mt-3">
        Il budget importato ha la precedenza su quello generato. I file per area e quelli per
        commerciale sono due livelli di dettaglio dello stesso budget: vengono uniti, non sommati.
      </p>
    </Scheda>
  );
}
