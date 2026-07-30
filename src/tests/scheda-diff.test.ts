import { describe, it, expect } from "vitest";
import { diffRighe, contaModifiche, diffCompatto } from "@/lib/portali/preventivatore/scheda-tecnica/diff";

describe("diff scheda tecnica (revisione AI)", () => {
  it("nessuna differenza se il testo è identico", () => {
    const t = "Riga uno\nRiga due\nRiga tre";
    const d = diffRighe(t, t);
    expect(d.every((r) => r.tipo === "uguale")).toBe(true);
    expect(contaModifiche(d)).toEqual({ aggiunte: 0, rimosse: 0 });
  });

  it("rileva una riga modificata come rimossa + aggiunta", () => {
    const d = diffRighe("A\nB\nC", "A\nB2\nC");
    expect(contaModifiche(d)).toEqual({ aggiunte: 1, rimosse: 1 });
    expect(d.find((r) => r.tipo === "rimossa")?.testo).toBe("B");
    expect(d.find((r) => r.tipo === "aggiunta")?.testo).toBe("B2");
  });

  it("rileva righe solo aggiunte", () => {
    const d = diffRighe("A\nB", "A\nB\nC");
    expect(contaModifiche(d)).toEqual({ aggiunte: 1, rimosse: 0 });
  });

  it("rileva righe solo rimosse", () => {
    const d = diffRighe("A\nB\nC", "A\nC");
    expect(contaModifiche(d)).toEqual({ aggiunte: 0, rimosse: 1 });
  });

  it("conserva le righe invariate (l'AI non deve stravolgere il resto)", () => {
    const prima = ["Spett.le UPB", "Oggetto: NASTRO", "", "Descrizione fornitura:", "Testo lungo invariato."].join("\n");
    const dopo = ["Spett.le UPB", "Oggetto: NASTRO FS65", "", "Descrizione fornitura:", "Testo lungo invariato."].join("\n");
    const d = diffRighe(prima, dopo);
    expect(contaModifiche(d)).toEqual({ aggiunte: 1, rimosse: 1 });
    expect(d.filter((r) => r.tipo === "uguale").map((r) => r.testo)).toContain("Testo lungo invariato.");
  });

  it("il diff compatto mostra solo le modifiche col contesto", () => {
    const prima = ["1", "2", "3", "4", "5", "6", "7", "8"].join("\n");
    const dopo = ["1", "2", "3", "4x", "5", "6", "7", "8"].join("\n");
    const compatto = diffCompatto(diffRighe(prima, dopo), 1);
    expect(compatto.length).toBeLessThan(diffRighe(prima, dopo).length);
    expect(compatto.some((r) => r.tipo === "aggiunta" && r.testo === "4x")).toBe(true);
  });

  it("gestisce CRLF e testo vuoto", () => {
    expect(contaModifiche(diffRighe("A\r\nB", "A\nB"))).toEqual({ aggiunte: 0, rimosse: 0 });
    expect(contaModifiche(diffRighe("", ""))).toEqual({ aggiunte: 0, rimosse: 0 });
  });
});
