import { describe, it, expect } from "vitest";
import { PORTALE_SLUGS } from "@/lib/config/portali";
import type { PortaleSlug } from "@/lib/config/portali";

describe("PORTALE_SLUGS", () => {
  it("VALUTAZIONI è uguale a 'valutazioni'", () => {
    expect(PORTALE_SLUGS.VALUTAZIONI).toBe("valutazioni");
  });

  it("PREVENTIVATORE è uguale a 'preventivatore'", () => {
    expect(PORTALE_SLUGS.PREVENTIVATORE).toBe("preventivatore");
  });

  it("VETTORI è uguale a 'vettori'", () => {
    expect(PORTALE_SLUGS.VETTORI).toBe("vettori");
  });

  it("contiene esattamente tre chiavi", () => {
    expect(Object.keys(PORTALE_SLUGS)).toHaveLength(3);
  });

  it("i valori sono stringhe non vuote", () => {
    for (const slug of Object.values(PORTALE_SLUGS)) {
      expect(typeof slug).toBe("string");
      expect(slug.length).toBeGreaterThan(0);
    }
  });

  it("i valori corrispondono al tipo PortaleSlug", () => {
    const validSlugs: PortaleSlug[] = ["valutazioni", "preventivatore", "vettori"];
    for (const slug of Object.values(PORTALE_SLUGS)) {
      expect(validSlugs).toContain(slug);
    }
  });
});
