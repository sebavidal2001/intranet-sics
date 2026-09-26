"use client";

/**
 * Scelta di uno o più anni, a pastiglie.
 *
 * Il campo numerico dell'anno obbligava a sapere che il 2027 andava scritto a
 * mano per vedere consegne e portafoglio futuri, e ne mostrava uno alla volta.
 * Qui gli anni si accendono e si spengono: 2026 e 2027 insieme sono un clic.
 * Almeno uno resta sempre acceso — «nessun anno» non vorrebbe dire «tutti».
 */

export function anniProposti(selezionati: number[] = [], oggi = new Date()): number[] {
  const corrente = oggi.getFullYear();
  const base = Array.from({ length: 7 }, (_, i) => corrente - 4 + i);
  return [...new Set([...base, ...selezionati])].sort((a, b) => a - b);
}

export function SelettoreAnni({
  valore,
  onCambia,
  disabilitato = false,
  anni,
  etichetta = "Anni",
}: {
  valore: number[];
  onCambia: (anni: number[]) => void;
  disabilitato?: boolean;
  /** Anni proposti; per difetto dai quattro anni scorsi ai due prossimi. */
  anni?: number[];
  etichetta?: string;
}) {
  const proposti = anni ?? anniProposti(valore);
  const scelti = new Set(valore);

  function alterna(anno: number) {
    const prossimi = new Set(scelti);
    if (prossimi.has(anno)) {
      if (prossimi.size === 1) return;
      prossimi.delete(anno);
    } else {
      prossimi.add(anno);
    }
    onCambia([...prossimi].sort((a, b) => a - b));
  }

  return (
    <div role="group" aria-label={etichetta} className="flex flex-wrap gap-1">
      {proposti.map((anno) => {
        const acceso = scelti.has(anno);
        return (
          <button
            key={anno}
            type="button"
            aria-pressed={acceso}
            disabled={disabilitato}
            onClick={() => alterna(anno)}
            className={`h-9 min-w-[3.25rem] rounded-lg border px-2 text-sm tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${
              acceso
                ? "border-primary bg-primary/10 font-semibold text-primary"
                : "border-border bg-bg-page text-text-muted hover:text-text"
            }`}
          >
            {anno}
          </button>
        );
      })}
    </div>
  );
}
