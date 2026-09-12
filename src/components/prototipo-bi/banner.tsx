/** ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE */

import { AlertTriangle } from "lucide-react";

/**
 * Fascia rossa presente su OGNI schermata del prototipo.
 * Serve a evitare che uno screenshot venga scambiato per l'applicazione vera:
 * è la terza barriera, dopo l'esclusione da git e la guardia a runtime.
 */
export function BannerPrototipo({ compatto = false }: { compatto?: boolean }) {
  return (
    <div
      className={`w-full bg-danger text-white ${compatto ? "py-1.5 px-3" : "py-2 px-4"}`}
      role="status"
    >
      <div className="max-w-[1600px] mx-auto flex items-center gap-2 justify-center text-center">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
        <span className={`font-tenorite font-semibold tracking-wide ${compatto ? "text-[11px]" : "text-xs"}`}>
          PROTOTIPO — NON IN PRODUZIONE
        </span>
        {!compatto && (
          <span className="text-[11px] opacity-90 hidden sm:inline">
            · In attesa di approvazione · Dati reali in sola lettura, nessuna scrittura sul database
          </span>
        )}
      </div>
    </div>
  );
}
