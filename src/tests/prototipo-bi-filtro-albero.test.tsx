import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  alberoDaRighe,
  filtroDaSelezione,
  ramo,
  riassuntoSelezione,
  selezioneDaFiltro,
} from "@/lib/prototipo-bi/filtro-albero";
import { fondiFiltriPaginaConEsito } from "@/lib/prototipo-bi/filtri-pagina";
import { esegui } from "@/lib/prototipo-bi/semantico";
import { SelettoreValori } from "@/components/prototipo-bi/selettore-valori";
import type { Filtro, RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

// Come nei dati veri: la categoria «-» esiste sotto piu' business unit.
const RIGHE = [
  { chiavi: { bu: "COMPONENTI", categoria: "AUTOMAZIONE pneumatica" } },
  { chiavi: { bu: "COMPONENTI", categoria: "FLUIDI" } },
  { chiavi: { bu: "COMPONENTI", categoria: "-" } },
  { chiavi: { bu: "IMPIANTI", categoria: "IMPIANTI aria/vuoto" } },
  { chiavi: { bu: "IMPIANTI", categoria: "-" } },
];
const ALBERO = alberoDaRighe(RIGHE);

describe("filtro a matrioska", () => {
  it("solo business unit intere → filtro su bu", () => {
    const sel = new Set(ALBERO[0].categorie.map((c) => ramo("COMPONENTI", c)));
    expect(filtroDaSelezione(ALBERO, sel)).toEqual({ campo: "bu", op: "eq", valore: "COMPONENTI" });
  });

  it("una sola categoria dentro una business unit → filtro sui rami", () => {
    const sel = new Set([ramo("COMPONENTI", "AUTOMAZIONE pneumatica")]);
    expect(filtroDaSelezione(ALBERO, sel)).toEqual({
      campo: "bu_categoria",
      op: "in",
      valore: ["COMPONENTI › AUTOMAZIONE pneumatica"],
    });
    expect(riassuntoSelezione(ALBERO, sel)).toBe("COMPONENTI (1 di 3)");
  });

  it("tutto scelto o niente scelto = nessun filtro", () => {
    expect(filtroDaSelezione(ALBERO, new Set())).toBeNull();
    expect(filtroDaSelezione(ALBERO, new Set(ALBERO.flatMap((n) => n.categorie.map((c) => ramo(n.bu, c)))))).toBeNull();
  });

  it("riapre la selezione da un filtro esistente su bu", () => {
    const sel = selezioneDaFiltro(ALBERO, { campo: "bu", op: "eq", valore: "IMPIANTI" });
    expect([...sel].sort()).toEqual(["IMPIANTI › -", "IMPIANTI › IMPIANTI aria/vuoto"]);
  });

  it("il ramo non prende la categoria «-» delle altre business unit", () => {
    const riga = (bu: string, categoria: string, importo: number): RigaFatto => ({
      data: "2026-03-01", importo, bu, categoria, agente: "A", codiceAgente: "A", cliente: "C",
      codiceCliente: "C", documento: "1", articolo: "X", descrizioneArticolo: "X", quantita: 1,
    });
    const snapshot = {
      generatoIl: "", runCorrente: null, runRicevutoIl: null, dataMassima: "2026-03-31", dataMinima: "2026-01-01",
      conteggi: {},
      dataset: {
        ordinato: [], consegnato: [], portafoglio: [], preventivi_aperti: [], controllo_banco: [],
        consegnato_futuro_per_mese: [],
        fatturato: [riga("COMPONENTI", "-", 10), riga("IMPIANTI", "-", 100), riga("COMPONENTI", "FLUIDI", 1)],
      },
    } as Snapshot;
    const r = esegui(
      { metrica: "fatturato", filtri: [{ campo: "bu_categoria", op: "in", valore: ["COMPONENTI › -"] }] },
      snapshot
    );
    expect(r.totale).toBe(10);
    // Un filtro senza valori scelti non restringe niente.
    expect(esegui({ metrica: "fatturato", filtri: [{ campo: "bu", op: "in", valore: [] }] }, snapshot).totale).toBe(111);
  });
});

describe("filtri di pagina", () => {
  it("i rami prevalgono sulla business unit, e piu' agenti diventano un «in»", () => {
    const { spec } = fondiFiltriPaginaConEsito(
      { metrica: "ordinato" },
      { bu: "IMPIANTI", rami: ["COMPONENTI › FLUIDI"], agente: ["LUCIA RODA", "AIRFLUID"] }
    );
    expect(spec.filtri).toEqual([
      { campo: "bu_categoria", op: "in", valore: ["COMPONENTI › FLUIDI"] },
      { campo: "agente", op: "in", valore: ["LUCIA RODA", "AIRFLUID"] },
    ]);
  });

  it("un riquadro gia' filtrato per business unit ignora i rami della pagina, e lo dice", () => {
    const esito = fondiFiltriPaginaConEsito(
      { metrica: "ordinato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
      { rami: ["IMPIANTI › -"] }
    );
    expect(esito.spec.filtri).toEqual([{ campo: "bu", op: "eq", valore: "COMPONENTI" }]);
    expect(esito.filtriPaginaIgnorati).toEqual(["bu"]);
  });
});

describe("SelettoreValori", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("propone l'albero dai dati e permette di scegliere una sola categoria", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          risultati: [{ id: "valori", risultato: { righe: RIGHE.map((r) => ({ ...r, etichetta: "", valore: 1 })) } }],
        }),
      })
    );
    const onChange = vi.fn<(f: Filtro | null) => void>();
    render(<SelettoreValori campo="bu" metrica="fatturato" periodo={{ anno: 2099 }} filtro={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Valori" }));
    await waitFor(() => expect(screen.getByText("COMPONENTI")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Apri COMPONENTI" }));
    fireEvent.click(screen.getByLabelText("AUTOMAZIONE pneumatica"));

    expect(onChange).toHaveBeenLastCalledWith({
      campo: "bu_categoria",
      op: "in",
      valore: ["COMPONENTI › AUTOMAZIONE pneumatica"],
    });
  });
});
