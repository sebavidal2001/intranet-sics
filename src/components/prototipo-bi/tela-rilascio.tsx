"use client";

/**
 * LA TELA CHE ACCETTA I CAMPI.
 *
 * Come in Power BI o Tableau: si prende un campo dall'elenco e lo si lascia sul
 * grafico. Mentre si trascina compaiono sopra la tela le zone dove quel campo
 * puo' andare — una misura nei Valori; un tempo sull'Asse; una dimensione
 * sull'Asse, in Legenda o nei Filtri — e quella sotto il cursore si accende.
 *
 * Non decide nulla: lascia la voce al pozzetto scelto e le regole sono quelle
 * dei pozzetti (`deponi`), compresi i rifiuti col loro motivo. Cosi' un campo
 * lasciato sulla tela e uno lasciato nel pozzetto danno lo stesso risultato.
 */

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  TIPO_MIME_CAMPO,
  iscriviTrascinamento,
  leggiTrascinamento,
  leggiVoceDalTrasferimento,
  type NomePozzetto,
  type VoceCampo,
} from "@/components/prototipo-bi/pozzetti-regole";

interface Zona {
  pozzetto: NomePozzetto;
  titolo: string;
  sotto: string;
}

const ZONA = {
  valori: { pozzetto: "valori", titolo: "Valori", sotto: "Cosa misurare" },
  asse: { pozzetto: "asse", titolo: "Asse", sotto: "Le categorie o il tempo" },
  legenda: { pozzetto: "legenda", titolo: "Legenda", sotto: "Suddividi per colore" },
  filtri: { pozzetto: "filtri", titolo: "Filtri", sotto: "Quali righe tenere" },
  campi: { pozzetto: "campi", titolo: "Campi", sotto: "Una colonna per campo" },
} satisfies Record<string, Zona>;

function zonePer(voce: VoceCampo, inTabella: boolean): Zona[] {
  if (voce.tipo === "misura") return [ZONA.valori];
  // In una tabella non c'e' asse ne' legenda: un campo e' una colonna.
  if (inTabella) return voce.tipo === "calendario" ? [ZONA.campi] : [ZONA.campi, ZONA.filtri];
  if (voce.tipo === "calendario") return [ZONA.asse];
  return [ZONA.asse, ZONA.legenda, ZONA.filtri];
}

export function TelaRilascio({
  children,
  onRilascia,
  avviso,
  onChiudiAvviso,
  inTabella = false,
}: {
  /** Nelle tabelle le zone sono Campi, Valori, Filtri. */
  inTabella?: boolean;
  children: ReactNode;
  onRilascia: (pozzetto: NomePozzetto, voce: VoceCampo) => void;
  /** L'esito dell'ultimo gesto, dove si sta guardando: un rifiuto senza motivo sembrerebbe un guasto. */
  avviso: { tipo: "avviso" | "rifiuto"; testo: string } | null;
  onChiudiAvviso: () => void;
}) {
  const inTrascinamento = useSyncExternalStore(iscriviTrascinamento, leggiTrascinamento, () => null);
  const [sopra, setSopra] = useState<NomePozzetto | null>(null);

  return (
    <div className="relative">
      {children}

      {avviso && (
        <div
          role="status"
          className={`absolute left-3 right-3 top-3 z-10 flex items-start gap-2 rounded-lg border p-2 text-xs shadow-sm ${
            avviso.tipo === "rifiuto"
              ? "border-warning/50 bg-bg text-text"
              : "border-primary/40 bg-bg text-text"
          }`}
        >
          <span className="min-w-0 flex-1 leading-relaxed">{avviso.testo}</span>
          <button
            type="button"
            aria-label="Chiudi l'avviso"
            onClick={onChiudiAvviso}
            className="rounded p-0.5 text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {inTrascinamento && (
        <div className="absolute inset-0 z-20 flex gap-3 rounded-xl bg-bg/80 p-3 backdrop-blur-[1px]" aria-hidden>
          {zonePer(inTrascinamento, inTabella).map((zona) => (
            <div
              key={zona.pozzetto}
              onDragEnter={() => setSopra(zona.pozzetto)}
              onDragLeave={() => setSopra((corrente) => (corrente === zona.pozzetto ? null : corrente))}
              onDragOver={(evento) => {
                evento.preventDefault();
                evento.dataTransfer.dropEffect = "move";
              }}
              onDrop={(evento) => {
                evento.preventDefault();
                setSopra(null);
                const voce =
                  leggiVoceDalTrasferimento(evento.dataTransfer.getData(TIPO_MIME_CAMPO)) ?? leggiTrascinamento();
                if (voce) onRilascia(zona.pozzetto, voce);
              }}
              className={`flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors ${
                sopra === zona.pozzetto
                  ? "border-primary bg-primary/20"
                  : "border-primary/50 bg-primary/5"
              }`}
            >
              <span className="font-tenorite text-base font-semibold text-primary">{zona.titolo}</span>
              <span className="mt-1 px-2 text-xs text-text-muted">{zona.sotto}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
