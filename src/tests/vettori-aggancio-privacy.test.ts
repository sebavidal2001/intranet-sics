import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ schema: () => ({}) }),
}));
vi.mock("@/lib/portali/vettori/ricalcolo", () => ({ ricalcolaFattura: vi.fn() }));

import { istruzioni, type Candidata, type RigaDaAgganciare } from "@/lib/portali/vettori/aggancio-ai";

const riga: RigaDaAgganciare = {
  controlloId: "controllo-segreto-1",
  rigaId: "riga-segreta-1",
  vettore: "GLS",
  fattura: "FT-RISERVATA-7788",
  rigaNumero: 12,
  data: "2026-09-10",
  direzione: "entrata",
  riferimento: "694DTV",
  controparte: "NCR BIOCHEMIC",
  provincia: "MI",
  colli: 2,
  peso: 14.5,
  pesoTassato: 15,
  totale: 123.45,
};

const candidata: Candidata = {
  etichetta: "C1",
  spedizioneId: "spedizione-segreta-1",
  numero: "694",
  protocollo: "PROT-INTERNO-4242",
  data: "2026-09-09",
  controparte: "N.C.R. BIOCHEMICAL SRL",
  localita: "Milano",
  provincia: "MI",
  colli: 2,
  peso: 14,
  vettore: "GLS",
  profilo: "BF-PROFILO-X",
  origine: "origine-interna-z",
  giaAgganciataA: 0,
  indizi: ["stesso numero", "nome compatibile"],
};

describe("aggancio AI: cosa esce verso il servizio esterno", () => {
  const testo = istruzioni(riga, [candidata]);

  it("contiene quanto dichiarato all'amministrazione: nomi, localita', date, numeri di bolla, colli e pesi", () => {
    for (const atteso of ["NCR BIOCHEMIC", "N.C.R. BIOCHEMICAL SRL", "Milano", "2026-09-10", "2026-09-09", "694DTV", "14.5", "GLS"]) {
      expect(testo).toContain(atteso);
    }
  });

  it("non contiene numero di fattura, importi, protocolli interni, profili, origini o identificativi", () => {
    for (const vietato of [
      "FT-RISERVATA-7788",
      "123.45",
      "123,45",
      "PROT-INTERNO-4242",
      "BF-PROFILO-X",
      "origine-interna-z",
      "controllo-segreto-1",
      "riga-segreta-1",
      "spedizione-segreta-1",
    ]) {
      expect(testo).not.toContain(vietato);
    }
  });
});
