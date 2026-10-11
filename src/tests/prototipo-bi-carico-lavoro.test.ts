import { describe, expect, it } from "vitest";
import {
  AREE_LAVORO,
  chiavePersona,
  costruisciPersone,
  eRuoloCondiviso,
  mappaOre,
  mixDocumenti,
  perGiornoSettimana,
  perOra,
  serieMensili,
  sintetizza,
  soloPersona,
} from "@/lib/prototipo-bi/carico-lavoro";
import { calcolaCruscottoAcquisti, type RigaAcquisto } from "@/lib/prototipo-bi/acquisti";
import type { RisultatoQuery } from "@/lib/prototipo-bi/tipi";

function ris(righe: [Record<string, string>, number][]): RisultatoQuery {
  return {
    spec: { metrica: "righe_vendita_inserite" },
    metrica: "righe_vendita_inserite",
    unita: "numero",
    righe: righe.map(([chiavi, valore]) => ({ etichetta: Object.values(chiavi).join(" · "), chiavi, valore, conteggio: 1 })),
    totale: righe.reduce((t, [, v]) => t + v, 0),
    certificata: true,
    avvisi: [],
  };
}

const VENDITE = AREE_LAVORO.vendite;

describe("ruoli condivisi", () => {
  it("riconosce gli uffici e non le persone", () => {
    for (const n of ["vendite", "Segreteria", "AMMINISTRAZIONE", "acquisti", "magazzino1", "Magazzino 2"]) {
      expect(eRuoloCondiviso(n)).toBe(true);
    }
    for (const n of ["Lucia Roda", "Claudio Dalsass", "Erika Livreri"]) expect(eRuoloCondiviso(n)).toBe(false);
  });

  it("normalizza spazi e maiuscole", () => {
    expect(chiavePersona("  Lucia   Roda ")).toBe(chiavePersona("LUCIA RODA"));
  });
});

describe("costruisciPersone", () => {
  const persone = costruisciPersone(VENDITE, {
    documentiPerPersona: ris([[{ creatore: "LUCIA RODA" }, 10], [{ creatore: "vendite" }, 30]]),
    righePerPersona: ris([[{ creatore: "LUCIA RODA" }, 50], [{ creatore: "vendite" }, 150]]),
    documentiPerProfilo: ris([
      [{ creatore: "LUCIA RODA", profilo: "PC" }, 6],
      [{ creatore: "LUCIA RODA", profilo: "OC" }, 4],
      [{ creatore: "vendite", profilo: "FC" }, 30],
      [{ creatore: "vendite", profilo: "OF" }, 99], // profilo d'acquisto: non è di quest'area
    ]),
    documentiPerGiorno: ris([
      [{ creatore: "Lucia Roda", periodo: "2026-09-01" }, 3],
      [{ creatore: "Lucia Roda", periodo: "2026-09-02" }, 7],
      [{ creatore: "vendite", periodo: "2026-09-01" }, 30],
    ]),
  });

  it("unisce le fonti per persona anche con maiuscole diverse e conta i giorni distinti", () => {
    const lucia = persone.find((p) => p.nome === "Lucia Roda")!;
    expect(persone).toHaveLength(2);
    expect(lucia.documenti).toBe(10);
    expect(lucia.righe).toBe(50);
    expect(lucia.giorniAttivi).toBe(2);
    expect(lucia.righePerGiornoAttivo).toBe(25);
    expect(lucia.righePerDocumento).toBe(5);
    expect(lucia.perGruppo).toEqual({ preventivi: 6, ordini: 4, bolle: 0, fatture: 0 });
  });

  it("ordina per righe e calcola la quota sul totale dell'area", () => {
    expect(persone.map((p) => p.nome)).toEqual(["vendite", "Lucia Roda"]);
    expect(persone[0].quotaPct).toBe(75);
    expect(persone[0].condiviso).toBe(true);
  });

  it("ignora i profili che non sono dell'area", () => {
    expect(persone[0].perGruppo).toEqual({ preventivi: 0, ordini: 0, bolle: 0, fatture: 30 });
  });

  it("la sintesi esclude gli utenti condivisi da persone attive e righe al giorno", () => {
    const s = sintetizza(persone);
    expect(s.documenti).toBe(40);
    expect(s.righe).toBe(200);
    expect(s.personeAttive).toBe(1);
    expect(s.righePerGiornoAttivo).toBe(25);
    expect(s.quotaCondivisaPct).toBe(75);
  });

  it("senza dati non inventa persone", () => {
    expect(costruisciPersone(VENDITE, {})).toEqual([]);
    expect(sintetizza([]).righePerGiornoAttivo).toBe(0);
  });
});

describe("ritmo", () => {
  it("raggruppa per giorno della settimana, lunedì per primo", () => {
    // 2026-09-07 è un lunedì, 2026-09-12 un sabato.
    const g = perGiornoSettimana(
      ris([[{ periodo: "2026-09-07" }, 5], [{ periodo: "2026-09-14" }, 3], [{ periodo: "2026-09-12" }, 2]])
    );
    expect(g.map((x) => x.etichetta)).toEqual(["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]);
    expect(g[0].valore).toBe(8);
    expect(g[5].valore).toBe(2);
  });

  it("riempie le ore vuote fra la prima e l'ultima: la pausa pranzo non sparisce", () => {
    const o = perOra(
      ris([
        [{ creatore: "A", ora_creazione: "08:00" }, 4],
        [{ creatore: "B", ora_creazione: "08:00" }, 1],
        [{ creatore: "A", ora_creazione: "11:00" }, 2],
        [{ creatore: "A", ora_creazione: "(non indicata)" }, 9],
      ])
    );
    expect(o.map((x) => x.etichetta)).toEqual(["08:00", "09:00", "10:00", "11:00"]);
    expect(o.map((x) => x.valore)).toEqual([5, 0, 0, 2]);
  });

  it("la mappa persona x ora esclude i ruoli condivisi", () => {
    const persone = costruisciPersone(VENDITE, {
      documentiPerPersona: ris([[{ creatore: "Lucia Roda" }, 1], [{ creatore: "vendite" }, 1]]),
      righePerPersona: ris([[{ creatore: "Lucia Roda" }, 5], [{ creatore: "vendite" }, 9]]),
    });
    const m = mappaOre(
      ris([
        [{ creatore: "LUCIA RODA", ora_creazione: "09:00" }, 5],
        [{ creatore: "vendite", ora_creazione: "09:00" }, 9],
      ]),
      persone
    );
    expect(m.righe).toEqual(["Lucia Roda"]);
    expect(m.valori["Lucia Roda"]["09:00"]).toBe(5);
  });

  it("soloPersona restringe senza rifare la query", () => {
    const r = ris([[{ creatore: "LUCIA RODA", periodo: "2026-09-01" }, 3], [{ creatore: "Altro", periodo: "2026-09-01" }, 7]]);
    expect(soloPersona(r, chiavePersona("Lucia Roda"))!.righe).toHaveLength(1);
    expect(soloPersona(r, null)).toBe(r);
  });
});

describe("serieMensili e mix", () => {
  it("le persone oltre il limite confluiscono in Altri", () => {
    const righe: [Record<string, string>, number][] = [];
    for (let i = 0; i < 4; i++) righe.push([{ creatore: `P${i}`, periodo: "2026-03" }, 10 - i]);
    const s = serieMensili(ris(righe), 2026, 2);
    expect(s.periodi).toEqual(["mar"]);
    expect(s.serie.map((x) => x.nome)).toEqual(["P0", "P1", "Altri"]);
    expect(s.serie[2].valori.mar).toBe(8 + 7);
  });

  it("un anno diverso da quello scelto compare nell'etichetta del mese", () => {
    const s = serieMensili(ris([[{ creatore: "A", periodo: "2025-12" }, 1]]), 2026);
    expect(s.periodi).toEqual(["dic 25"]);
  });

  it("il mix tiene solo i tipi che hanno documenti", () => {
    const persone = costruisciPersone(VENDITE, {
      documentiPerPersona: ris([[{ creatore: "A" }, 5]]),
      righePerPersona: ris([[{ creatore: "A" }, 5]]),
      documentiPerProfilo: ris([[{ creatore: "A", profilo: "PCA" }, 3], [{ creatore: "A", profilo: "BC" }, 2]]),
    });
    expect(mixDocumenti(VENDITE, persone)).toEqual([
      { etichetta: "Preventivi", valore: 3 },
      { etichetta: "Bolle", valore: 2 },
    ]);
  });
});

describe("caricoMensile degli acquisti", () => {
  it("conta le righe ordinate per mese e buyer nel periodo", () => {
    const r = (dataOrdine: string, buyerNome: string): RigaAcquisto => ({
      idRiga: 1, profilo: "OF", numeroOrdine: 1, dataOrdine, codiceFornitore: "F", fornitore: "F",
      buyerUtente: buyerNome, buyer: buyerNome, articolo: "A", descrizione: "", gruppoArticoli: "", categoria: "-", businessUnit: "-",
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
