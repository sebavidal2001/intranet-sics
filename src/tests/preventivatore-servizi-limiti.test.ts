import { describe, expect, it } from "vitest";
import { LIMITI_SERVIZIO, ServizioConfigurazioneSchema, ServizioSchema } from "@/lib/portali/preventivatore/documenti-schema";

describe("limiti condivisi dei servizi", () => {
  it("accetta nell'anagrafica gli stessi valori ammessi dal documento", () => {
    const servizio = {
      nome: "L".repeat(LIMITI_SERVIZIO.nome),
      categoria: "C".repeat(LIMITI_SERVIZIO.categoria),
      tariffa_ora: LIMITI_SERVIZIO.tariffaOra,
    };
    expect(ServizioConfigurazioneSchema.safeParse(servizio).success).toBe(true);
    expect(ServizioSchema.safeParse({ ...servizio, ore: 1, coeff_ricarico: 0.7 }).success).toBe(true);
  });

  it("rifiuta nome vuoto, campi troppo lunghi e tariffa oltre il massimo", () => {
    expect(ServizioConfigurazioneSchema.safeParse({ nome: "", categoria: "", tariffa_ora: 1 }).success).toBe(false);
    expect(ServizioConfigurazioneSchema.safeParse({ nome: "x".repeat(121), categoria: "", tariffa_ora: 1 }).success).toBe(false);
    expect(ServizioConfigurazioneSchema.safeParse({ nome: "ok", categoria: "x".repeat(81), tariffa_ora: 1 }).success).toBe(false);
    expect(ServizioConfigurazioneSchema.safeParse({ nome: "ok", categoria: "", tariffa_ora: 1_001 }).success).toBe(false);
  });
});
