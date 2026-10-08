import { describe, expect, it, vi } from "vitest";
import { calcolaControlloRiga, nuovoContestoControllo } from "@/lib/portali/vettori/acquisizione";
import type { RigaFattura } from "@/lib/portali/vettori/fatture/tipi";
import type { SpedizioneLogica } from "@/lib/portali/vettori/abbinamento";
import type { ListinoRisolto } from "@/lib/portali/vettori/tipi";

const listino: ListinoRisolto = {
  vettore: {
    id: "v1",
    codice: "tnt",
    nome: "TNT",
    modelloTariffa: "scaglioni",
    divisoreVolumetrico: 250,
    pesoMinimoTassabile: 0,
    arrotondamentoKg: 0,
    arrotondamentoDaKg: 0,
  },
  zonaCodice: "IT",
  fasce: [{ pesoDa: 0, pesoA: 20, importo: 10, tipo: "fisso", scattoKg: null, scattoImporto: null }],
  supplementi: [],
  adeguamento: null,
  carburante: 0,
};

vi.mock("@/lib/portali/vettori/listino-service", () => ({
  risolviListino: vi.fn(async () => ({ listino, motivo: null })),
  descriviListino: vi.fn(async () => ({ id: "l1", etichetta: "Listino TNT" })),
}));

const riga: RigaFattura = {
  numero: 1,
  data: "2026-10-01",
  numeroSpedizione: "AWB-1",
  riferimento: "101",
  controparte: "CLIENTE SPA",
  direzione: "uscita",
  colli: 1,
  peso: 10,
  pesoVolumetrico: null,
  pesoTassato: 10,
  nolo: 10,
  supplementi: 0,
  carburante: 0,
  totale: 10,
  dettaglio: {},
};

const spedizione: SpedizioneLogica = {
  chiave: "uscita|cliente|101|2026-10-01",
  direzione: "uscita",
  riferimento: "101",
  riferimentoNorm: "101",
  dataDocumento: "2026-10-01",
  codiceControparte: "C1",
  controparte: "CLIENTE SPA",
  zonaCap: "20100",
  zonaProvincia: "MI",
  portoCodice: "01",
  porto: "Franco",
  aNostroCarico: true,
  vettoreCodice: "TNT",
  colli: 1,
  peso: 10,
  idDocumenti: [1],
};

describe("controllo fattura senza bolla certa", () => {
  it("resta non valutabile anche quando coincide col listino, poi torna in linea dopo l'aggancio", async () => {
    const contesto = nuovoContestoControllo("v1", "tnt", []);
    const senzaBolla = await calcolaControlloRiga({ ...riga, dettaglio: {} }, null, undefined, [], contesto);
    expect(senzaBolla.controllo?.atteso_totale).toBe(10);
    expect(senzaBolla.controllo?.esito).toBe("non_valutabile");
    expect(senzaBolla.controllo?.scostamento).toBeNull();
    expect(senzaBolla.controllo?.avvertenze).toContain(
      "Bolla non agganciata: il costo calcolato e' solo una simulazione sui dati del vettore, non un controllo."
    );

    const conBolla = await calcolaControlloRiga({ ...riga, dettaglio: {} }, spedizione, undefined, [], contesto);
    expect(conBolla.controllo?.esito).toBe("in_linea");
    expect(conBolla.controllo?.scostamento).toBe(0);
  });
});
