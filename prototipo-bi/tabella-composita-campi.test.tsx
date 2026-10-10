/**
 * LA TABELLA CON PIU' VALORI E PIU' CAMPI.
 *
 * Una riga per ogni combinazione di campi, una colonna per ogni campo e per ogni
 * valore. Il difetto che questo test inchioda: con due campi e due valori le
 * righe si identificavano per il solo primo campo, e due agenti dello stesso
 * cliente finivano sulla stessa riga, con i numeri uno sull'altro.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { GraficoDaAnalisi } from "@/components/prototipo-bi/grafico-da-risultato";
import type { ChiaveMetrica, Dimensione, RisultatoQuery, SerieAnalisiEseguita, SpecQuery } from "@/lib/prototipo-bi/tipi";

type RigaFinta = { chiavi: Record<string, string>; valore: number };

function risultato(spec: SpecQuery, righe: RigaFinta[], unita: "euro" | "numero" = "euro"): RisultatoQuery {
  return {
    spec,
    metrica: spec.metrica,
    unita,
    righe: righe.map((r) => ({
      etichetta: Object.values(r.chiavi).join(" · "),
      chiavi: r.chiavi,
      valore: r.valore,
      conteggio: 1,
    })),
    totale: righe.reduce((s, r) => s + r.valore, 0),
    certificata: true,
    avvisi: [],
  };
}

function serie(
  metrica: ChiaveMetrica,
  nome: string,
  raggruppa: Dimensione[],
  righe: RigaFinta[],
  ruolo: "principale" | "confronto" = "confronto",
  unita: "euro" | "numero" = "euro",
  extra: Partial<SpecQuery> = {}
): SerieAnalisiEseguita {
  const spec: SpecQuery = { metrica, raggruppa, ...extra };
  return { ruolo, nome, spec, risultato: risultato(spec, righe, unita) };
}

afterEach(cleanup);

describe("due campi, due valori", () => {
  const righe = (v: number[]): RigaFinta[] => [
    { chiavi: { cliente: "ACME", agente: "Anna" }, valore: v[0] },
    { chiavi: { cliente: "ACME", agente: "Bruno" }, valore: v[1] },
    { chiavi: { cliente: "BETA", agente: "Anna" }, valore: v[2] },
  ];
  const insieme = [
    serie("ordinato", "Ordinato", ["cliente", "agente"], righe([100, 200, 300]), "principale"),
    serie("n_ordini", "Numero ordini", ["cliente", "agente"], righe([1, 2, 3]), "confronto", "numero"),
  ];

  it("una riga per ogni combinazione, non una per cliente", () => {
    render(<GraficoDaAnalisi serie={insieme} tipo="tabella" />);
    const tabella = screen.getByRole("table");
    // intestazione + tre combinazioni + totali
    expect(within(tabella).getAllByRole("row")).toHaveLength(1 + 3 + 1);
  });

  it("una colonna per campo e una per valore, con i numeri al posto giusto", () => {
    render(<GraficoDaAnalisi serie={insieme} tipo="tabella" />);
    const tabella = screen.getByRole("table");
    expect(within(tabella).getAllByRole("columnheader").map((th) => th.textContent?.trim())).toEqual([
      "Cliente",
      "Agente",
      "Ordinato",
      "Numero ordini",
    ]);
    const bruno = within(tabella).getByText("Bruno").closest("tr") as HTMLElement;
    expect(bruno.textContent).toContain("ACME");
    expect(bruno.textContent).toContain("200");
    expect(bruno.textContent).toContain("2");
  });

  it("non compare la differenza fra euro e ordini che nessuno ha chiesto", () => {
    render(<GraficoDaAnalisi serie={insieme} tipo="tabella" />);
    expect(screen.queryByText("Delta")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Δ/)).not.toBeInTheDocument();
  });
});

describe("l'anno precedente come colonna", () => {
  it("due colonne della stessa misura, sullo stesso cliente", () => {
    const corrente = serie(
      "ordinato",
      "Ordinato",
      ["cliente"],
      [
        { chiavi: { cliente: "ACME" }, valore: 500 },
        { chiavi: { cliente: "BETA" }, valore: 300 },
      ],
      "principale"
    );
    const precedente = serie(
      "ordinato",
      "Ordinato · anno precedente",
      ["cliente"],
      [
        { chiavi: { cliente: "ACME" }, valore: 400 },
        { chiavi: { cliente: "BETA" }, valore: 350 },
      ],
      "confronto",
      "euro",
      { modificatore: "anno_precedente" }
    );
    render(<GraficoDaAnalisi serie={[corrente, precedente]} tipo="tabella" />);
    const tabella = screen.getByRole("table");
    const intestazioni = within(tabella).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(intestazioni.slice(0, 3)).toEqual(["Cliente", "Ordinato", "Ordinato · anno precedente"]);
    const acme = within(tabella).getByText("ACME").closest("tr") as HTMLElement;
    expect(acme.textContent).toContain("500");
    expect(acme.textContent).toContain("400");
    // Stessa misura a un altro periodo: la differenza ha senso e compare da sola.
    expect(within(tabella).getAllByRole("columnheader").some((th) => /Delta|Δ/.test(th.textContent ?? ""))).toBe(true);
  });
});

describe("il tempo e' una colonna come le altre", () => {
  it("con piu' valori e un campo: Mese, Cliente, poi i valori, e l'anno precedente allineato ai mesi", () => {
    const corrente = serie(
      "ordinato",
      "Ordinato",
      ["cliente"],
      [
        { chiavi: { periodo: "2026-01", cliente: "ACME" }, valore: 10 },
        { chiavi: { periodo: "2026-02", cliente: "ACME" }, valore: 20 },
      ],
      "principale",
      "euro",
      { granularita: "mese" }
    );
    const precedente = serie(
      "ordinato",
      "Ordinato · anno precedente",
      ["cliente"],
      [{ chiavi: { periodo: "2025-01", cliente: "ACME" }, valore: 7 }],
      "confronto",
      "euro",
      { granularita: "mese", modificatore: "anno_precedente" }
    );
    render(<GraficoDaAnalisi serie={[corrente, precedente]} tipo="tabella" />);
    const tabella = screen.getByRole("table");
    expect(within(tabella).getAllByRole("columnheader").map((th) => th.textContent?.trim()).slice(0, 4)).toEqual([
      "Mese",
      "Cliente",
      "Ordinato",
      "Ordinato · anno precedente",
    ]);
    // Gennaio 2025 sta sulla riga di gennaio 2026, non su una riga sua.
    const gennaio = within(tabella).getByText("01/2026").closest("tr") as HTMLElement;
    expect(gennaio.textContent).toContain("10");
    expect(gennaio.textContent).toContain("7");
    expect(within(tabella).queryByText("01/2025")).not.toBeInTheDocument();
    // Cronologico: gennaio prima di febbraio.
    const date = within(tabella).getAllByText(/^0[12]\/2026$/).map((c) => c.textContent);
    expect(date).toEqual(["01/2026", "02/2026"]);
  });
});

describe("il numero del documento ha il nome della sua operazione", () => {
  it("«Numero fattura» e non «Documento»", () => {
    const fatturato = serie(
      "fatturato",
      "Fatturato",
      ["documento"],
      [{ chiavi: { documento: "4521" }, valore: 120 }],
      "principale"
    );
    const conteggio = serie(
      "n_fatture",
      "Numero fatture",
      ["documento"],
      [{ chiavi: { documento: "4521" }, valore: 1 }],
      "confronto",
      "numero"
    );
    render(<GraficoDaAnalisi serie={[fatturato, conteggio]} tipo="tabella" />);
    const intestazioni = within(screen.getByRole("table")).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(intestazioni[0]).toBe("Numero fattura");
  });

  it("anche nella tabella di un risultato solo", () => {
    const solo = serie("ordinato", "Ordinato", ["documento"], [{ chiavi: { documento: "77" }, valore: 5 }], "principale");
    render(<GraficoDaAnalisi serie={[solo]} tipo="tabella" />);
    const intestazioni = within(screen.getByRole("table")).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(intestazioni[0]).toBe("Numero ordine");
  });
});
