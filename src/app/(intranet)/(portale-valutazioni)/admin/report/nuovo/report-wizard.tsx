"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { creaReport, modificaReport } from "../actions";
import { StepInfo } from "./steps/step-info";
import { StepBlocchi } from "./steps/step-blocchi";
import { StepRiepilogo } from "./steps/step-riepilogo";
import type { InfoState } from "./steps/step-info";
import type { BloccoInput, ReportConfig, ReportBlocco } from "@/lib/types";

interface Props {
  parametri: { id: string; nome: string }[];
  ruoli: { slug: string; nome: string; colore: string }[];
  kpis: { id: string; nome: string }[];
  reportEsistente?: ReportConfig;
  blocchiEsistenti?: ReportBlocco[];
}

const STEPS = ["Informazioni", "Blocchi", "Riepilogo"];

export default function ReportWizard({ parametri, ruoli, kpis, reportEsistente, blocchiEsistenti }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [info, setInfo] = useState<InfoState>({
    nome: reportEsistente?.nome ?? "",
    descrizione: reportEsistente?.descrizione ?? "",
    visibilita_ruoli: reportEsistente?.visibilita_ruoli ?? [],
    is_attivo: reportEsistente?.is_attivo ?? true,
  });

  const [blocchi, setBlocchi] = useState<BloccoInput[]>(
    blocchiEsistenti?.map((b) => ({
      tipo: b.tipo,
      titolo: b.titolo ?? "",
      configurazione: b.configurazione,
      ordine: b.ordine,
    })) ?? []
  );

  const canNext = step === 0 ? info.nome.trim().length > 0 : true;

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const payload = { nome: info.nome, descrizione: info.descrizione, visibilita_ruoli: info.visibilita_ruoli, is_attivo: info.is_attivo, blocchi };
      const result = reportEsistente
        ? await modificaReport(reportEsistente.id, payload)
        : await creaReport(payload);

      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      router.push("/admin/report");
    });
  };

  return (
    <div className="bg-bg rounded-xl border border-border overflow-hidden">
      {/* Step tabs */}
      <div className="flex border-b border-border">
        {STEPS.map((label, i) => (
          <button
            key={i}
            type="button"
            onClick={() => i < step ? setStep(i) : undefined}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              i === step
                ? "text-primary border-b-2 border-primary bg-primary/5"
                : i < step
                  ? "text-text-muted hover:text-text cursor-pointer"
                  : "text-text-muted cursor-default"
            }`}
          >
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs mr-2 ${
              i < step ? "bg-primary text-white" : i === step ? "bg-primary/10 text-primary" : "bg-bg-page text-text-muted"
            }`}>{i + 1}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="p-6">
        {step === 0 && <StepInfo state={info} ruoli={ruoli} onChange={setInfo} />}
        {step === 1 && <StepBlocchi blocchi={blocchi} parametri={parametri} kpis={kpis} onChange={setBlocchi} />}
        {step === 2 && <StepRiepilogo info={info} blocchi={blocchi} ruoli={ruoli} />}

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-page">
        <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Indietro
        </Button>

        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            Avanti <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Salvataggio..." : reportEsistente ? "Salva modifiche" : "Crea report"}
          </Button>
        )}
      </div>
    </div>
  );
}
