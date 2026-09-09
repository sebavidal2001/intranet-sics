/** L'ultima comunicazione resta valida fino alla successiva, anche fra anni. */
export function carburanteVigente<T extends { anno: number; mese: number }>(
  righe: T[], anno: number, mese: number
): T | undefined {
  const limite = anno * 12 + mese;
  return righe.filter((r) => r.anno * 12 + r.mese <= limite)
    .sort((a, b) => (b.anno * 12 + b.mese) - (a.anno * 12 + a.mese))[0];
}
