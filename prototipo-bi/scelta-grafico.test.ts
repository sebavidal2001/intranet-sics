import { describe, expect, it } from "vitest";
import {
  graficiPossibili,
  scegliGrafico,
} from "@/lib/prototipo-bi/scelta-grafico";
import type {
  Dimensione,
  RisultatoQuery,
  UnitaMisura,
} from "@/lib/prototipo-bi/tipi";

interface OpzioniRisultato {
  numeroRighe?: number;
  unita?: UnitaMisura;
  granularita?: "mese";
  raggruppa?: Dimensione[];
  categorie?: number;
  valori?: number[];
}

function creaRisultato({
  numeroRighe = 3,
  unita = "euro",
  granularita,
  raggruppa,
  categorie = numeroRighe,
  valori,
}: OpzioniRisultato = {}): RisultatoQuery {
  const righe = Array.from({ length: numeroRighe }, (_, indice) => {
    const categoria = `Categoria ${indice % Math.max(categorie, 1)}`;
    const chiavi: Record<string, string> = {};
    if (granularita) chiavi.periodo = `2026-${String(indice + 1).padStart(2, "0")}`;
    for (const [posizione, dimensione] of (raggruppa ?? []).entries()) {
      chiavi[dimensione] = posizione === 0 ? categoria : `Gruppo ${indice % 2}`;
    }
    return {
      etichetta: granularita ? chiavi.periodo : categoria,
      chiavi,
      valore: valori?.[indice] ?? numeroRighe - indice,
      conteggio: 1,
    };
  });
  return {
    spec: { metrica: "ordinato", granularita, raggruppa },
    metrica: "ordinato",
    unita,
    righe,
    totale: righe.reduce((somma, riga) => somma + riga.valore, 0),
    certificata: true,
    avvisi: [],
  };
}

describe("scegliGrafico", () => {
  it("usa la tabella con zero righe", () => {
    expect(scegliGrafico(creaRisultato({ numeroRighe: 0 })).tipo).toBe("tabella");
  });

  it("usa una KPI per un solo valore non raggruppato", () => {
    expect(scegliGrafico(creaRisultato({ numeroRighe: 1 })).tipo).toBe("kpi");
  });

  it("usa le linee per una serie temporale non raggruppata", () => {
    expect(scegliGrafico(creaRisultato({ granularita: "mese" })).tipo).toBe("linee");
  });

  it("usa le aree impilate fino a sei categorie nel tempo", () => {
    const risultato = creaRisultato({
      numeroRighe: 12,
      granularita: "mese",
      raggruppa: ["bu"],
      categorie: 6,
    });
    expect(scegliGrafico(risultato).tipo).toBe("areeImpilate");
  });

  it("usa le linee oltre sei categorie e spiega il limite", () => {
    const proposta = scegliGrafico(
      creaRisultato({ numeroRighe: 14, granularita: "mese", raggruppa: ["bu"], categorie: 7 })
    );
    expect(proposta.tipo).toBe("linee");
    expect(proposta.motivo).toMatch(/prime 6.*altre 1/);
  });

  it("usa la heatmap con due dimensioni", () => {
    expect(scegliGrafico(creaRisultato({ raggruppa: ["bu", "agente"] })).tipo).toBe("heatmap");
  });

  it("usa le barre per le percentuali", () => {
    expect(scegliGrafico(creaRisultato({ unita: "percentuale" })).tipo).toBe("barre");
  });

  it("usa la torta fino a otto valori numerici", () => {
    expect(scegliGrafico(creaRisultato({ numeroRighe: 8, unita: "numero" })).tipo).toBe("torta");
  });

  it("usa le barre da nove a trenta righe", () => {
    expect(scegliGrafico(creaRisultato({ numeroRighe: 30 })).tipo).toBe("barre");
  });

  it("usa il Pareto oltre trenta righe", () => {
    expect(scegliGrafico(creaRisultato({ numeroRighe: 31 })).tipo).toBe("pareto");
  });
});

describe("regole dure", () => {
  it("esclude torta, anelli e imbuto dalle serie temporali", () => {
    const possibili = graficiPossibili(creaRisultato({ granularita: "mese" }));
    expect(possibili).not.toEqual(expect.arrayContaining(["torta", "anelli", "imbuto"]));
  });

  it("esclude torta e anelli dalle percentuali", () => {
    const possibili = graficiPossibili(creaRisultato({ unita: "percentuale" }));
    expect(possibili).not.toEqual(expect.arrayContaining(["torta", "anelli"]));
  });

  it("non propone né sceglie la torta con valori negativi", () => {
    const risultato = creaRisultato({ valori: [10, -2, 4] });
    expect(graficiPossibili(risultato)).not.toContain("torta");
    expect(scegliGrafico(risultato).tipo).not.toBe("torta");
  });
});

describe("Buchi nella tabella di scelta", () => {
  it("poche righe in giorni finiscono in barre, non in tabella", () => {
    // Caso reale: "giorni medi di risposta per addetto back office", cinque
    // persone. Non e' temporale, non ha due dimensioni, non e' una
    // percentuale e l'unita' non e' euro ne' numero: cadeva in fondo alla
    // catena e finiva in tabella. Cinque valori confrontabili sono esattamente
    // cio' che le barre mostrano meglio di qualunque elenco.
    const risultato = creaRisultato({
      numeroRighe: 5,
      unita: "giorni",
      raggruppa: ["creatore"],
      valori: [2.1, 0.4, 3.8, 1.2, 0.9],
    });

    expect(scegliGrafico(risultato).tipo).toBe("barre");
  });

  it("non propone il combo: sarebbe la stessa metrica disegnata due volte", () => {
    // Il combo serve a sovrapporre due misure diverse (ordinato a barre,
    // budget a linea). Con un solo RisultatoQuery le due serie sarebbero lo
    // stesso dato: sembra un confronto e non lo e'.
    const risultato = creaRisultato({ numeroRighe: 4, granularita: "mese" });

    expect(graficiPossibili(risultato)).not.toContain("combo");
  });
});
