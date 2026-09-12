import { describe, expect, it } from "vitest";
import { pianificaFusioneCampi } from "@/lib/portali/vettori/bolle";

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
