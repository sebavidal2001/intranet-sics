import { describe, expect, it } from "vitest";
import { oggiRoma } from "@/lib/portali/vettori/oggi-roma";

describe("data di oggi per i listini", () => {
  it("usa anno, mese e giorno di Roma a cavallo della mezzanotte", () => {
    expect(oggiRoma(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(oggiRoma(new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-29");
    expect(oggiRoma(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-25");
  });
});
