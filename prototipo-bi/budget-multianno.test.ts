import { describe, expect, it } from "vitest";
import {
  anniDellaSpec,
  risolviBudget,
  unisciSerieBudget,
} from "@/lib/prototipo-bi/budget-fonte";
import type { RigaSerieBudget, SerieBudget } from "@/lib/prototipo-bi/tipi";

function riga(
  data: string,
  budget: number,
  agente: string | null = null
): RigaSerieBudget {
  return {
    data,
    area: "COMPONENTI",
    agente,
    codiceAgente: agente ? `COD-${agente}` : null,
    budget,
    bep: budget / 2,
    granularita: "giorno",
  };
}

function serie(
  anno: number,
  righe: RigaSerieBudget[],
  origine: SerieBudget["origine"] = "importato",
  formato = "xlsx"
): SerieBudget {
  const righeArea = righe.filter((voce) => voce.agente === null);
  return {
    origine,
    formato,
    importatoIl: `${anno}-01-02T00:00:00.000Z`,
    anni: [anno],
    totaliPerAnno: {
      [anno]: {
        budget: righeArea.reduce((somma, voce) => somma + voce.budget, 0),
        bep: righeArea.reduce((somma, voce) => somma + voce.bep, 0),
      },
    },
    righe,
  };
}

describe("anniDellaSpec", () => {
  const copertura = { dataMinima: "2025-01-07", dataMassima: "2026-09-11" };

  it("usa il solo anno esplicito", () => {
    expect(anniDellaSpec({ metrica: "budget", periodo: { anno: 2025 } }, copertura)).toEqual([
      2025,
    ]);
  });

  it("include tutti gli anni fra dal e al", () => {
    expect(
      anniDellaSpec(
        { metrica: "budget", periodo: { dal: "2025-03-01", al: "2026-02-28" } },
        copertura
      )
    ).toEqual([2025, 2026]);
  });

  it("usa l'intera copertura quando il periodo manca", () => {
    expect(anniDellaSpec({ metrica: "budget" }, copertura)).toEqual([2025, 2026]);
  });

  it("include anche l'anno precedente per i modificatori anno su anno", () => {
    expect(
      anniDellaSpec(
        { metrica: "budget", modificatore: "anno_precedente", periodo: { anno: 2026 } },
        copertura
      )
    ).toEqual([2025, 2026]);
  });
});

describe("unisciSerieBudget", () => {
  const serie2025 = serie(2025, [riga("2025-01-15", 100)]);
  const serie2026 = serie(2026, [riga("2026-02-15", 200)]);

  it("concatena le righe e conserva i metadati di entrambi gli anni", () => {
    const unita = unisciSerieBudget({ 2025: serie2025, 2026: serie2026 }, [2025, 2026]);

    expect(unita).not.toBeNull();
    expect(unita?.righe.map((voce) => voce.data)).toEqual(["2025-01-15", "2026-02-15"]);
    expect(unita?.anni).toEqual([2025, 2026]);
    expect(unita?.totaliPerAnno).toEqual({
      2025: { budget: 100, bep: 50 },
      2026: { budget: 200, bep: 100 },
    });
  });

  it("salta gli anni senza serie", () => {
    const unita = unisciSerieBudget({ 2025: serie2025, 2026: null }, [2025, 2026]);

    expect(unita?.anni).toEqual([2025]);
    expect(unita?.righe).toHaveLength(1);
  });

  it("restituisce null quando tutte le serie richieste sono assenti", () => {
    expect(unisciSerieBudget({ 2025: null, 2026: null }, [2025, 2026])).toBeNull();
  });

  it("rende visibili le origini miste mantenendo l'origine del primo anno", () => {
    const generata = serie(2026, [riga("2026-02-15", 200)], "generato", "generato");
    const unita = unisciSerieBudget({ 2025: serie2025, 2026: generata }, [2025, 2026]);

    expect(unita?.origine).toBe("importato");
    expect(unita?.formato).toContain("importato + generato");
  });

  it("permette a risolviBudget di restituire i mesi di entrambi gli anni", () => {
    const unita = unisciSerieBudget({ 2025: serie2025, 2026: serie2026 }, [2025, 2026]);
    const esito = risolviBudget(
      {
        metrica: "budget",
        granularita: "mese",
        periodo: { dal: "2025-01-01", al: "2026-12-31" },
      },
      unita
    );

    expect(esito.risultato.righe.map((voce) => voce.etichetta)).toEqual([
      "2025-01",
      "2026-02",
    ]);
    expect(esito.risultato.totale).toBe(300);
  });

  it("non somma il livello area e il livello agente", () => {
    const conDueLivelli2025 = serie(2025, [
      riga("2025-01-15", 100),
      riga("2025-01-15", 60, "AGENTE A"),
      riga("2025-01-15", 40, "AGENTE B"),
    ]);
    const conDueLivelli2026 = serie(2026, [
      riga("2026-02-15", 200),
      riga("2026-02-15", 120, "AGENTE A"),
      riga("2026-02-15", 80, "AGENTE B"),
    ]);
    const unita = unisciSerieBudget(
      { 2025: conDueLivelli2025, 2026: conDueLivelli2026 },
      [2025, 2026]
    );

    const esito = risolviBudget(
      { metrica: "budget", periodo: { dal: "2025-01-01", al: "2026-12-31" } },
      unita
    );

    expect(esito.risultato.totale).toBe(300);
  });
});
