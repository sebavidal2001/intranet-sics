import { describe, expect, it } from "vitest";
import { puoGestire, puoModificareListini, vedeImporti, vedeListini, type VettoriContext } from "@/lib/portali/vettori/ruoli";

const contesto = (ruoli: string[], livello: VettoriContext["livello"] = "viewer"): VettoriContext => ({
  livello,
  ruoli,
});

describe("permessi del portale vettori", () => {
  it("riserva la gestione all'amministrazione", () => {
    expect(puoGestire(contesto(["amministrazione"]))).toBe(true);
    expect(puoGestire(contesto(["direzione"]))).toBe(false);
    expect(puoGestire(contesto(["magazzino", "direzione"]))).toBe(false);
    expect(puoGestire(contesto([], "admin"))).toBe(true);
  });

  it("non restringe la visione importi della direzione", () => {
    expect(vedeImporti(contesto(["direzione"]))).toBe(true);
    expect(vedeImporti(contesto(["magazzino"]))).toBe(false);
  });

  it("i listini li modifica solo chi ha il ruolo listini, non l'admin di portale", () => {
    expect(puoModificareListini(contesto(["listini"]))).toBe(true);
    expect(puoModificareListini(contesto([], "admin"))).toBe(false);
    expect(puoModificareListini(contesto(["amministrazione"], "admin"))).toBe(false);
    expect(puoModificareListini(contesto([], "superadmin"))).toBe(true);
  });

  it("l'amministrazione consulta i listini, il magazzino no", () => {
    expect(vedeListini(contesto([], "admin"))).toBe(true);
    expect(vedeListini(contesto(["listini"]))).toBe(true);
    expect(vedeListini(contesto(["magazzino", "direzione"]))).toBe(false);
    expect(vedeImporti(contesto(["listini"]))).toBe(true);
  });
});
