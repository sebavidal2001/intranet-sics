import { describe, expect, it } from "vitest";
import { leggiFiltriInizialiSpedizioni } from "@/lib/portali/vettori/storico-query";

describe("filtri iniziali condivisibili di Spedizioni", () => {
  it("legge direzione e agganci assistito + nessuno", () => {
    expect(leggiFiltriInizialiSpedizioni({
      direzione: "entrata",
      abbinamenti: "assistito,nessuno",
    })).toEqual({ direzione: "entrata", abbinamenti: ["assistito", "nessuno"] });
  });

  it("mantiene i default se i parametri mancano o non sono validi", () => {
    expect(leggiFiltriInizialiSpedizioni({})).toEqual({ direzione: "uscita", abbinamenti: [] });
    expect(leggiFiltriInizialiSpedizioni({ direzione: "laterale", abbinamenti: "forse" })).toEqual({
      direzione: "uscita",
      abbinamenti: [],
    });
  });
});
