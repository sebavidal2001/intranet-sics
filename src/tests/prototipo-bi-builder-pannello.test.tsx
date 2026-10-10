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
    { chiave: "visite_numero", etichetta: "Visite", descrizione: "", unita: "numero" },
  ],
  dimensioni: [
    { chiave: "bu", etichetta: "Business unit" },
    { chiave: "agente", etichetta: "Agente" },
    { chiave: "cap", etichetta: "CAP" },
  ],
  dimensioniPerMetrica: {
    ordinato: ["bu", "agente"],
    fatturato: ["bu", "agente"],
    visite_numero: ["agente", "cap"],
  },
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
  it("CAP sta dentro «Personale › Commerciale», insieme al numero delle visite, e in nessun altro posto", async () => {
    render(<EditorAnalisi />);
    await screen.findByRole("tab", { name: "Campi" });

    const pannello = screen.getByRole("tabpanel", { name: "Campi" });
    fireEvent.change(within(pannello).getByLabelText("Cerca un campo"), { target: { value: "visit" } });

    const gruppo = within(pannello).getByText("Commerciale (visite)").closest("button")?.parentElement as HTMLElement;
    expect(within(gruppo).getByLabelText(/^Visite/)).toBeInTheDocument();
    expect(within(gruppo).getByLabelText(/^CAP/)).toBeInTheDocument();
    // Una sola casella CAP in tutto l'elenco, e nessun gruppo «Visite e territorio» a parte.
    expect(within(pannello).getAllByLabelText(/^CAP/)).toHaveLength(1);
    expect(within(pannello).queryByText("Visite e territorio")).not.toBeInTheDocument();
  });

  it("si puo' svuotare del tutto il riquadro; l'errore c'e' solo al salvataggio", async () => {
    render(<EditorAnalisi />);
    await screen.findByRole("tab", { name: "Campi" });
    const pannello = screen.getByRole("tabpanel", { name: "Campi" });

    fireEvent.click(within(pannello).getByLabelText(/^Ordinato/));
    await waitFor(() => expect(screen.queryByText("Il grafico comparirà qui")).not.toBeInTheDocument());

    // Tolta l'ultima misura il riquadro e' vuoto, senza rifiuti né errori.
    fireEvent.click(within(pannello).getByLabelText(/^Ordinato/));
    await screen.findByText("Il grafico comparirà qui");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/Serve almeno una misura/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Salva il riquadro/ }));
    expect(await screen.findByText(/Il riquadro è vuoto/)).toBeInTheDocument();
  });

  it("togliere l'ultima misura dai Valori svuota il riquadro", async () => {
    render(<EditorAnalisi />);
    await screen.findByRole("tab", { name: "Campi" });
    fireEvent.click(within(screen.getByRole("tabpanel", { name: "Campi" })).getByLabelText(/^Ordinato/));
    await waitFor(() => expect(screen.queryByText("Il grafico comparirà qui")).not.toBeInTheDocument());

    const valori = screen.getByRole("region", { name: "Valori" });
    fireEvent.click(within(valori).getByRole("button", { name: /Togli Ordinato dai valori/ }));

    await screen.findByText("Il grafico comparirà qui");
    expect(within(screen.getByRole("region", { name: "Valori" })).queryByRole("button", { name: /Togli/ })).not.toBeInTheDocument();
  });
});
