/** L'ultima comunicazione resta valida fino alla successiva, anche fra anni. */
export function carburanteVigente<T extends { anno: number; mese: number }>(
  righe: T[], anno: number, mese: number
): T | undefined {
  const limite = anno * 12 + mese;
  return righe.filter((r) => r.anno * 12 + r.mese <= limite)
    .sort((a, b) => (b.anno * 12 + b.mese) - (a.anno * 12 + a.mese))[0];
}

/**
 * La percentuale vale per il mese richiesto o è l'ultima disponibile?
 *
 * Non è un errore: la comunicazione resta valida fino alla successiva. Ma chi
 * guarda un costo atteso deve sapere se sta usando il dato del mese o uno più
 * vecchio, perché è lì che nascono gli scarti di pochi centesimi.
 */
export function carburanteDatato(
  riga: { anno: number; mese: number } | null | undefined,
  anno: number,
  mese: number
): boolean {
  return !!riga && (riga.anno !== anno || riga.mese !== mese);
}
