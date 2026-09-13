import { describe, expect, it } from "vitest";
import { estraiNumeri, verificaNumeri } from "@/lib/prototipo-bi/verifica-numeri";

describe("estraiNumeri", () => {
  it.each([
    ["2.848.148", 2_848_148],
    ["2.848.148 €", 2_848_148],
    ["€ 2.848.148", 2_848_148],
    ["6.632.748,50", 6_632_748.5],
    ["35,4%", 35.4],
    ["35,4 %", 35.4],
    ["1,2 M", 1_200_000],
    ["1,2 milioni", 1_200_000],
    ["2,4 mln", 2_400_000],
    ["42", 42],
    ["6675", 6675],
    ["1.234", 1234],
  ])("normalizza il formato italiano %s", (testo, valore) => {
    expect(estraiNumeri(`Il valore è ${testo}.`)).toEqual([
      expect.objectContaining({ testo, valore }),
    ]);
  });

  it("mantiene la posizione iniziale, incluso il simbolo euro prefisso", () => {
    expect(estraiNumeri("Totale: € 2.848.148")[0]?.posizione).toBe(8);
  });

  it.each(["nel 2026", "il 12/09/2026", "versione v2"])(
    "non estrae riferimenti non quantitativi: %s",
    (testo) => {
      expect(estraiNumeri(testo)).toEqual([]);
    }
  );
});

describe("verificaNumeri", () => {
  it("marca come non verificato un numero inventato", () => {
    const esito = verificaNumeri("Il totale è 999 €.", [
      { valore: 500, fonte: "totale ordinato" },
    ]);

    expect(esito.nonVerificati).toBe(1);
    expect(esito.numeri[0]).toMatchObject({ valore: 999, verificato: false });
  });

  it("accetta un arrotondamento entro lo 0,5%", () => {
    const esito = verificaNumeri("Il totale è 2,8 M.", [
      { valore: 2_848_148, fonte: "totale ordinato" },
    ]);

    expect(esito.nonVerificati).toBe(0);
    expect(esito.numeri[0]).toMatchObject({
      valore: 2_800_000,
      verificato: true,
      fonte: "totale ordinato",
    });
  });

  it("accetta una percentuale derivata dal rapporto fra due noti", () => {
    const esito = verificaNumeri("La quota è 35,4%.", [
      { valore: 354, fonte: "ordinato cliente" },
      { valore: 1000, fonte: "ordinato totale" },
    ]);

    expect(esito.nonVerificati).toBe(0);
    expect(esito.numeri[0]?.fonte).toBe(
      "rapporto fra ordinato cliente e ordinato totale"
    );
  });

  it("NON accetta una percentuale che somiglia a un importo o a un conteggio", () => {
    // Il caso reale: l'analista chiede "numero di ordini per agente" e fra i
    // valori noti finisce 35 (ordini di un agente). Poi scrive "la conversione
    // è al 35,4%" — una percentuale che nessuno ha calcolato. Confrontandola
    // con i noti di qualunque unità, 35 dista 0,4 e la tolleranza a mezzo
    // punto la promuove: il controllo direbbe "verificato" su una cifra
    // inventata. Con centinaia di righe fra i noti il caso non è raro, è la
    // norma — ed è proprio sulle percentuali che le affermazioni sbagliate
    // fanno più danno.
    const esito = verificaNumeri("La conversione è al 35,4%.", [
      { valore: 35, fonte: "n_ordini per Valeria", unita: "numero" },
      { valore: 2_848_148, fonte: "totale di ordinato", unita: "euro" },
    ]);

    expect(esito.nonVerificati).toBe(1);
  });

  it("accetta una percentuale confrontata con una metrica percentuale", () => {
    const esito = verificaNumeri("Il tasso è 35,4%.", [
      { valore: 35.2, fonte: "tasso_conversione", unita: "percentuale" },
    ]);

    expect(esito.nonVerificati).toBe(0);
  });

  it("accetta lo scostamento derivato dalla differenza fra due noti", () => {
    const esito = verificaNumeri("Lo scostamento è -200 €.", [
      { valore: 800, fonte: "periodo corrente" },
      { valore: 1000, fonte: "periodo precedente" },
    ]);

    expect(esito.nonVerificati).toBe(0);
  });
});
