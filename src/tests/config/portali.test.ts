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

  it("contiene esattamente due chiavi", () => {
    expect(Object.keys(PORTALE_SLUGS)).toHaveLength(2);
  });

  it("i valori sono stringhe non vuote", () => {
    for (const slug of Object.values(PORTALE_SLUGS)) {
      expect(typeof slug).toBe("string");
      expect(slug.length).toBeGreaterThan(0);
    }
  });

  it("i valori corrispondono al tipo PortaleSlug", () => {
    const validSlugs: PortaleSlug[] = ["valutazioni", "preventivatore"];
    for (const slug of Object.values(PORTALE_SLUGS)) {
      expect(validSlugs).toContain(slug);
    }
  });
});
