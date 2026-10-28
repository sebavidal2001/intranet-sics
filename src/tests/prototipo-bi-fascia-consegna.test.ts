import { describe, expect, it } from "vitest";
import { DIMENSIONI, fasciaConsegna } from "@/lib/prototipo-bi/semantico";
import { dimensioniPerMetrica } from "@/lib/prototipo-bi/tassonomia";

describe("fascia_consegna: dove cade la consegna confermata rispetto a oggi", () => {
  const oggi = "2026-10-28";

  it("separa ritardo, prossimi 7 giorni, 30 giorni e oltre", () => {
    expect(fasciaConsegna("2026-10-27", oggi)).toBe("1 - In ritardo");
    expect(fasciaConsegna("2026-10-28", oggi)).toBe("2 - Entro 7 giorni");
    expect(fasciaConsegna("2026-11-04", oggi)).toBe("2 - Entro 7 giorni");
    expect(fasciaConsegna("2026-11-05", oggi)).toBe("3 - Entro 30 giorni");
    expect(fasciaConsegna("2026-11-27", oggi)).toBe("3 - Entro 30 giorni");
    expect(fasciaConsegna("2026-11-28", oggi)).toBe("4 - Oltre 30 giorni");
  });

  it("i confini seguono il calendario, anche a cavallo d'anno", () => {
    expect(fasciaConsegna("2027-01-06", "2026-12-30")).toBe("2 - Entro 7 giorni");
    expect(fasciaConsegna("2027-01-29", "2026-12-30")).toBe("3 - Entro 30 giorni");
    expect(fasciaConsegna("2027-01-30", "2026-12-30")).toBe("4 - Oltre 30 giorni");
  });

  it("senza data confermata e' una fascia a parte, l'ultima", () => {
    expect(fasciaConsegna(undefined, oggi)).toBe("5 - Senza data confermata");
    expect(fasciaConsegna("", oggi)).toBe("5 - Senza data confermata");
  });

  it("le etichette si ordinano per urgenza", () => {
    const fasce = [
      fasciaConsegna(undefined, oggi),
      fasciaConsegna("2026-12-01", oggi),
      fasciaConsegna("2026-10-01", oggi),
      fasciaConsegna("2026-10-30", oggi),
    ];
    expect([...fasce].sort()[0]).toBe("1 - In ritardo");
    expect([...fasce].sort().at(-1)).toBe("5 - Senza data confermata");
  });

  it("e' una dimensione del solo portafoglio", () => {
    expect(dimensioniPerMetrica("portafoglio")).toContain("fascia_consegna");
    expect(dimensioniPerMetrica("ordinato")).not.toContain("fascia_consegna");
    expect(dimensioniPerMetrica("fatturato")).not.toContain("fascia_consegna");
    expect(DIMENSIONI.fascia_consegna.etichetta).toBe("Scadenza consegna");
  });
});
