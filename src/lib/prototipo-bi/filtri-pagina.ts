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
 *   - sul PERIODO vince la pagina, perché è la cosa che si cambia di
 *     continuo. Se un riquadro lo ignorasse, il selettore in alto mostrerebbe
 *     un periodo che parte dei grafici non rispetta — e nessuno se ne
 *     accorgerebbe guardando lo schermo.
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
 * Mantiene la domanda originale piu specifica sui filtri dimensionali, ma fa
 * governare il periodo alla pagina: senza questa eccezione il selettore comune
 * mostrerebbe un periodo che alcuni riquadri ignorano silenziosamente.
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
  const haPeriodo = periodoPresente(filtriPagina.periodo);

  if (aggiunti.length === 0 && !haPeriodo) {
    return { spec, filtriPaginaIgnorati };
  }

  return {
    spec: {
      ...spec,
      ...(aggiunti.length > 0 ? { filtri: [...esistenti, ...aggiunti] } : {}),
      ...(haPeriodo ? { periodo: { ...filtriPagina.periodo } } : {}),
    },
    filtriPaginaIgnorati,
  };
}

export function fondiFiltriPagina(spec: SpecQuery, filtriPagina: FiltriPagina): SpecQuery {
  return fondiFiltriPaginaConEsito(spec, filtriPagina).spec;
}
