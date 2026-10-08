import { describe, expect, it } from "vitest";
import { carburanteDaFattura } from "@/lib/portali/vettori/carburante-da-fattura";
import { carburanteDatato, carburanteVigente } from "@/lib/portali/vettori/carburante";
import { codiceSupplemento, NuovoSupplemento } from "@/lib/portali/vettori/listini-config";
import type { FatturaLetta, RigaFattura } from "@/lib/portali/vettori/fatture/tipi";

const riga = (data: string | null, pct: number | string | undefined): RigaFattura => ({
  numero: 1, data, numeroSpedizione: null, riferimento: null, controparte: null, direzione: null,
  colli: 1, peso: 1, pesoVolumetrico: null, pesoTassato: 1, nolo: 6, supplementi: 0, carburante: 1, totale: 7,
  dettaglio: pct === undefined ? {} : { percentuale_carburante: pct },
});

const fattura = (vettore: FatturaLetta["vettore"], righe: RigaFattura[], pctTestata: number | null = null): FatturaLetta => ({
  vettore, numero: "F1", data: "2026-09-30", anno: 2026, mese: 9, righe,
  totali: {
    spedizioni: righe.length, colli: null, peso: null, pesoRiferito: "reale", nolo: null, supplementi: null,
    adeguamento: null, carburante: null, percentualeCarburante: pctTestata, totaleDocumento: null,
  },
  righeNonLette: [], avvertenze: [],
});

describe("carburante letto dalla fattura", () => {
  it("GLS: la percentuale stampata vale per il mese della fattura", () => {
    expect(carburanteDaFattura(fattura("gls", [], 0.135))).toEqual([
      expect.objectContaining({ vettore: "gls", anno: 2026, mese: 9, percentuale: 0.135 }),
    ]);
  });

  it("FedEx: un valore per mese di spedizione, anche su una fattura a cavallo", () => {
    const esiti = carburanteDaFattura(fattura("fedex", [
      riga("2026-05-28", 0.2038), riga("2026-06-03", 0.2522), riga("2026-06-10", 0.2522), riga("2026-06-12", 0.2),
    ]));
    const fedex = esiti.filter((e) => e.vettore === "fedex");
    expect(fedex.map((e) => [e.mese, e.percentuale]).sort()).toEqual([[5, 0.2038], [6, 0.2522]]);
  });

  it("FedEx: la stessa percentuale va anche a TNT, che condivide la tabella", () => {
    const esiti = carburanteDaFattura(fattura("fedex", [riga("2026-08-06", 0.2384)]));
    expect(esiti.map((e) => e.vettore).sort()).toEqual(["fedex", "tnt"]);
  });

  it("scarta valori assenti, vuoti o impossibili", () => {
    expect(carburanteDaFattura(fattura("fedex", [riga("2026-08-06", ""), riga("2026-08-07", undefined), riga("2026-08-08", 24.3)]))).toEqual([]);
  });

  it("TNT e Trading Post non scrivono nulla: il dato non è dichiarato", () => {
    expect(carburanteDaFattura(fattura("tnt", [], 0.238))).toEqual([]);
    expect(carburanteDaFattura(fattura("trading_post", [], 0.11))).toEqual([]);
  });
});

describe("carburante non del mese", () => {
  const righe = [{ anno: 2026, mese: 8 }, { anno: 2026, mese: 7 }];
  it("riconosce quando si usa un mese precedente", () => {
    expect(carburanteDatato(carburanteVigente(righe, 2026, 10), 2026, 10)).toBe(true);
    expect(carburanteDatato(carburanteVigente(righe, 2026, 8), 2026, 8)).toBe(false);
    expect(carburanteDatato(null, 2026, 10)).toBe(false);
  });
});

describe("supplemento a periodo", () => {
  it("ricava un codice stabile dal nome", () => {
    expect(codiceSupplemento("Diritto fisso (alta domanda)")).toBe("diritto_fisso_alta_domanda");
    expect(codiceSupplemento("Più città")).toBe("piu_citta");
  });

  const base = { listino_id: "5aa6dff8-3d23-4374-8d38-dd383cd81b84", nome: "Diritto fisso", tipo_calcolo: "fisso_spedizione", valore: 0.85, valido_dal: "2026-11-01", valido_al: "2026-12-31" };
  it("accetta il caso FedEx", () => {
    const r = NuovoSupplemento.safeParse(base);
    expect(r.success && r.data.base_nolo).toBe(false);
  });
  it("richiede l'inizio e rifiuta un periodo rovesciato", () => {
    expect(NuovoSupplemento.safeParse({ ...base, valido_dal: "" }).success).toBe(false);
    expect(NuovoSupplemento.safeParse({ ...base, valido_al: "2026-10-01" }).success).toBe(false);
  });
});
