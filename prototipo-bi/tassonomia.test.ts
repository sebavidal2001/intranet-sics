/**
 * Questi test rendono esplicita la copertura del catalogo, così una metrica
 * nuova non può sparire dal builder né ricevere dimensioni incompatibili.
 */

import { describe, expect, it } from "vitest";
import { CATALOGO, DIMENSIONI } from "@/lib/prototipo-bi/semantico";
import { dimensioniPerMetrica, TIPOLOGIE } from "@/lib/prototipo-bi/tassonomia";

describe("tassonomia delle analisi", () => {
  it("assegna ogni metrica del catalogo a una sola tipologia", () => {
    const classificate = TIPOLOGIE.flatMap((tipologia) => tipologia.metriche).sort();
    const catalogo = Object.keys(CATALOGO).sort();
    expect(classificate).toEqual(catalogo);
    expect(new Set(classificate).size).toBe(classificate.length);
  });

  it("non offre le dimensioni dei preventivi all'ordinato", () => {
    expect(dimensioniPerMetrica("ordinato")).not.toEqual(
      expect.arrayContaining(["creatore", "esito", "fascia_eta"])
    );
  });

  it("offre le dimensioni dei preventivi ai giorni di risposta", () => {
    expect(dimensioniPerMetrica("giorni_risposta")).toEqual(
      expect.arrayContaining(["creatore", "esito", "fascia_eta"])
    );
  });

  it("restituisce soltanto dimensioni note allo strato semantico", () => {
    for (const metrica of Object.keys(CATALOGO)) {
      for (const dimensione of dimensioniPerMetrica(metrica as keyof typeof CATALOGO)) {
        expect(DIMENSIONI).toHaveProperty(dimensione);
      }
    }
  });
});
