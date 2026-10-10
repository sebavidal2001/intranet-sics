import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DashboardView, type DashboardCompleta } from "@/components/prototipo-bi/dashboard-view";
import { applicaFiltriIncrociati } from "@/lib/prototipo-bi/filtri-pagina";

// Il grafico finto espone un bottone per cliccare «IMA»: quello che conta qui e'
// che cosa fa la dashboard del clic, non come lo disegna il grafico.
vi.mock("@/components/prototipo-bi/grafico-da-risultato", () => ({
  GraficoDaRisultato: () => <div />,
  GraficoDaAnalisi: ({
    onClickEtichetta,
    serie,
    selezionata,
  }: {
    onClickEtichetta?: (etichetta: string) => void;
    serie: Array<{ spec: { raggruppa?: string[] } }>;
    selezionata?: string | null;
  }) => (
    <div>
      <button type="button" onClick={() => onClickEtichetta?.("IMA spa")}>
        clic {serie[0]?.spec.raggruppa?.[0] ?? "totale"}
      </button>
      <span data-testid={`selezionata-${serie[0]?.spec.raggruppa?.[0] ?? "totale"}`}>{selezionata ?? "nessuna"}</span>
    </div>
  ),
}));

function analisi(id: string, titolo: string, spec: object) {
  return {
    id, titolo, descrizione: null, spec, grafico: "barre" as const,
    autore_id: "u", visibilita: "privata" as const,
  };
}

const DASHBOARD: DashboardCompleta = {
  id: "d", titolo: "Prova", descrizione: null, autore_id: "u", visibilita: "privata", modificabile: false,
  pagine: [
    {
      id: "p1", dashboard_id: "d", titolo: "Sintesi", ordine: 0, filtri: {},
      riquadri: [
        { id: "r1", pagina_id: "p1", analisi_id: "a1", titolo: "Totale", posizione: 0, larghezza: 6, altezza: 4, grafico: "barre",
          analisi: analisi("a1", "Totale", { metrica: "ordinato" }) },
        { id: "r2", pagina_id: "p1", analisi_id: "a2", titolo: "Clienti", posizione: 1, larghezza: 6, altezza: 4, grafico: "barre",
          analisi: analisi("a2", "Clienti", { metrica: "ordinato", raggruppa: ["cliente"] }) },
        { id: "r3", pagina_id: "p1", analisi_id: "a3", titolo: "Visite", posizione: 2, larghezza: 6, altezza: 4, grafico: "barre",
          analisi: analisi("a3", "Visite", { metrica: "visite_numero", raggruppa: ["agente"] }) },
        { id: "r4", pagina_id: "p1", analisi_id: "a4", titolo: "Budget", posizione: 3, larghezza: 6, altezza: 4, grafico: "barre",
          analisi: analisi("a4", "Budget", { metrica: "budget", raggruppa: ["bu"] }) },
      ],
    },
  ],
} as unknown as DashboardCompleta;

function preparaFetch() {
  const spia = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { specs?: Array<{ id: string }> };
    return {
      ok: true,
      json: async () => ({
        risultati: (body.specs ?? []).map(({ id }) => ({
          id,
          risultato: { spec: {}, metrica: "ordinato", unita: "euro", righe: [], totale: 0, certificata: true, avvisi: [] },
        })),
      }),
    };
  });
  vi.stubGlobal("fetch", spia);
  return () => spia.mock.calls.filter(([url]) => url === "/api/bi/query");
}

type Corpo = { specs: Array<{ id: string; spec: { filtri?: Array<{ campo: string; valore: unknown }> } }> };
const corpo = (chiamata: unknown[]) => JSON.parse(String((chiamata[1] as RequestInit).body)) as Corpo;

describe("filtro incrociato sulle dashboard", () => {
  it("il clic su un grafico filtra gli altri riquadri ma non quello cliccato", async () => {
    const query = preparaFetch();
    render(<DashboardView dashboardIniziale={DASHBOARD} />);
    await waitFor(() => expect(query()).toHaveLength(1));

    fireEvent.click(screen.getByText("clic cliente"));
    await waitFor(() => expect(query()).toHaveLength(2));

    const specs = corpo(query()[1]).specs;
    const filtroDi = (id: string) => specs.find((s) => s.id === id)?.spec.filtri ?? [];
    expect(filtroDi("r1")).toEqual([{ campo: "cliente", op: "eq", valore: "IMA spa" }]);
    expect(filtroDi("r2")).toEqual([]); // resta intero: si puo' passare a un altro cliente
    expect(filtroDi("r3")).toEqual([{ campo: "cliente", op: "eq", valore: "IMA spa" }]); // anche le visite hanno il cliente
    expect(screen.getByText(/Filtro dal grafico/i)).toBeInTheDocument();
  });

  it("un secondo clic sullo stesso valore toglie il filtro", async () => {
    const query = preparaFetch();
    render(<DashboardView dashboardIniziale={DASHBOARD} />);
    await waitFor(() => expect(query()).toHaveLength(1));
    fireEvent.click(screen.getByText("clic cliente"));
    await waitFor(() => expect(query()).toHaveLength(2));
    fireEvent.click(screen.getByText("clic cliente"));
    await waitFor(() => expect(query()).toHaveLength(3));
    expect(corpo(query()[2]).specs.find((s) => s.id === "r1")?.spec.filtri ?? []).toEqual([]);
    expect(screen.queryByText(/Filtro dal grafico/i)).not.toBeInTheDocument();
  });

  it("«Togli tutti» spegne il filtro", async () => {
    const query = preparaFetch();
    render(<DashboardView dashboardIniziale={DASHBOARD} />);
    await waitFor(() => expect(query()).toHaveLength(1));
    fireEvent.click(screen.getByText("clic cliente"));
    await waitFor(() => expect(query()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Togli tutti" }));
    await waitFor(() => expect(query()).toHaveLength(3));
  });
});

describe("il filtro dal grafico si vede", () => {
  async function dopoIlClic() {
    const query = preparaFetch();
    render(<DashboardView dashboardIniziale={DASHBOARD} />);
    await waitFor(() => expect(query()).toHaveLength(1));
    fireEvent.click(screen.getByText("clic cliente"));
    await waitFor(() => expect(query()).toHaveLength(2));
  }

  it("nel riquadro cliccato la voce scelta resta evidenziata; negli altri non c'e' nessuna selezione", async () => {
    await dopoIlClic();
    expect(screen.getByTestId("selezionata-cliente")).toHaveTextContent("IMA spa");
    expect(screen.getByTestId("selezionata-totale")).toHaveTextContent("nessuna");
    expect(screen.getByTestId("selezionata-agente")).toHaveTextContent("nessuna");
  });

  it("gli altri riquadri dicono da cosa sono filtrati", async () => {
    await dopoIlClic();
    const filtrati = screen.getAllByTestId("filtrato-da").map((e) => e.textContent);
    // Totale e Visite si ricalcolano; il riquadro cliccato e il budget no.
    expect(filtrati).toHaveLength(2);
    for (const testo of filtrati) expect(testo).toContain("Cliente: IMA spa");
  });

  it("un riquadro che la dimensione non riguarda dice di non essere collegato", async () => {
    await dopoIlClic();
    const nonCollegati = screen.getAllByTestId("non-collegato");
    expect(nonCollegati).toHaveLength(1);
    expect(nonCollegati[0]).toHaveTextContent("Non collegato a Cliente");
  });

  it("la fascia del filtro resta in vista mentre si scorre", async () => {
    await dopoIlClic();
    expect(screen.getByRole("status", { name: "" }).className).toContain("sticky");
  });

  it("togliendo il filtro spariscono evidenziazione e indicatori", async () => {
    await dopoIlClic();
    fireEvent.click(screen.getByRole("button", { name: "Togli tutti" }));
    await waitFor(() => expect(screen.queryByTestId("filtrato-da")).not.toBeInTheDocument());
    expect(screen.queryByTestId("non-collegato")).not.toBeInTheDocument();
    expect(screen.getByTestId("selezionata-cliente")).toHaveTextContent("nessuna");
  });
});

describe("applicaFiltriIncrociati", () => {
  const cliente = [{ campo: "cliente" as const, op: "eq" as const, valore: "IMA spa" }];

  it("non tocca la domanda quando non c'e' niente da applicare", () => {
    const spec = { metrica: "ordinato" as const };
    expect(applicaFiltriIncrociati(spec, []).spec).toBe(spec);
  });

  it("aggiunge il filtro alle metriche del dominio giusto", () => {
    const r = applicaFiltriIncrociati({ metrica: "fatturato" }, cliente);
    expect(r.spec.filtri).toEqual(cliente);
    expect(r.ignorati).toEqual([]);
  });

  it("salta e dichiara il filtro se la domanda ha gia' il proprio sulla stessa dimensione", () => {
    const propri = [{ campo: "cliente" as const, op: "eq" as const, valore: "ALTRO" }];
    const r = applicaFiltriIncrociati({ metrica: "fatturato", filtri: propri }, cliente);
    expect(r.spec.filtri).toEqual(propri);
    expect(r.ignorati).toEqual(["cliente"]);
  });

  it("su budget e BEP si applicano solo business unit e agente", () => {
    expect(applicaFiltriIncrociati({ metrica: "budget" }, cliente).ignorati).toEqual(["cliente"]);
    const bu = [{ campo: "bu" as const, op: "eq" as const, valore: "COMPONENTI" }];
    expect(applicaFiltriIncrociati({ metrica: "bep" }, bu).spec.filtri).toEqual(bu);
  });

  it("le dimensioni delle vendite non si applicano alle visite, e viceversa", () => {
    const cap = [{ campo: "cap" as const, op: "eq" as const, valore: "40069" }];
    expect(applicaFiltriIncrociati({ metrica: "ordinato" }, cap).ignorati).toEqual(["cap"]);
    expect(applicaFiltriIncrociati({ metrica: "visite_numero" }, cap).spec.filtri).toEqual(cap);
  });
});
