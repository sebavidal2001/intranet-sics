/**
 * LE MISURE PERSONALIZZATE NEL VOCABOLARIO DEL BUILDER.
 *
 * L'albero dei campi sa solo di «chiavi» di metrica. Una misura salvata entra
 * come una chiave in piu', `misura:<id>`, in un gruppo suo («Misure
 * personalizzate»), con le dimensioni che tutti i suoi operandi ammettono. Le
 * funzioni qui sono pure: non chiamano API e non toccano React, cosi' si
 * provano da sole.
 *
 * Una misura che una spec gia' porta (riquadro di una dashboard, anche se la
 * misura e' stata archiviata) entra nello stesso modo: la definizione e' nella
 * spec, il catalogo non e' necessario per mostrarla.
 */

import { dimensioniDellaMisura, descriviMisura, unitaDellaMisura } from "./misure";
import type { ChiaveMetrica, Dimensione, MisuraDefinita, SpecQuery } from "./tipi";
import type { ChiaveTipologia } from "./tassonomia";

export const PREFISSO_MISURA = "misura:";

/** Una voce spuntabile nell'albero: una metrica del catalogo o una misura personalizzata. */
export type ChiaveCampo = ChiaveMetrica | `misura:${string}`;

export function eChiaveMisura(chiave: string): chiave is `misura:${string}` {
  return chiave.startsWith(PREFISSO_MISURA);
}

/** Per una misura salvata la chiave e' l'id; per una al volo, il nome. */
export function chiaveMisura(misura: MisuraDefinita): `misura:${string}` {
  return `${PREFISSO_MISURA}${misura.id ?? misura.nome}`;
}

/** La voce dell'albero a cui corrisponde una spec. */
export function chiaveDellaSpec(spec: SpecQuery): ChiaveCampo {
  return spec.misura ? chiaveMisura(spec.misura) : spec.metrica;
}

/**
 * La spec per una voce dell'albero, partendo da una base (suddivisioni,
 * granularita', periodo...). Per una metrica toglie un'eventuale misura
 * rimasta; per una misura imposta la definizione, e `metrica` la riscrive il
 * validatore.
 */
export function specPerChiave(
  base: SpecQuery,
  chiave: ChiaveCampo,
  definizioni: Record<string, MisuraDefinita>
): SpecQuery | null {
  const senza: SpecQuery = { ...base };
  delete senza.misura;
  if (!eChiaveMisura(chiave)) return { ...senza, metrica: chiave };
  const definizione = definizioni[chiave];
  if (!definizione) return null;
  // La metrica e' quella rappresentativa: la ricalcola `validaSpec`; qui serve
  // solo a tenere il tipo valido finche' la spec non passa dal server.
  return { ...senza, metrica: base.metrica, misura: definizione };
}

export interface VoceMetricaEstesa {
  chiave: ChiaveCampo;
  etichetta: string;
  descrizione: string;
  unita: string;
}

export interface VoceTipologiaEstesa {
  chiave: ChiaveTipologia;
  etichetta: string;
  descrizione: string;
  metriche: ChiaveCampo[];
}

export interface VocabolarioEstendibile {
  tipologie: Array<Omit<VoceTipologiaEstesa, "metriche"> & { metriche: ChiaveMetrica[] }>;
  metriche: Array<Omit<VoceMetricaEstesa, "chiave"> & { chiave: ChiaveMetrica }>;
  dimensioniPerMetrica: Record<ChiaveMetrica, Dimensione[]>;
}

export interface VocabolarioConMisure<V extends VocabolarioEstendibile> {
  vocabolario: Omit<V, "tipologie" | "metriche" | "dimensioniPerMetrica"> & {
    tipologie: VoceTipologiaEstesa[];
    metriche: VoceMetricaEstesa[];
    dimensioniPerMetrica: Record<string, Dimensione[]>;
  };
  /** Le definizioni per chiave, da dare a `specPerChiave`. */
  definizioni: Record<string, MisuraDefinita>;
}

/**
 * Aggiunge le misure al vocabolario. Le definizioni con la stessa chiave si
 * fondono (vince la prima: quella del catalogo prima di quelle trovate nelle
 * spec), e l'ordine e' quello in cui arrivano.
 */
export function estendiVocabolario<V extends VocabolarioEstendibile>(
  vocabolario: V,
  misure: MisuraDefinita[]
): VocabolarioConMisure<V> {
  const definizioni: Record<string, MisuraDefinita> = {};
  for (const m of misure) {
    const chiave = chiaveMisura(m);
    if (!definizioni[chiave]) definizioni[chiave] = m;
  }
  const chiavi = Object.keys(definizioni) as Array<`misura:${string}`>;

  const dimensioniPerMetrica: Record<string, Dimensione[]> = { ...vocabolario.dimensioniPerMetrica };
  const metriche: VoceMetricaEstesa[] = [...vocabolario.metriche];
  for (const chiave of chiavi) {
    const m = definizioni[chiave];
    dimensioniPerMetrica[chiave] = dimensioniDellaMisura(m);
    metriche.push({
      chiave,
      etichetta: m.nome,
      descrizione: descriviMisura(m),
      unita: unitaDellaMisura(m.espressione),
    });
  }

  const tipologie: VoceTipologiaEstesa[] = [...vocabolario.tipologie];
  if (chiavi.length > 0) {
    tipologie.push({
      chiave: "misure",
      etichetta: "Misure personalizzate",
      descrizione: "Quelle create a parole, pronte da riusare.",
      metriche: chiavi,
    });
  }

  return {
    vocabolario: { ...vocabolario, tipologie, metriche, dimensioniPerMetrica },
    definizioni,
  };
}

/** Le definizioni portate da una spec e dalle sue serie (per rimostrare i riquadri salvati). */
export function misureNelleSpec(specs: Array<SpecQuery | null | undefined>): MisuraDefinita[] {
  return specs.flatMap((s) => (s?.misura ? [s.misura] : []));
}
