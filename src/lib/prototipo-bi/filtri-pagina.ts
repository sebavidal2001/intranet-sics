/**
 * I FILTRI DELLA PAGINA SOPRA LA DOMANDA DEL RIQUADRO.
 *
 * In una dashboard il periodo, la business unit e l'agente si scelgono una
 * volta in alto e valgono per tutti i riquadri: è ciò che la distingue da una
 * raccolta di grafici messi vicini.
 *
 * Ma un riquadro ha già la sua domanda, e le due possono dire cose diverse
 * sulla stessa dimensione. La regola, che è quella che tutti sbagliano a
 * mente:
 *
 *   - sulle DIMENSIONI vince la spec, perché è più specifica: un riquadro
 *     intitolato «Solo COMPONENTI» non deve cambiare significato perché la
 *     pagina è filtrata su IMPIANTI. Il filtro di pagina scartato viene
 *     restituito in `filtriPaginaIgnorati`, così il riquadro può dirlo invece
 *     di mentire in silenzio;
 *   - sul PERIODO la pagina completa una spec che non ne ha uno. Un periodo
 *     esplicito resta invece fermo per consentire confronti storici, e l'esito
 *     segnala che il periodo della pagina non è stato applicato.
 */

import type { Dimensione, Filtro, Periodo, SpecQuery } from "./tipi";

export interface FiltriPagina {
  periodo?: Periodo;
  bu?: string;
  agente?: string;
}

export interface EsitoFusioneFiltriPagina {
  spec: SpecQuery;
  filtriPaginaIgnorati: Dimensione[];
  periodoIgnorato: boolean;
}

function periodoPresente(periodo: Periodo | undefined): periodo is Periodo {
  return Boolean(periodo && (periodo.anno !== undefined || periodo.dal || periodo.al));
}

function filtriDellaPagina(filtri: FiltriPagina): Filtro[] {
  const risultato: Filtro[] = [];
  if (filtri.bu?.trim()) risultato.push({ campo: "bu", op: "eq", valore: filtri.bu.trim() });
  if (filtri.agente?.trim()) {
    risultato.push({ campo: "agente", op: "eq", valore: filtri.agente.trim() });
  }
  return risultato;
}

/**
 * Mantiene la domanda originale più specifica e usa i filtri della pagina
 * soltanto per completarla; l'esito rende visibili gli eventuali conflitti.
 */
export function fondiFiltriPaginaConEsito(
  spec: SpecQuery,
  filtriPagina: FiltriPagina
): EsitoFusioneFiltriPagina {
  const proposti = filtriDellaPagina(filtriPagina);
  const esistenti = spec.filtri ?? [];
  const dimensioniSpec = new Set(esistenti.map((filtro) => filtro.campo));
  const filtriPaginaIgnorati = proposti
    .filter((filtro) => dimensioniSpec.has(filtro.campo))
    .map((filtro) => filtro.campo);
  const aggiunti = proposti.filter((filtro) => !dimensioniSpec.has(filtro.campo));
  const haPeriodoPagina = periodoPresente(filtriPagina.periodo);
  const haPeriodoSpec = periodoPresente(spec.periodo);
  const periodoIgnorato = haPeriodoPagina && haPeriodoSpec;
  const applicaPeriodoPagina = haPeriodoPagina && !haPeriodoSpec;

  if (aggiunti.length === 0 && !applicaPeriodoPagina) {
    return { spec, filtriPaginaIgnorati, periodoIgnorato };
  }

  return {
    spec: {
      ...spec,
      ...(aggiunti.length > 0 ? { filtri: [...esistenti, ...aggiunti] } : {}),
      ...(applicaPeriodoPagina ? { periodo: { ...filtriPagina.periodo } } : {}),
    },
    filtriPaginaIgnorati,
    periodoIgnorato,
  };
}

export function fondiFiltriPagina(spec: SpecQuery, filtriPagina: FiltriPagina): SpecQuery {
  return fondiFiltriPaginaConEsito(spec, filtriPagina).spec;
}
