import { describe, expect, it } from "vitest";
import { chiavePersona, unisciPersonale } from "@/components/prototipo-bi/personale-insieme";
import { calcolaCruscottoAcquisti, type RigaAcquisto } from "@/lib/prototipo-bi/acquisti";

function buyer(nome: string, righe: number, extra: Partial<ReturnType<typeof base>> = {}) {
  return { ...base(nome, righe), ...extra };
}
function base(nome: string, righe: number) {
  return {
    nome,
    ordini: Math.ceil(righe / 4),
    righe,
    valore: 0,
    puntualitaPct: null,
    righeArrivate: 0,
    ritardoMedioGiorni: null,
    tempoConsegnaGiorni: null,
    righeAperte: 0,
    righeScadute: 0,
    valoreScaduto: 0,
    quotaRighePct: 0,
  };
}

describe("unisciPersonale", () => {
  it("la stessa persona scritta in modo diverso nelle due fonti compare una volta", () => {
    const persone = unisciPersonale(
      [{ nome: "ERIKA LIVRERI", documenti: 9, righe: 32 }],
      [buyer("Erika Livreri", 2)]
    );
    expect(persone).toHaveLength(1);
    expect(persone[0].nome).toBe("Erika Livreri");
    expect(persone[0].aree).toEqual(["vendite", "acquisti"]);
    expect(persone[0].righeTotali).toBe(34);
  });

  it("calcola la quota sul totale delle righe e ordina per carico", () => {
    const persone = unisciPersonale(
      [{ nome: "LUCIA RODA", documenti: 460, righe: 1412 }],
      [buyer("Claudio Dalsass", 4946, { righeScadute: 42 }), buyer("acquisti", 70)]
    );
    expect(persone.map((p) => p.nome)).toEqual(["Claudio Dalsass", "Lucia Roda", "acquisti"]);
    expect(persone[0].quotaPct).toBeCloseTo((4946 / (1412 + 4946 + 70)) * 100, 1);
    expect(persone[0].righeScadute).toBe(42);
    expect(persone.find((p) => p.nome === "acquisti")?.condiviso).toBe(true);
  });

  it("normalizza spazi e maiuscole", () => {
    expect(chiavePersona("  Lucia   Roda ")).toBe(chiavePersona("LUCIA RODA"));
  });
});

describe("caricoMensile degli acquisti", () => {
  it("conta le righe ordinate per mese e buyer nel periodo", () => {
    const r = (dataOrdine: string, buyerNome: string): RigaAcquisto => ({
      idRiga: 1, profilo: "OF", numeroOrdine: 1, dataOrdine, codiceFornitore: "F", fornitore: "F",
      buyerUtente: buyerNome, buyer: buyerNome, articolo: "A", descrizione: "", gruppoArticoli: "",
      quantita: 1, qtaArrivata: 1, valore: 1, dataPrevista: null, dataConfermata: null,
      rigaEvasa: true, chiusaForzata: false, primoArrivo: null,
    });
    const c = calcolaCruscottoAcquisti(
      [r("2026-07-03", "A"), r("2026-07-20", "A"), r("2026-08-01", "B"), r("2025-12-01", "A")],
      { dal: "2026-01-01", al: "2026-12-31", oggi: "2026-09-25" }
    );
    expect(c.caricoMensile).toEqual([
      { mese: "2026-07", perBuyer: { A: 2 } },
      { mese: "2026-08", perBuyer: { B: 1 } },
    ]);
  });
});
