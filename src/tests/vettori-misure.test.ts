import { describe, expect, it } from "vitest";
import {
  datiFisici,
  divisoreVolumetricoBolla,
  MisureFattura,
  riepilogoMisureBolla,
} from "@/lib/portali/vettori/misure";
import { pesoVolumetrico, calcolaCostoAtteso } from "@/lib/portali/vettori/calcolo";
import type { RigaFattura } from "@/lib/portali/vettori/fatture/tipi";
import type { Rilevazione } from "@/lib/portali/vettori/letture";
import type { ListinoRisolto } from "@/lib/portali/vettori/tipi";
const riga: RigaFattura = { numero: 1, data: "2026-07-02", numeroSpedizione: "1", riferimento: "123", controparte: "FORNITORE SRL", direzione: "entrata", colli: 1, peso: 3, pesoVolumetrico: null, pesoTassato: null, nolo: 8, supplementi: 0, carburante: 1, totale: 9, dettaglio: {} };
const rilevata: Rilevazione = { id: "a", spedizione_id: null, fornitore_testo: "FORNITORE", numero_bolla: "123", data_arrivo: "2026-07-03", colli: 2, peso_kg: 8, lunghezza_cm: 50, larghezza_cm: 30, altezza_cm: 30, condizioni: [], note: null, rilevata_il: "2026-07-03", rilevata_da: "u" };
describe("volume degli Excel collegato al controllo", () => {
  it("mantiene le condizioni di magazzino e permette di correggerle anche sugli invii", () => {
    const magazzino = { ...rilevata, condizioni: ["non_sovrapponibile"] };
    expect(datiFisici(riga, null, { riga: 1, pesoKg: 12 }, [magazzino], 300).dati.condizioni).toContain("non_sovrapponibile");
    expect(datiFisici(riga, null, { riga: 1, condizioni: [] }, [magazzino], 300).dati.condizioni).toEqual([]);
    expect(datiFisici({ ...riga, direzione: "uscita" }, null, { riga: 1, condizioni: ["triangolazione", "etichetta_manuale"] }, [], 300).dati.condizioni).toEqual(["triangolazione", "etichetta_manuale"]);
  });
  it("riproduce GLS I16: 50×30×30×3/10000 = 13,5 kg", () => expect(pesoVolumetrico({ colli: 1, pesoReale: 2, lunghezzaCm: 50, larghezzaCm: 30, altezzaCm: 30 }, 300)).toBeCloseTo(13.5));
  it("somma colli uguali e diversi senza moltiplicare il volume totale due volte", () => {
    expect(pesoVolumetrico({ colli: 2, pesoReale: 8, lunghezzaCm: 50, larghezzaCm: 30, altezzaCm: 30 }, 300)).toBeCloseTo(27);
    expect(pesoVolumetrico({ colli: 3, pesoReale: 8, misureColli: [{ quantita: 2, lunghezzaCm: 50, larghezzaCm: 30, altezzaCm: 30 }, { quantita: 1, lunghezzaCm: 100, larghezzaCm: 50, altezzaCm: 20 }] }, 300)).toBeCloseTo(57);
    expect(pesoVolumetrico({ colli: 3, pesoReale: 8, volumeMc: .1 }, 250)).toBe(25);
  });
  it("usa le misure di magazzino per l'arrivo corrispondente", () => {
    const f = datiFisici(riga, null, undefined, [rilevata], 300);
    expect(f.fonte).toBe("Misure di magazzino"); expect(f.dati.pesoReale).toBe(8); expect(pesoVolumetrico(f.dati, 300)).toBeCloseTo(27);
  });
  it("non usa rilievi di altri fornitori, ambigui o per gli invii", () => {
    expect(datiFisici(riga, null, undefined, [{ ...rilevata, fornitore_testo: "DIVERSO" }], 300).fonte).toBe("Misure mancanti");
    expect(datiFisici(riga, null, undefined, [rilevata, { ...rilevata, id: "b" }], 300).note.join()).toContain("Più rilevazioni");
    expect(datiFisici({ ...riga, direzione: "uscita" }, null, undefined, [rilevata], 300).fonte).toBe("Misure mancanti");
  });
  it("le misure manuali hanno precedenza sui dati del vettore e del magazzino", () => {
    const f = datiFisici({ ...riga, pesoVolumetrico: 90 }, null, { riga: 1, volumeMc: .2 }, [rilevata], 300);
    expect(f.dati.misureColli).toBeUndefined(); expect(pesoVolumetrico(f.dati, 300)).toBe(60);
  });
  it("rifiuta misure incomplete, duplicate e fonti incompatibili", () => {
    expect(MisureFattura.safeParse([{ riga: 1, colli: [{ quantita: 1, lunghezzaCm: 50 }] }]).success).toBe(false);
    expect(MisureFattura.safeParse([{ riga: 1 }, { riga: 1 }]).success).toBe(false);
    expect(MisureFattura.safeParse([{ riga: 1, volumeMc: .1, colli: [{ quantita: 1, lunghezzaCm: 50, larghezzaCm: 30, altezzaCm: 30 }] }]).success).toBe(false);
  });
  it("Trading Post non sovrapponibile usa l'altezza tariffaria di 180 cm", () => {
    const listino: ListinoRisolto = { vettore: { id: "tp", codice: "trading_post", nome: "TP", modelloTariffa: "quintale", divisoreVolumetrico: 300, pesoMinimoTassabile: 3, arrotondamentoKg: 100, arrotondamentoDaKg: 100 }, zonaCodice: "IT", fasce: [{ pesoDa: 0, pesoA: null, importo: 22.5, tipo: "quintale", scattoKg: null, scattoImporto: null }], supplementi: [], adeguamento: null, carburante: 0 };
    const c = calcolaCostoAtteso({ colli: 1, pesoReale: 10, lunghezzaCm: 120, larghezzaCm: 80, altezzaCm: 50, condizioni: ["non_sovrapponibile"] }, listino);
    expect(c.pesoVolumetrico).toBeCloseTo(518.4); expect(c.pesoTassabile).toBe(600);
  });
  it("calcola in tempo reale i gruppi omogenei con il coefficiente del vettore", () => {
    const vettori = [
      { codice: "gls", nome: "GLS", divisoreVolumetrico: 300 },
      { codice: "tnt", nome: "TNT", divisoreVolumetrico: 250 },
      { codice: "fedex", nome: "FedEx", divisoreVolumetrico: 250 },
      { codice: "trading_post", nome: "Trading Post", divisoreVolumetrico: 300 },
    ];
    const gruppi = [
      { quantita: 2, lunghezzaCm: 50, larghezzaCm: 30, altezzaCm: 30 },
      { quantita: 1, lunghezzaCm: 100, larghezzaCm: 50, altezzaCm: 20 },
    ];
    expect(divisoreVolumetricoBolla("GLS", null, vettori)).toBe(300);
    expect(divisoreVolumetricoBolla(null, "TNT/FedEx Italia", vettori)).toBe(250);
    expect(divisoreVolumetricoBolla(null, "GLS fino a 30 kg - FedEx oltre", vettori)).toBeNull();
    expect(riepilogoMisureBolla(gruppi, 300, null)).toEqual({
      volumeM3: 0.19,
      pesoVolumetricoKg: 57,
      usaVolumeGestionale: false,
    });
  });
  it("dà precedenza al volume già presente nel gestionale", () => {
    const riepilogo = riepilogoMisureBolla(
      [{ quantita: 1, lunghezzaCm: 10, larghezzaCm: 10, altezzaCm: 10 }],
      250,
      0.4
    );
    expect(riepilogo).toEqual({
      volumeM3: 0.4,
      pesoVolumetricoKg: 100,
      usaVolumeGestionale: true,
    });
  });
});
