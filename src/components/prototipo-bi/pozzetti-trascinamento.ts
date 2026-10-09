/**
 * Il trascinamento di un campo dall'albero ai pozzetti.
 *
 * Sta in un modulo a parte perche' lo usano sia l'albero (che da' l'avvio) sia
 * le regole dei pozzetti (che lo ricevono), e le regole importano funzioni
 * dell'albero: senza questo ci sarebbe un ciclo fra i due.
 *
 * Durante il trascinamento il browser non lascia leggere il contenuto del
 * trasferimento (`dataTransfer.getData` e' vuoto fino al rilascio), quindi per
 * evidenziare i pozzetti che accetterebbero la voce serve ricordarla a parte.
 */

import { VOCI_CALENDARIO } from "@/lib/prototipo-bi/gruppi-campi";
import type { ChiaveCampo } from "@/lib/prototipo-bi/misure-vocabolario";
import type { Dimensione, Granularita } from "@/lib/prototipo-bi/tipi";

/** Quello che si trascina: una voce dell'albero. */
export type VoceCampo =
  | { tipo: "misura"; chiave: ChiaveCampo }
  | { tipo: "dimensione"; chiave: Dimensione }
  | { tipo: "calendario"; chiave: Granularita };

export const TIPO_MIME_CAMPO = "application/x-sics-campo";

export function sonoUguali(a: VoceCampo, b: VoceCampo): boolean {
  return a.tipo === b.tipo && a.chiave === b.chiave;
}

let inTrascinamento: VoceCampo | null = null;
const ascoltatori = new Set<() => void>();

export function impostaTrascinamento(voce: VoceCampo | null): void {
  inTrascinamento = voce;
  for (const a of ascoltatori) a();
}

export function leggiTrascinamento(): VoceCampo | null {
  return inTrascinamento;
}

export function iscriviTrascinamento(ascoltatore: () => void): () => void {
  ascoltatori.add(ascoltatore);
  return () => {
    ascoltatori.delete(ascoltatore);
  };
}

/** Rilegge una voce dal trasferimento, senza fidarsi del contenuto. */
export function leggiVoceDalTrasferimento(grezzo: string | undefined): VoceCampo | null {
  if (!grezzo) return null;
  try {
    const v = JSON.parse(grezzo) as { tipo?: unknown; chiave?: unknown };
    if (typeof v.chiave !== "string") return null;
    if (v.tipo === "misura" || v.tipo === "dimensione") return { tipo: v.tipo, chiave: v.chiave } as VoceCampo;
    if (v.tipo === "calendario" && VOCI_CALENDARIO.some((c) => c.chiave === v.chiave)) {
      return { tipo: "calendario", chiave: v.chiave as Granularita };
    }
    return null;
  } catch {
    return null;
  }
}
