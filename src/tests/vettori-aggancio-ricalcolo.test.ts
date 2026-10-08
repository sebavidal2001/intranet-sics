import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, ricalcolaFattura } = vi.hoisted(() => ({
  rpc: vi.fn(),
  ricalcolaFattura: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ schema: () => ({ rpc }) }),
}));
vi.mock("@/lib/portali/vettori/ricalcolo", () => ({ ricalcolaFattura }));

import {
  applicaAggancio,
  ricalcolaDopoAggancio,
  sganciaAggancio,
} from "@/lib/portali/vettori/aggancio-ai";

const fatturaId = "11111111-1111-4111-8111-111111111111";

describe("aggancio e ricalcolo distinti", () => {
  beforeEach(() => {
    rpc.mockReset();
    ricalcolaFattura.mockReset();
    ricalcolaFattura.mockRejectedValue(new Error("Motore non disponibile"));
  });

  it("se il ricalcolo fallisce, segnala che la bolla è stata agganciata", async () => {
    rpc.mockResolvedValue({ data: { fattura_id: fatturaId }, error: null });
    const esito = await applicaAggancio("riga", "bolla", "utente");
    expect(esito).toEqual({
      ok: true,
      ricalcolo: "fallito",
      fatturaId,
      messaggio: "Motore non disponibile",
    });
    expect(rpc).toHaveBeenCalledWith("applica_aggancio", {
      p_riga: "riga",
      p_spedizione: "bolla",
      p_utente: "utente",
    });
    expect(ricalcolaFattura).toHaveBeenCalledWith(fatturaId, { scrivi: true });
  });

  it("se il ricalcolo fallisce dopo lo sgancio, conserva l'esito dello sgancio", async () => {
    rpc.mockResolvedValue({ data: { fattura_id: fatturaId, bolla_scongelata: true }, error: null });
    expect(await sganciaAggancio("riga", "utente", "Bolla sbagliata")).toMatchObject({
      ok: true,
      ricalcolo: "fallito",
      fatturaId,
      bollaScongelata: true,
    });
  });

  it("il tentativo manuale può completare il ricalcolo", async () => {
    ricalcolaFattura.mockResolvedValue({ });
    expect(await ricalcolaDopoAggancio(fatturaId)).toEqual({
      ok: true,
      ricalcolo: "riuscito",
      fatturaId,
    });
  });
});
