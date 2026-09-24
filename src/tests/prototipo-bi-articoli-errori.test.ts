import { describe, expect, it } from "vitest";
import { descriviErrore } from "@/lib/prototipo-bi/articoli";

describe("descriviErrore", () => {
  it("un errore con messaggio vuoto dice almeno lo stato HTTP", () => {
    expect(descriviErrore({ message: "" }, 503)).toBe("HTTP 503");
  });

  it("compone messaggio, codice e dettagli quando ci sono", () => {
    expect(descriviErrore({ message: "canceling statement", code: "57014", details: null }, 500)).toBe(
      "canceling statement · 57014 · HTTP 500"
    );
  });

  it("senza niente non restituisce una stringa vuota", () => {
    expect(descriviErrore(null)).toBe("errore senza descrizione");
  });
});
