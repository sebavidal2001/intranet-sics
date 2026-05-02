"use client";

import { useState, useTransition } from "react";
import { History, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cloneSchedaAnnoPrecedente } from "./actions";

interface Props {
  sessioneId: string;
  sessioneAnno: number;
}

export function SchedaAnnoPrecedenteButton({ sessioneId, sessioneAnno }: Props) {
  const [stato, setStato] = useState<"idle" | "loading" | "preview" | "done" | "error">("idle");
  const [errore, setErrore] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    annoPrec: number;
    righe: { testo: string; punteggio: number | null; note: string | null }[];
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleLoad = async () => {
    setStato("loading");
    setErrore(null);
    try {
      const res = await fetch(`/api/sessione-precedente/${sessioneId}`);
      const data = await res.json();

      if (!res.ok) {
        setErrore(data.error ?? "Errore nel caricamento");
        setStato("error");
        return;
      }

      const righe = (data.risposte ?? []).map((r: {
        punteggio: number;
        note: string | null;
        mansione: { testo: string } | null;
      }) => ({
        testo: r.mansione?.testo ?? "—",
        punteggio: r.punteggio,
        note: r.note,
      }));

      setPreview({ annoPrec: data.sessionePrecedente.anno, righe });
      setStato("preview");
    } catch {
      setErrore("Errore di rete");
      setStato("error");
    }
  };

  const handleClone = () => {
    startTransition(async () => {
      const result = await cloneSchedaAnnoPrecedente(sessioneId);
      if (result.error) {
        setErrore(result.error);
        setStato("error");
      } else {
        setStato("done");
      }
    });
  };

  if (stato === "done") {
    return (
      <div className="flex items-center gap-2 text-success text-sm">
        <CheckCircle2 className="w-4 h-4" />
        Scheda anno precedente caricata — ora puoi modificarla
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {stato === "idle" && (
        <Button
          variant="outline"
          onClick={handleLoad}
          className="gap-2"
        >
          <History className="w-4 h-4" />
          Scheda Anno Precedente
        </Button>
      )}

      {stato === "loading" && (
        <Button variant="outline" disabled className="gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Caricamento…
        </Button>
      )}

      {stato === "error" && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle className="w-4 h-4" />
            {errore}
          </div>
          <button
            onClick={() => { setStato("idle"); setErrore(null); }}
            className="text-xs text-text-muted hover:text-text transition-colors"
          >
            Riprova
          </button>
        </div>
      )}

      {stato === "preview" && preview && (
        <div className="bg-bg border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-bg-page border-b border-border flex items-center justify-between">
            <div>
              <p className="font-tenorite text-sm text-text">
                Scheda anno {preview.annoPrec}
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                {preview.righe.length} valutazioni responsabile — verranno copiate come punto di partenza per {sessioneAnno}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 font-tenorite text-text-muted">Mansione</th>
                  <th className="text-center px-3 py-2 font-tenorite text-text-muted">Punteggio {preview.annoPrec}</th>
                  <th className="text-left px-3 py-2 font-tenorite text-text-muted">Note</th>
                </tr>
              </thead>
              <tbody>
                {preview.righe.map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-text">{r.testo}</td>
                    <td className="px-3 py-2 text-center font-tenorite text-primary">
                      {r.punteggio ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-text-muted">{r.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-border flex items-center gap-3">
            <Button
              size="sm"
              onClick={handleClone}
              disabled={isPending}
              className="bg-primary hover:bg-primary-dark text-white gap-2"
            >
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Carica come base per {sessioneAnno}
            </Button>
            <button
              onClick={() => setStato("idle")}
              className="text-sm text-text-muted hover:text-text transition-colors"
            >
              Annulla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
