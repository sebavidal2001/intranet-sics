import { describe, it, expect } from "vitest";
import {
  haRuoloFunzionale,
  filtroCommercialeFromContext,
  PREVENTIVATORE_RUOLI,
  AGENTE_NESSUNO,
  type PreventivatoreContext,
} from "@/lib/portali/preventivatore/ruoli";
import { escapeIlike } from "@/lib/portali/preventivatore/postgrest";

const ctx = (over: Partial<PreventivatoreContext> = {}): PreventivatoreContext => ({
  livello: "viewer",
  ruoli: [],
  agenteCodice: null,
  ...over,
});

describe("haRuoloFunzionale — chi può fare cosa", () => {
  it("admin e superadmin del portale possono tutto", () => {
    expect(haRuoloFunzionale(ctx({ livello: "admin" }), [PREVENTIVATORE_RUOLI.back_office])).toBe(true);
    expect(haRuoloFunzionale(ctx({ livello: "superadmin" }), [PREVENTIVATORE_RUOLI.preventivatore])).toBe(true);
  });

  it("un viewer con il ruolo funzionale giusto è autorizzato", () => {
    const jessica = ctx({ livello: "viewer", ruoli: [PREVENTIVATORE_RUOLI.back_office] });
    expect(haRuoloFunzionale(jessica, [PREVENTIVATORE_RUOLI.back_office])).toBe(true);
  });

  it("un viewer con il ruolo sbagliato NON è autorizzato", () => {
    // Il back office non deve poter marcare un preventivo come completato,
    // né il preventivatore inviare l'offerta al cliente.
    const jessica = ctx({ livello: "viewer", ruoli: [PREVENTIVATORE_RUOLI.back_office] });
    expect(haRuoloFunzionale(jessica, [PREVENTIVATORE_RUOLI.preventivatore])).toBe(false);

    const gregor = ctx({ livello: "viewer", ruoli: [PREVENTIVATORE_RUOLI.preventivatore] });
    expect(haRuoloFunzionale(gregor, [PREVENTIVATORE_RUOLI.back_office])).toBe(false);
  });

  it("un utente senza ruoli funzionali non è autorizzato a nulla", () => {
    expect(haRuoloFunzionale(ctx(), [PREVENTIVATORE_RUOLI.preventivatore])).toBe(false);
  });
});

describe("filtroCommercialeFromContext — fail-closed", () => {
  it("admin vede tutto (nessun filtro)", () => {
    expect(filtroCommercialeFromContext(ctx({ livello: "admin", ruoli: ["commerciale"] }))).toBeNull();
  });

  it("il commerciale con codice è ristretto al suo codice", () => {
    const valeria = ctx({ ruoli: [PREVENTIVATORE_RUOLI.commerciale], agenteCodice: "AG000010" });
    expect(filtroCommercialeFromContext(valeria)).toBe("AG000010");
  });

  it("il commerciale SENZA codice non vede nulla, non vede tutto", () => {
    // Regressione: prima ritornava null (= nessun filtro = archivio intero).
    const nonConfigurato = ctx({ ruoli: [PREVENTIVATORE_RUOLI.commerciale], agenteCodice: null });
    expect(filtroCommercialeFromContext(nonConfigurato)).toBe(AGENTE_NESSUNO);
  });

  it("preventivatore e back office non sono ristretti", () => {
    expect(filtroCommercialeFromContext(ctx({ ruoli: [PREVENTIVATORE_RUOLI.preventivatore] }))).toBeNull();
    expect(filtroCommercialeFromContext(ctx({ ruoli: [PREVENTIVATORE_RUOLI.back_office] }))).toBeNull();
  });

  it("chi è commerciale MA anche preventivatore vede tutto", () => {
    const misto = ctx({
      ruoli: [PREVENTIVATORE_RUOLI.commerciale, PREVENTIVATORE_RUOLI.preventivatore],
      agenteCodice: "AG000010",
    });
    expect(filtroCommercialeFromContext(misto)).toBeNull();
  });
});

describe("escapeIlike — filtri PostgREST", () => {
  it("scappa i metacaratteri LIKE", () => {
    expect(escapeIlike("100%")).toBe("100\\%");
    expect(escapeIlike("a_b")).toBe("a\\_b");
  });

  it("scappa virgola e parentesi, che rompono la sintassi or=(...)", () => {
    expect(escapeIlike("IMA spa (div. SAFE)")).toBe("IMA spa \\(div. SAFE\\)");
    expect(escapeIlike("a,b")).toBe("a\\,b");
  });

  it("lascia intatto il testo normale", () => {
    expect(escapeIlike("ALPHAMAC srl")).toBe("ALPHAMAC srl");
  });
});
