import { describe, it, expect } from "vitest";
import { formattaNomeCliente } from "@/lib/portali/preventivatore/testo";

// Casi presi dall'anagrafica reale (preventivatore.clienti_master).
describe("formattaNomeCliente (ragioni sociali MAIUSCOLE → leggibili)", () => {
  it("mette l'iniziale maiuscola e il resto minuscolo", () => {
    expect(formattaNomeCliente("ALPHAMAC srl")).toBe("Alphamac srl");
    expect(formattaNomeCliente("TREBBI IDROIMPIANTI srl")).toBe("Trebbi Idroimpianti srl");
  });

  it("preserva le sigle corte, che sono acronimi", () => {
    expect(formattaNomeCliente("IMA spa")).toBe("IMA spa");
    expect(formattaNomeCliente("BM SYNTHESIS srl")).toBe("BM Synthesis srl");
  });

  it("preserva le sigle puntate e i token con cifre", () => {
    expect(formattaNomeCliente("S.G.E. srl")).toBe("S.G.E. srl");
    expect(formattaNomeCliente("3F FILIPPI spa")).toBe("3F Filippi spa");
  });

  it("preserva gli acronimi lunghi senza vocali", () => {
    expect(formattaNomeCliente("SGR SERVIZI spa")).toBe("SGR Servizi spa");
  });

  it("non tocca ciò che è già scritto in minuscolo o misto", () => {
    expect(formattaNomeCliente("ALPI spa a socio unico")).toBe("Alpi spa a socio unico");
    expect(formattaNomeCliente("CAVIRO soc.coop.agricola")).toBe("Caviro soc.coop.agricola");
  });

  it("tiene minuscole le congiunzioni", () => {
    expect(formattaNomeCliente("ALLESTIMENTI E PUBBLICITA'")).toBe("Allestimenti e Pubblicita'");
  });

  it("gestisce valori vuoti", () => {
    expect(formattaNomeCliente("")).toBe("");
    expect(formattaNomeCliente(null)).toBe("");
    expect(formattaNomeCliente(undefined)).toBe("");
  });
});
