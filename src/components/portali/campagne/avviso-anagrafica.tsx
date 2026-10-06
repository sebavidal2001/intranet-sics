import { TriangleAlert } from "lucide-react";
import type { StatoAnagraficaClienti } from "@/lib/portali/campagne/impresa";
import { formattaDataOra } from "./api-client";

/**
 * Barra in cima al portale quando l'elenco clienti non si aggiorna: i clienti nuovi
 * o cambiati in Impresa mancherebbero o avrebbero dati vecchi. Niente email, che
 * dalla VM non partono: la vede chi lavora nel portale. Con lo stato «ok» (o
 * sconosciuto) non compare.
 */
export function AvvisoAnagrafica({ stato }: { stato: StatoAnagraficaClienti | null }) {
  if (!stato || stato.stato === "ok") return null;

  const critico = stato.stato === "critico";
  const titolo = stato.ultimo_aggiornamento
    ? `L'elenco clienti non si aggiorna dal ${formattaDataOra(stato.ultimo_aggiornamento)}`
    : "L'elenco clienti non è ancora stato caricato da Impresa";

  return (
    <div
      role="status"
      className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
        critico ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{titolo}</p>
        <p className="mt-0.5">
          I clienti nuovi o modificati in Impresa potrebbero mancare o avere dati vecchi. Avvisa chi gestisce il sistema.
          {stato.ultimo_errore ? ` Ultimo errore: ${stato.ultimo_errore}` : ""}
        </p>
      </div>
    </div>
  );
}
