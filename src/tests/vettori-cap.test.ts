import { describe, expect, it } from "vitest";
import {
  determinaProvincia,
  esitoCapDaRiga,
  normalizzaCap,
} from "@/lib/portali/vettori/cap";

describe("risoluzione CAP", () => {
  it("usa una corrispondenza esatta e certa", () => {
    const esito = esitoCapDaRiga("20121", {
      province: ["MI"],
      comuni: ["Milano"],
      fonte: "anci_istat",
      certo: true,
      estero: false,
    });
    expect(esito).toEqual({
      cap: "20121",
      province: ["MI"],
      comuni: ["Milano"],
      fonte: "anci_istat",
      certo: true,
      estero: false,
    });
    expect(determinaProvincia(esito)).toMatchObject({
      provincia: "MI",
      fonteProvincia: "cap",
      capDaChiarire: null,
    });
  });

  it("un CAP a cavallo resta da chiarire senza provincia manuale", () => {
    const esito = esitoCapDaRiga("12071", {
      province: ["CN", "SV"],
      comuni: ["Bagnasco", "Massimino"],
      fonte: "anci_istat",
      certo: false,
      estero: false,
    });
    expect(determinaProvincia(esito)).toMatchObject({
      provincia: null,
      fonteProvincia: null,
      capDaChiarire: esito,
    });
    expect(determinaProvincia(esito, "sv")).toMatchObject({
      provincia: "SV",
      fonteProvincia: "manuale",
      capDaChiarire: null,
    });
  });

  it("propaga il prefisso come deduzione e non come CAP certo", () => {
    const esito = esitoCapDaRiga("23999", {
      province: ["LC"],
      comuni: [],
      fonte: "prefisso",
      certo: false,
      estero: false,
    });
    expect(determinaProvincia(esito)).toMatchObject({
      provincia: "LC",
      fonteProvincia: "prefisso",
    });
  });

  it("chi spedisce batte il prefisso, perche il prefisso sta indovinando", () => {
    // Il caso reale: 23080 e un CAP di Lecco che il prefisso attribuisce a
    // Sondrio. Se l'operatore scrive LC deve vincere lui, non la deduzione.
    const esito = esitoCapDaRiga("23080", {
      province: ["SO"],
      comuni: [],
      fonte: "prefisso",
      certo: false,
      estero: false,
    });
    expect(determinaProvincia(esito, "LC")).toMatchObject({
      provincia: "LC",
      fonteProvincia: "manuale",
      capDaChiarire: null,
    });
  });

  it("un CAP certo batte una provincia rimasta nel campo da prima", () => {
    const esito = esitoCapDaRiga("20121", {
      province: ["MI"],
      comuni: ["Milano"],
      fonte: "anci_istat",
      certo: true,
      estero: false,
    });
    expect(determinaProvincia(esito, "TO")).toMatchObject({
      provincia: "MI",
      fonteProvincia: "cap",
    });
  });

  it("riconosce San Marino come estero senza assegnargli Rimini", () => {
    const esito = esitoCapDaRiga("47896", {
      province: [],
      comuni: ["Faetano"],
      fonte: "manuale",
      certo: false,
      estero: true,
    });
    expect(determinaProvincia(esito, "RN")).toEqual({
      provincia: null,
      fonteProvincia: null,
      capDaChiarire: null,
      estero: true,
    });
  });

  it("un CAP sconosciuto non viene trasformato in un risultato", () => {
    expect(esitoCapDaRiga("99999", null)).toBeNull();
    expect(determinaProvincia(null)).toMatchObject({
      provincia: null,
      fonteProvincia: null,
      capDaChiarire: null,
    });
  });

  it("normalizza soltanto input numerici", () => {
    expect(normalizzaCap("120")).toBe("00120");
    expect(normalizzaCap("12A45")).toBeNull();
  });
});
