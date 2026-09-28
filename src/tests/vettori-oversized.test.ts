import { describe, expect, it } from "vitest";
import { basePallet, oversizedDichiaratoGls, valutaOversizedGls } from "@/lib/portali/vettori/oversized";
import { calcolaCostoAtteso } from "@/lib/portali/vettori/calcolo";
import { datiFisici } from "@/lib/portali/vettori/misure";
import type { RigaFattura } from "@/lib/portali/vettori/fatture/tipi";
import type { ListinoRisolto } from "@/lib/portali/vettori/tipi";

/**
 * Regola dal documento GLS «Colli oversized 2025» girato dall'amministrazione
 * il 28/09/2026; casi presi dalle righe GLS 2026 con il codice `TI`.
 */

describe("pallet secondo GLS", () => {
  it("riconosce l'europallet con la tolleranza del 15%", () => {
    expect(basePallet(120, 80)).toBe(true);
    expect(basePallet(80, 120)).toBe(true);
    expect(basePallet(138, 92)).toBe(true);
    expect(basePallet(139, 80)).toBe(false);
    expect(basePallet(100, 80)).toBe(false);
    expect(basePallet(120, 60)).toBe(false);
  });
});

describe("codice supplemento GLS", () => {
  it("la I vuol dire fuori misura, anche dentro RTI", () => {
    expect(oversizedDichiaratoGls("TI")).toBe(true);
    expect(oversizedDichiaratoGls("RTI")).toBe(true);
    expect(oversizedDichiaratoGls("T")).toBe(false);
    expect(oversizedDichiaratoGls("RTD")).toBe(false);
    expect(oversizedDichiaratoGls(null)).toBe(false);
  });
});

describe("valutazione del fuori misura", () => {
  it("addebitato e giustificato dal peso: 106,5 kg su un collo (ARTEC)", () => {
    const v = valutaOversizedGls({ colli: 1, pesoReale: 106.5 }, "TI");
    expect(v).toMatchObject({ applica: true, colli: 1, confermato: true });
  });

  it("addebitato su un collo leggero senza misure: si applica ma non si può verificare (AIRON, 12,5 kg)", () => {
    const v = valutaOversizedGls({ colli: 1, pesoReale: 12.5 }, "TI");
    expect(v).toMatchObject({ applica: true, colli: 1, confermato: null });
  });

  it("addebitato ma smentito dalle misure: non entra nell'atteso", () => {
    const v = valutaOversizedGls({ colli: 1, pesoReale: 12, misureColli: [{ quantita: 1, lunghezzaCm: 60, larghezzaCm: 40, altezzaCm: 40 }] }, "TI");
    expect(v).toMatchObject({ applica: false, confermato: false });
  });

  it("conta solo i colli fuori misura: un profilo da 300 cm e una scatola", () => {
    const v = valutaOversizedGls({ colli: 2, pesoReale: 30, misureColli: [
      { quantita: 1, lunghezzaCm: 300, larghezzaCm: 10, altezzaCm: 10 },
      { quantita: 1, lunghezzaCm: 40, larghezzaCm: 30, altezzaCm: 30 },
    ] }, "TI");
    expect(v).toMatchObject({ applica: true, colli: 1, confermato: true });
  });

  it("un pallet pesante non è fuori misura, uno alto sì", () => {
    const basso = valutaOversizedGls({ colli: 1, pesoReale: 300, misureColli: [{ quantita: 1, lunghezzaCm: 120, larghezzaCm: 80, altezzaCm: 150 }] }, "TI");
    expect(basso).toMatchObject({ applica: false, confermato: false });
    const alto = valutaOversizedGls({ colli: 1, pesoReale: 300, misureColli: [{ quantita: 1, lunghezzaCm: 120, larghezzaCm: 80, altezzaCm: 180 }] }, "TI");
    expect(alto).toMatchObject({ applica: true, colli: 1, confermato: true });
  });

  it("non addebitato: non si mette nell'atteso nemmeno oltre i 70 kg (può essere un pallet)", () => {
    expect(valutaOversizedGls({ colli: 1, pesoReale: 142 }, "T")).toBeNull();
  });
});

describe("il supplemento a collo conta i colli fuori misura", () => {
  const listino: ListinoRisolto = {
    vettore: { id: "g", codice: "gls", nome: "GLS", modelloTariffa: "scaglioni", divisoreVolumetrico: 300, pesoMinimoTassabile: 0, arrotondamentoKg: 0, arrotondamentoDaKg: 0 },
    zonaCodice: "IT",
    fasce: [{ pesoDa: 0, pesoA: null, importo: 10, tipo: "fisso", scattoKg: null, scattoImporto: null }],
    supplementi: [{ codice: "oversized", nome: "Oversized", tipoCalcolo: "per_collo", valore: 9, baseNolo: true, condizione: "oversized", importoMinimo: null, importoMassimo: null, sogliaKgDa: null, sogliaKgA: null }],
    adeguamento: null,
    carburante: 0,
  };
  it("4 colli di cui uno fuori misura: 9 €, non 36 €", () => {
    const c = calcolaCostoAtteso({ colli: 4, pesoReale: 30, condizioni: ["oversized"], colliOversized: 1 }, listino);
    expect(c.supplementi.find((s) => s.codice === "oversized")?.importo).toBe(9);
  });
  it("senza conteggio vale su tutti i colli, come prima", () => {
    const c = calcolaCostoAtteso({ colli: 2, pesoReale: 30, condizioni: ["oversized"] }, listino);
    expect(c.supplementi.find((s) => s.codice === "oversized")?.importo).toBe(18);
  });
});

describe("le misure della pagina Bolle entrano nel controllo", () => {
  const riga: RigaFattura = { numero: 1, data: "2026-07-02", numeroSpedizione: "1", riferimento: "123", controparte: "X", direzione: "uscita", colli: 2, peso: 20, pesoVolumetrico: null, pesoTassato: null, nolo: 8, supplementi: 0, carburante: 1, totale: 9, dettaglio: {} };
  it("usa le misure del magazzino quando nel controllo non ce ne sono", () => {
    const f = datiFisici(riga, null, undefined, [], 300, [{ quantita: 2, lunghezzaCm: 50, larghezzaCm: 40, altezzaCm: 30, pesoRealeKg: null }]);
    expect(f.fonte).toBe("Misure della bolla");
    expect(f.dati.misureColli).toEqual([{ quantita: 2, lunghezzaCm: 50, larghezzaCm: 40, altezzaCm: 30 }]);
    expect(f.dati.colli).toBe(2);
    expect(f.dati.pesoReale).toBe(20);
  });
  it("il peso pesato dal magazzino vale se c'è su tutti i gruppi", () => {
    const f = datiFisici(riga, null, undefined, [], 300, [{ quantita: 2, lunghezzaCm: 50, larghezzaCm: 40, altezzaCm: 30, pesoRealeKg: 24 }]);
    expect(f.dati.pesoReale).toBe(24);
  });
  it("le misure inserite nel controllo hanno la precedenza", () => {
    const f = datiFisici(riga, null, { riga: 1, colli: [{ quantita: 1, lunghezzaCm: 10, larghezzaCm: 10, altezzaCm: 10 }] }, [], 300, [{ quantita: 2, lunghezzaCm: 50, larghezzaCm: 40, altezzaCm: 30, pesoRealeKg: null }]);
    expect(f.fonte).toBe("Misure inserite nel controllo");
  });
});
