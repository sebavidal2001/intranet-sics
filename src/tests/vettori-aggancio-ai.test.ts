import { describe, expect, it } from "vitest";
import { cifre, numeroSomigliante } from "@/lib/portali/vettori/aggancio-ai";

describe("numeri di bolla scritti dai fornitori", () => {
  it("toglie lettere e zeri davanti", () => {
    expect(cifre("694DTV")).toBe("694");
    expect(cifre("0020147")).toBe("20147");
    expect(cifre("12")).toBeNull();
  });
  it("riconosce prefissi e suffissi del fornitore", () => {
    expect(numeroSomigliante("694DTV", "694")).toBe(true);
    expect(numeroSomigliante("260020147", "20147")).toBe(true);
  });
  it("non confonde numeri diversi (LOXEAL 3066 contro 306, 01/10/2026)", () => {
    expect(numeroSomigliante("3066", "306")).toBe(false);
    expect(numeroSomigliante("V9260069204", "2734")).toBe(false);
  });
});
