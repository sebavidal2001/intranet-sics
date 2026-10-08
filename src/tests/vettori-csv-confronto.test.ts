import { describe, expect, it } from "vitest";
import { generaCsvConfronto, type RigaConfrontoCsv } from "@/lib/portali/vettori/csv-confronto";

describe("CSV del confronto fattura", () => {
  it("esporta ogni riga, usa punto e virgola, BOM e decimali italiani, poi riepiloga", () => {
    const righe: RigaConfrontoCsv[] = [{
      riga_numero: 1,
      data: "2026-10-01",
      riferimento: "B;12",
      numero_spedizione: "AWB-1",
      controparte: "CLIENTE SPA",
      direzione: "uscita",
      peso: 10.5,
      peso_tassato: 12,
      nolo: 10.25,
      supplementi: 1.5,
      carburante: 2.25,
      totale: 14,
      abbinamento: "numero",
      motivo_abbinamento: "Numero e controparte coincidono.",
      controllo: { peso_reale: 10.5, peso_tassabile: 12, atteso_totale: 12.5, esito: "da_verificare" },
    }];

    const csv = generaCsvConfronto(righe, {
      spedizioni: 1,
      peso: 10.5,
      nolo: 10.25,
      supplementi: 1.5,
      carburante: 2.25,
      totaleDocumento: 14,
    });

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("N.;Data;Bolla/riferimento;Numero spedizione/AWB");
    expect(csv).toContain('"B;12"');
    expect(csv).toContain("10,500;12,000;10,25;1,50;2,25;14,00;12,50;1,50;Da verificare");
    expect(csv).toContain("Totali delle righe;1");
    expect(csv).toContain("Totali dichiarati in fattura;1");
  });
});
