import type { DatiSpedizione } from "./tipi";

/**
 * Il supplemento «fuori misura» (oversized) di GLS.
 *
 * La regola viene dal documento GLS che l'amministrazione ci ha girato il
 * 28/09/2026 («Colli oversized 2025»):
 *
 *   - è un **pallet** il collo con un lato della base oltre 102 cm (fino a 138)
 *     e l'altro oltre 68 cm (fino a 92): l'europallet con il 15% di tolleranza.
 *     Un pallet è fuori misura solo se è alto più di 170 cm;
 *   - ogni altro **collo** è fuori misura se pesa più di 70 kg o se ha un lato
 *     oltre 120 cm.
 *
 * L'importo (9 € a collo) sta nel listino, non qui.
 *
 * In fattura GLS lo dichiara con la lettera `I` nella colonna dei codici
 * supplemento (`TI`, `RTI`). Verificato sulle 33 righe 2026 che la portano:
 * 20 hanno oltre 70 kg per collo, le altre 13 sono leggere ma vengono da chi
 * spedisce profili lunghi (ALUSIC, AIRON). Le 9 righe oltre 70 kg senza la `I`
 * sono compatibili con dei pallet, per cui il peso non conta.
 *
 * Il supplemento entra nel costo atteso solo quando GLS lo addebita: dal solo
 * peso non si distingue un collo pesante da un pallet, e mettere nell'atteso
 * 9 € che il vettore non ha chiesto produrrebbe un'anomalia a nostro sfavore
 * che nessuno contesterebbe mai.
 */

export const SOGLIE_OVERSIZED_GLS = {
  pesoColloKg: 70,
  latoColloCm: 120,
  altezzaPalletCm: 170,
  palletLatoLungoCm: [102, 138] as const,
  palletLatoCortoCm: [68, 92] as const,
};

/** Un collo con questa base è un pallet per GLS. */
export function basePallet(lunghezzaCm: number, larghezzaCm: number): boolean {
  const lungo = Math.max(lunghezzaCm, larghezzaCm);
  const corto = Math.min(lunghezzaCm, larghezzaCm);
  const [lMin, lMax] = SOGLIE_OVERSIZED_GLS.palletLatoLungoCm;
  const [cMin, cMax] = SOGLIE_OVERSIZED_GLS.palletLatoCortoCm;
  return lungo > lMin && lungo <= lMax && corto > cMin && corto <= cMax;
}

/** La lettera `I` fra i codici supplemento GLS: fuori misura addebitato. */
export function oversizedDichiaratoGls(codiciSupplemento: string | null | undefined): boolean {
  return /I/i.test(codiciSupplemento ?? "");
}

export interface ValutazioneOversized {
  /** Il supplemento va nel costo atteso. */
  applica: boolean;
  /** Su quanti colli. */
  colli: number;
  /** GLS lo ha addebitato (codice `I`). */
  dichiarato: boolean;
  /**
   * `true` se i nostri dati lo confermano, `false` se lo smentiscono, `null` se
   * non bastano per dirlo (misure assenti e peso per collo entro i 70 kg).
   */
  confermato: boolean | null;
  motivo: string;
}

function kg(n: number): string {
  return n.toLocaleString("it-IT", { maximumFractionDigits: 1 });
}

/**
 * Decide se e su quanti colli applicare il fuori misura GLS.
 *
 * Restituisce `null` quando non c'è niente da dire: GLS non lo addebita e i
 * nostri dati non lo suggeriscono.
 */
export function valutaOversizedGls(
  dati: DatiSpedizione,
  codiciSupplemento: string | null | undefined
): ValutazioneOversized | null {
  const dichiarato = oversizedDichiaratoGls(codiciSupplemento);
  const misure = dati.misureColli?.filter((m) => m.quantita > 0) ?? [];
  const colliTotali = misure.length
    ? misure.reduce((s, m) => s + m.quantita, 0)
    : Math.max(1, dati.colli);
  const pesoMedio = dati.pesoReale > 0 ? dati.pesoReale / colliTotali : 0;
  const s = SOGLIE_OVERSIZED_GLS;

  if (misure.length) {
    let fuoriMisura = 0;
    for (const m of misure) {
      const pallet = basePallet(m.lunghezzaCm, m.larghezzaCm);
      const oltre = pallet
        ? m.altezzaCm > s.altezzaPalletCm
        : Math.max(m.lunghezzaCm, m.larghezzaCm, m.altezzaCm) > s.latoColloCm ||
          pesoMedio > s.pesoColloKg;
      if (oltre) fuoriMisura += m.quantita;
    }
    if (dichiarato && fuoriMisura > 0) {
      return { applica: true, colli: fuoriMisura, dichiarato, confermato: true,
        motivo: `Fuori misura GLS confermato dalle misure: ${fuoriMisura} ${fuoriMisura === 1 ? "collo" : "colli"} oltre i limiti (collo oltre ${s.pesoColloKg} kg o con un lato oltre ${s.latoColloCm} cm, pallet oltre ${s.altezzaPalletCm} cm di altezza).` };
    }
    if (dichiarato) {
      return { applica: false, colli: 0, dichiarato, confermato: false,
        motivo: `GLS addebita il fuori misura (codice I), ma le misure inserite non lo giustificano: nessun collo supera ${s.latoColloCm} cm di lato né ${s.pesoColloKg} kg, nessun pallet supera ${s.altezzaPalletCm} cm.` };
    }
    return null;
  }

  if (!dichiarato) return null;

  if (pesoMedio > s.pesoColloKg) {
    return { applica: true, colli: colliTotali, dichiarato, confermato: true,
      motivo: `Fuori misura GLS giustificato dal peso: ${kg(pesoMedio)} kg per collo, oltre i ${s.pesoColloKg} kg.` };
  }
  return { applica: true, colli: 1, dichiarato, confermato: null,
    motivo: `GLS addebita il fuori misura (codice I) su un collo da ${kg(pesoMedio)} kg: lo giustificherebbe solo un lato oltre ${s.latoColloCm} cm. Senza misure non si può verificare.` };
}
