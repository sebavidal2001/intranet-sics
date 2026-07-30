// ─── Diff riga-per-riga per la revisione della scheda tecnica ────────────────
// La chat di revisione fa riscrivere l'INTERA scheda dal modello: senza un
// confronto è impossibile accorgersi se ha toccato parti che andavano bene.
// Qui calcoliamo un diff per righe (LCS) da mostrare nell'anteprima.

export type RigaDiff = { tipo: "uguale" | "aggiunta" | "rimossa"; testo: string };

/** Matrice LCS sulle righe (schede di poche decine di righe: costo trascurabile). */
export function diffRighe(prima: string, dopo: string): RigaDiff[] {
  const a = prima.replace(/\r\n/g, "\n").split("\n");
  const b = dopo.replace(/\r\n/g, "\n").split("\n");

  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: RigaDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ tipo: "uguale", testo: a[i] });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ tipo: "rimossa", testo: a[i] });
      i++;
    } else {
      out.push({ tipo: "aggiunta", testo: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ tipo: "rimossa", testo: a[i++] });
  while (j < m) out.push({ tipo: "aggiunta", testo: b[j++] });

  return out;
}

/** Conteggio sintetico delle modifiche (righe non vuote). */
export function contaModifiche(diff: RigaDiff[]): { aggiunte: number; rimosse: number } {
  let aggiunte = 0;
  let rimosse = 0;
  for (const r of diff) {
    if (r.testo.trim() === "") continue;
    if (r.tipo === "aggiunta") aggiunte++;
    else if (r.tipo === "rimossa") rimosse++;
  }
  return { aggiunte, rimosse };
}

/** Solo le parti cambiate, con un po' di contesto attorno (per l'anteprima compatta). */
export function diffCompatto(diff: RigaDiff[], contesto = 1): RigaDiff[] {
  const tieni = new Set<number>();
  diff.forEach((r, idx) => {
    if (r.tipo === "uguale") return;
    for (let k = Math.max(0, idx - contesto); k <= Math.min(diff.length - 1, idx + contesto); k++) tieni.add(k);
  });
  return diff.filter((_, idx) => tieni.has(idx));
}
