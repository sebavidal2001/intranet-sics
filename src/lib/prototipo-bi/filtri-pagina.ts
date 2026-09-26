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
import { dimensioneFuoriDominio } from "./semantico";
import { periodoPresente } from "./periodo";

export interface FiltriPagina {
  periodo?: Periodo;
  /** Una o piu' business unit intere. */
  bu?: string | string[];
  /** Uno o piu' agenti. */
  agente?: string | string[];
  /**
   * Scelta a matrioska dentro le business unit («COMPONENTI › AUTOMAZIONE
   * pneumatica»): quando c'e', prevale su `bu`. Vedi filtro-albero.ts.
   */
  rami?: string[];
}

/** Valori non vuoti, da stringa singola o elenco. */
function elenco(v: string | string[] | undefined): string[] {
  return (Array.isArray(v) ? v : v ? [v] : []).map((x) => x.trim()).filter(Boolean);
}

function filtroSu(campo: Dimensione, valori: string[]): Filtro {
  return valori.length === 1 ? { campo, op: "eq", valore: valori[0] } : { campo, op: "in", valore: valori };
}

/**
 * Business unit, categoria e la loro coppia sono la stessa famiglia: un
 * riquadro «Solo COMPONENTI» non deve ricevere anche il ramo scelto in pagina.
 */
function famiglia(campo: Dimensione): string {
  return campo === "categoria" || campo === "bu_categoria" ? "bu" : campo;
}

export interface EsitoFusioneFiltriPagina {
  spec: SpecQuery;
  filtriPaginaIgnorati: Dimensione[];
  periodoIgnorato: boolean;
}

function filtriDellaPagina(filtri: FiltriPagina): Filtro[] {
  const risultato: Filtro[] = [];
  const rami = elenco(filtri.rami);
  const bu = elenco(filtri.bu);
  const agenti = elenco(filtri.agente);
  if (rami.length > 0) risultato.push({ campo: "bu_categoria", op: "in", valore: rami });
  else if (bu.length > 0) risultato.push(filtroSu("bu", bu));
  if (agenti.length > 0) risultato.push(filtroSu("agente", agenti));
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
  const famiglieSpec = new Set(esistenti.map((filtro) => famiglia(filtro.campo)));
  // Un filtro di pagina che non si applica alla metrica del riquadro (la
  // business unit su un riquadro di ordini a fornitore) si salta e si dice.
  const nonApplicabile = (f: Filtro) => dimensioneFuoriDominio(spec.metrica, f.campo);
  const scartato = (f: Filtro) => famiglieSpec.has(famiglia(f.campo)) || nonApplicabile(f);
  const filtriPaginaIgnorati = proposti
    .filter(scartato)
    .map((filtro) => (famiglia(filtro.campo) === "bu" ? "bu" : filtro.campo) as Dimensione);
  const aggiunti = proposti.filter((filtro) => !scartato(filtro));
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
