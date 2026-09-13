import { describe, expect, it } from "vitest";
import {
  pianificaFusioneCampi,
  risolviVettoreGestionale,
} from "@/lib/portali/vettori/bolle";
import type { CodiceGestionaleVettore } from "@/lib/portali/vettori/bolle";

const attuali = {
  direzione: "entrata",
  numero_riferimento: "BF-001",
  data_documento: "2026-09-12",
  controparte_nome: "Nome manuale",
  vettore_id: "00000000-0000-4000-8000-000000000001",
  colli_bolla: 2,
  peso_bolla: 20,
} as const;

const gestionali = {
  ...attuali,
  controparte_nome: "Nome gestionale",
  colli_bolla: 3,
  peso_bolla: 22,
};

describe("fusione delle bolle gestionali", () => {
  it("risolve i codici gestionali conservando assegnazioni, regole e casi da classificare", () => {
    const glsId = "00000000-0000-4000-8000-000000000010";
    const codici = new Map<string, CodiceGestionaleVettore>([
      ["VT000015", {
        codiceGestionale: "VT000015",
        ragioneSociale: "GLS ENTERPRISE srl",
        vettoreId: glsId,
        tipo: "vettore",
        regolaTesto: null,
      }],
      ["VT010015", {
        codiceGestionale: "VT010015",
        ragioneSociale: "GLS fino a 30 Kg-FEDEX oltre",
        vettoreId: null,
        tipo: "regola",
        regolaTesto: "GLS fino a 30 kg, FedEx oltre",
      }],
      ["VT000099", {
        codiceGestionale: "VT000099",
        ragioneSociale: "Vettore del cliente",
        vettoreId: null,
        tipo: "non_nostro",
        regolaTesto: null,
      }],
      ["VT000013", {
        codiceGestionale: "VT000013",
        ragioneSociale: "BRT spa",
        vettoreId: null,
        tipo: "da_mappare",
        regolaTesto: null,
      }],
    ]);

    expect(risolviVettoreGestionale(" vt000015 ", codici)).toMatchObject({
      codiceGestionale: "VT000015",
      vettoreId: glsId,
      esito: "assegnato",
    });
    expect(risolviVettoreGestionale("VT010015", codici)).toMatchObject({
      vettoreId: null,
      esito: "regola",
      regola: "GLS fino a 30 kg, FedEx oltre",
    });
    expect(risolviVettoreGestionale("VT000099", codici).esito).toBe("esterno");
    expect(risolviVettoreGestionale("VT000013", codici)).toMatchObject({
      esito: "da_classificare",
      ragioneSociale: "BRT spa",
    });
    expect(risolviVettoreGestionale("VT999999", codici).esito).toBe("da_classificare");
    expect(risolviVettoreGestionale(null, codici).esito).toBe("assente");
  });

  it("sostituisce i campi gestionali ma conserva quelli forzati", () => {
    const piano = pianificaFusioneCampi(
      attuali,
      gestionali,
      {
        controparte_nome: {
          valorePrecedente: "Nome gestionale precedente",
          forzatoDa: "00000000-0000-4000-8000-000000000099",
          forzatoIl: "2026-09-12T10:00:00Z",
        },
      },
      false
    );

    expect(piano.aggiornamenti.controparte_nome).toBeUndefined();
    expect(piano.aggiornamenti.colli_bolla).toBe(3);
    expect(piano.aggiornamenti.peso_bolla).toBe(22);
  });

  it("su una spedizione congelata non aggiorna nulla e descrive le differenze", () => {
    const piano = pianificaFusioneCampi(attuali, gestionali, {}, true);
    expect(piano.aggiornamenti).toEqual({});
    expect(piano.differenze).toMatchObject({
      controparte_nome: { spedizione: "Nome manuale", gestionale: "Nome gestionale" },
      colli_bolla: { spedizione: 2, gestionale: 3 },
      peso_bolla: { spedizione: 20, gestionale: 22 },
    });
  });
});
