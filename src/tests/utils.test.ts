import { describe, it, expect } from "vitest";
import { calcolaDelta, formatData } from "@/lib/utils";

describe("calcolaDelta", () => {
  it("restituisce numero positivo quando attuale > precedente", () => {
    const result = calcolaDelta(80, 70);
    expect(result).toBeGreaterThan(0);
  });

  it("restituisce numero negativo quando attuale < precedente", () => {
    const result = calcolaDelta(70, 80);
    expect(result).toBeLessThan(0);
  });

  it("restituisce 0 quando precedente è 0 (divisione per zero)", () => {
    const result = calcolaDelta(80, 0);
    expect(result).toBe(0);
  });

  it("restituisce 0 quando attuale === precedente", () => {
    const result = calcolaDelta(50, 50);
    expect(result).toBe(0);
  });

  it("calcola correttamente la percentuale: +100% quando attuale è doppio", () => {
    const result = calcolaDelta(100, 50);
    expect(result).toBe(100);
  });

  it("calcola correttamente la percentuale: -50% quando attuale è metà", () => {
    const result = calcolaDelta(50, 100);
    expect(result).toBe(-50);
  });

  it("arrotonda al numero intero più vicino", () => {
    // (15 - 14) / 14 * 100 = 7.142... → arrotondato a 7
    const result = calcolaDelta(15, 14);
    expect(result).toBe(7);
  });
});

describe("formatData", () => {
  it("formatta una stringa data ISO nel formato italiano gg/mm/aaaa", () => {
    const result = formatData("2024-01-15");
    // formato italiano: 15/01/2024
    expect(result).toMatch(/15\/01\/2024/);
  });

  it("formatta un oggetto Date nel formato italiano", () => {
    const date = new Date("2024-06-30");
    const result = formatData(date);
    expect(result).toMatch(/30\/06\/2024/);
  });

  it("restituisce una stringa (tipo string)", () => {
    const result = formatData("2024-01-15");
    expect(typeof result).toBe("string");
  });

  it("gestisce date di fine anno", () => {
    const result = formatData("2024-12-31");
    expect(result).toMatch(/31\/12\/2024/);
  });

  it("gestisce date di inizio anno", () => {
    const result = formatData("2024-01-01");
    expect(result).toMatch(/01\/01\/2024/);
  });
});
