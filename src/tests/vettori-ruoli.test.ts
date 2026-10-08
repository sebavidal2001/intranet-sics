import { describe, expect, it } from "vitest";
import { puoGestire, vedeImporti, type VettoriContext } from "@/lib/portali/vettori/ruoli";

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
});
