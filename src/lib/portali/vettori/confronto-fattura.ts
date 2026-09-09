import type { FatturaLetta, RigaFattura } from "./fatture/tipi";

/** Ripartisce le voci di piede GLS conservando esattamente i centesimi stampati. */
export function righeConOneri(fattura: FatturaLetta): RigaFattura[] {
  if (fattura.vettore !== "gls") return fattura.righe;
  const base = fattura.righe.reduce((s, r) => s + (r.nolo ?? 0), 0);
  let cumulato = 0;
  let istatPrecedente = 0;
  let fuelPrecedente = 0;
  return fattura.righe.map((r) => {
    cumulato += r.nolo ?? 0;
    const istat = base > 0 ? Math.round((fattura.totali.adeguamento ?? 0) * 100 * cumulato / base) : 0;
    const fuel = base > 0 ? Math.round((fattura.totali.carburante ?? 0) * 100 * cumulato / base) : 0;
    const quotaIstat = (istat - istatPrecedente) / 100;
    const quotaFuel = (fuel - fuelPrecedente) / 100;
    istatPrecedente = istat;
    fuelPrecedente = fuel;
    return { ...r, carburante: quotaFuel,
      totale: r.totale == null ? null : Math.round((r.totale + quotaIstat + quotaFuel) * 100) / 100,
      dettaglio: { ...r.dettaglio, adeguamentoRipartito: quotaIstat, carburanteRipartito: quotaFuel },
    };
  });
}
