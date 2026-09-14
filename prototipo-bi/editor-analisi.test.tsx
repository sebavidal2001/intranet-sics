import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorAnalisi } from "@/components/prototipo-bi/editor-analisi";
import type { RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

const VOCABOLARIO = {
  tipologie: [
    {
      chiave: "ordinato",
      etichetta: "Ordinato",
      descrizione: "Ordini ricevuti e valore medio.",
      metriche: ["ordinato", "n_ordini"],
    },
    {
      chiave: "fatturato",
      etichetta: "Fatturato",
      descrizione: "Valore delle fatture emesse.",
      metriche: ["fatturato"],
    },
    {
      chiave: "consegnato",
      etichetta: "Consegnato",
      descrizione: "Consegne e portafoglio.",
      metriche: ["consegnato", "portafoglio"],
    },
  ],
  metriche: [
    { chiave: "ordinato", etichetta: "Valore ordinato", descrizione: "Valore degli ordini acquisiti", unita: "euro" },
    { chiave: "n_ordini", etichetta: "Numero ordini", descrizione: "Documenti distinti", unita: "numero" },
    { chiave: "fatturato", etichetta: "Valore fatturato", descrizione: "Valore delle fatture", unita: "euro" },
    { chiave: "consegnato", etichetta: "Valore consegnato", descrizione: "Merci consegnate", unita: "euro" },
    { chiave: "portafoglio", etichetta: "Portafoglio", descrizione: "Ordini aperti", unita: "euro" },
  ],
  dimensioni: [
    { chiave: "bu", etichetta: "Business unit" },
    { chiave: "agente", etichetta: "Agente" },
    { chiave: "cliente", etichetta: "Cliente" },
    { chiave: "causale", etichetta: "Causale magazzino" },
  ],
  dimensioniPerMetrica: {
    ordinato: ["bu", "agente", "cliente"],
    n_ordini: ["bu", "agente", "cliente"],
    fatturato: ["bu", "agente", "cliente"],
    consegnato: ["bu", "agente", "cliente", "causale"],
    portafoglio: ["bu", "agente", "cliente"],
  },
  modificatori: [
    { chiave: "corrente", descrizione: "valore del periodo richiesto" },
    { chiave: "anno_precedente", descrizione: "stesso periodo dell’anno prima" },
  ],
  granularita: ["giorno", "settimana", "mese", "anno"],
};

function risultato(spec: SpecQuery): RisultatoQuery {
  return {
    spec,
    metrica: spec.metrica,
    unita: "euro",
    righe: [{ etichetta: "Totale", chiavi: {}, valore: 1200, conteggio: 1 }],
    totale: 1200,
    certificata: true,
    avvisi: [],
  };
}

function risposta(corpo: unknown, ok = true) {
  return { ok, json: async () => corpo };
}

function preparaFetch() {
  const spia = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/bi/analisi")) return risposta({ analisi: { id: "analisi-1" } });
    if (!init?.method) return risposta(VOCABOLARIO);
    const body = JSON.parse(String(init.body)) as {
      spec?: SpecQuery;
      specs?: Array<{ id: string; spec: SpecQuery }>;
    };
    if (body.specs) {
      return risposta({
        risultati: body.specs.map((voce) => ({ id: voce.id, risultato: risultato(voce.spec) })),
      });
    }
    return risposta({ risultato: risultato(body.spec!) });
  });
  vi.stubGlobal("fetch", spia);
  return spia;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (voci: unknown[]) => void) {}
      observe() { this.callback([{ contentRect: { width: 800, height: 400 } }]); }
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function caricaVocabolario() {
  await act(async () => Promise.resolve());
}

async function completaDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await act(async () => Promise.resolve());
}

describe("EditorAnalisi", () => {
  it("aggiunge budget e BEP in un click e li salva nella stessa analisi", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato", raggruppa: ["bu"] }} titoloIniziale="Ordinato per BU" />);
    await caricaVocabolario();

    fireEvent.click(screen.getByRole("button", { name: "Budget" }));
    fireEvent.click(screen.getByRole("button", { name: "BEP" }));
    await completaDebounce();

    const batch = spia.mock.calls
      .map(([, init]) => init?.body ? JSON.parse(String(init.body)) as { specs?: unknown[] } : null)
      .find((corpo) => corpo?.specs?.length === 3);
    expect(batch?.specs).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Salva il riquadro" }));
    await act(async () => Promise.resolve());
    const salvataggio = spia.mock.calls.find(([input]) => String(input).includes("/api/bi/analisi"));
    const corpo = JSON.parse(String(salvataggio?.[1]?.body)) as { serie: Array<{ ruolo: string }> };
    expect(corpo.serie.map((voce) => voce.ruolo)).toEqual(["principale", "obiettivo", "soglia"]);
  });

  it("le misure sono caselle raggruppate, non una tendina piatta", async () => {
    // La tendina unica metteva sullo stesso piano «Ordinato» e «Quota stesso
    // giorno», che non sono la stessa specie di cosa. I gruppi lo dicono.
    preparaFetch();
    render(<EditorAnalisi />);
    await caricaVocabolario();

    expect(screen.queryByLabelText("Metrica")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Valore ordinato" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Numero ordini" })).toBeInTheDocument();
    // Il fatturato sta in un altro gruppo, chiuso: c'è, ma non ingombra.
    expect(screen.queryByRole("checkbox", { name: "Valore fatturato" })).not.toBeInTheDocument();
  });

  it("riaprendo un riquadro il gruppo che contiene i campi scelti è già aperto", async () => {
    // Un gruppo chiuso nasconderebbe proprio i campi già scelti, e chi apre il
    // riquadro penserebbe di averli persi.
    preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "consegnato", raggruppa: ["causale"] }} />);
    await caricaVocabolario();

    expect(screen.getByRole("checkbox", { name: "Causale magazzino" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Valore consegnato" })).toBeChecked();
  });

  it("alla terza dimensione il limite è scritto invece che subìto", async () => {
    preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato", raggruppa: ["bu", "agente"] }} />);
    await caricaVocabolario();

    expect(screen.getByRole("checkbox", { name: "Business unit" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Agente" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Cliente/ })).toBeDisabled();
    expect(screen.getAllByText(/Al massimo due/).length).toBeGreaterThan(0);
  });

  it("aggiorna l'analisi riaperta senza crearne una nuova", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi idAnalisi="analisi-1" specIniziale={{ metrica: "ordinato" }} titoloIniziale="Ordinato" />);
    await caricaVocabolario();
    await completaDebounce();

    fireEvent.click(screen.getByRole("button", { name: "Salva modifiche" }));
    await act(async () => Promise.resolve());

    expect(spia).toHaveBeenCalledWith(
      "/api/bi/analisi?id=analisi-1",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("salva senza periodo quando eredita e lo valorizza quando viene fissato", async () => {
    const spia = preparaFetch();
    render(
      <EditorAnalisi
        specIniziale={{ metrica: "ordinato" }}
        titoloIniziale="Ordinato"
        periodoEreditato={{ anno: 2026 }}
      />
    );
    await caricaVocabolario();
    await completaDebounce();

    fireEvent.click(screen.getByRole("button", { name: "Salva il riquadro" }));
    await act(async () => Promise.resolve());
    const prima = spia.mock.calls.find(([input]) => String(input).includes("/api/bi/analisi"));
    const corpoPrima = JSON.parse(String(prima?.[1]?.body)) as { spec: SpecQuery };
    expect(corpoPrima.spec).not.toHaveProperty("periodo");

    fireEvent.click(screen.getByRole("radio", { name: /Fissa un periodo/i }));
    fireEvent.click(screen.getByRole("button", { name: "Salva il riquadro" }));
    await act(async () => Promise.resolve());
    const salvataggi = spia.mock.calls.filter(([input]) => String(input).includes("/api/bi/analisi"));
    const corpoSeconda = JSON.parse(String(salvataggi[1]?.[1]?.body)) as { spec: SpecQuery };
    expect(corpoSeconda.spec.periodo).toEqual({ anno: 2026 });
  });

  it("mostra senza riscriverlo il messaggio di validazione 422", async () => {
    const messaggio = "Il periodo iniziale non può essere successivo a quello finale.";
    const spia = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return risposta(VOCABOLARIO);
      return risposta({ error: messaggio }, false);
    });
    vi.stubGlobal("fetch", spia);
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} />);
    await caricaVocabolario();
    await completaDebounce();

    expect(screen.getByRole("alert")).toHaveTextContent(messaggio);
  });
});
