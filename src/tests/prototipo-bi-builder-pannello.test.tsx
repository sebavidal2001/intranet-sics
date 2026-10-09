import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorAnalisi } from "@/components/prototipo-bi/editor-analisi";

// Il minimo che l'editor chiede a /api/bi/query per aprirsi.
const VOCABOLARIO = {
  tipologie: [
    {
      chiave: "vendite",
      etichetta: "Vendite",
      descrizione: "Ordinato e fatturato",
      metriche: ["ordinato", "fatturato"],
    },
  ],
  metriche: [
    { chiave: "ordinato", etichetta: "Ordinato", descrizione: "", unita: "euro" },
    { chiave: "fatturato", etichetta: "Fatturato", descrizione: "", unita: "euro" },
  ],
  dimensioni: [
    { chiave: "bu", etichetta: "Business unit" },
    { chiave: "agente", etichetta: "Agente" },
  ],
  dimensioniPerMetrica: { ordinato: ["bu", "agente"], fatturato: ["bu", "agente"] },
  modificatori: [{ chiave: "corrente", descrizione: "Periodo corrente" }],
  granularita: ["mese"],
};

function risposta(corpo: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(corpo) } as Response);
}

describe("builder a pannello laterale", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).startsWith("/api/bi/query")) return risposta(VOCABOLARIO);
        // Misure e calcolo: non servono a questi controlli.
        return risposta({ error: "non disponibile in test" }, false);
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("apre con il pannello dei campi e un segnaposto al posto del grafico", async () => {
    render(<EditorAnalisi />);
    await screen.findByRole("tab", { name: "Campi" });

    expect(screen.getByRole("tab", { name: "Campi" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Il grafico comparirà qui")).toBeInTheDocument();
    // Pozzetti e albero stanno nello stesso pannello.
    const pannello = screen.getByRole("tabpanel", { name: "Campi" });
    for (const nome of ["Asse", "Legenda", "Valori", "Filtri"]) {
      expect(within(pannello).getByRole("region", { name: nome })).toBeInTheDocument();
    }
    expect(within(pannello).getByLabelText(/^Ordinato/)).toBeInTheDocument();
  });

  it("le altre schede si aprono solo dopo aver scelto una misura", async () => {
    render(<EditorAnalisi />);
    await screen.findByRole("tab", { name: "Campi" });

    fireEvent.click(screen.getByRole("tab", { name: "Confronti" }));
    expect(screen.getByRole("tabpanel", { name: "Confronti" })).toHaveTextContent("Scegli prima una misura");

    fireEvent.click(screen.getByRole("tab", { name: "Campi" }));
    fireEvent.click(within(screen.getByRole("tabpanel", { name: "Campi" })).getByLabelText(/^Ordinato/));

    // Con una misura scelta il segnaposto sparisce e compaiono i parametri.
    await waitFor(() => expect(screen.queryByText("Il grafico comparirà qui")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Filtri" }));
    expect(screen.getByRole("tabpanel", { name: "Filtri" })).toHaveTextContent("Quando");
    expect(screen.getByRole("tabpanel", { name: "Filtri" })).toHaveTextContent("Solo dove");
  });

  it("un campo trascinato sulla tela finisce nel pozzetto della zona scelta", async () => {
    render(<EditorAnalisi />);
    await screen.findByRole("tab", { name: "Campi" });

    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => ""), effectAllowed: "", dropEffect: "" };
    const casella = within(screen.getByRole("tabpanel", { name: "Campi" }))
      .getByLabelText(/^Ordinato/)
      .closest("label") as HTMLElement;

    // Prima del gesto non ci sono zone di rilascio; mentre si trascina compare «Valori».
    expect(screen.queryByText("Cosa misurare")).not.toBeInTheDocument();
    fireEvent.dragStart(casella, { dataTransfer });
    const zona = (await screen.findByText("Cosa misurare")).parentElement as HTMLElement;

    fireEvent.drop(zona, { dataTransfer });
    fireEvent.dragEnd(casella, { dataTransfer });

    const valori = screen.getByRole("region", { name: "Valori" });
    expect(within(valori).getByRole("button", { name: /Togli Ordinato dai valori/ })).toBeInTheDocument();
    expect(screen.queryByText("Cosa misurare")).not.toBeInTheDocument();
  });

  it("cerca un campo e tiene aperti i gruppi che corrispondono", async () => {
    render(<EditorAnalisi />);
    await screen.findByRole("tab", { name: "Campi" });

    const pannello = screen.getByRole("tabpanel", { name: "Campi" });
    fireEvent.change(within(pannello).getByLabelText("Cerca un campo"), { target: { value: "agen" } });

    expect(within(pannello).getByLabelText(/^Agente/)).toBeInTheDocument();
    expect(within(pannello).queryByLabelText(/^Business unit/)).not.toBeInTheDocument();
    expect(within(pannello).queryByLabelText(/^Ordinato/)).not.toBeInTheDocument();

    fireEvent.change(within(pannello).getByLabelText("Cerca un campo"), { target: { value: "zzz" } });
    expect(within(pannello).getByText(/Nessun campo corrisponde/)).toBeInTheDocument();
  });
});
