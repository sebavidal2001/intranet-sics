import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorAnalisi } from "@/components/prototipo-bi/editor-analisi";
import type { RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

const VOCABOLARIO = {
  metriche: [
    { chiave: "ordinato", etichetta: "Ordinato", descrizione: "Valore degli ordini acquisiti", unita: "euro" },
    { chiave: "fatturato", etichetta: "Fatturato", descrizione: "Valore delle fatture", unita: "euro" },
  ],
  dimensioni: [
    { chiave: "bu", etichetta: "Business unit" },
    { chiave: "agente", etichetta: "Agente" },
    { chiave: "cliente", etichetta: "Cliente" },
  ],
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (voci: unknown[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 800, height: 400 } }]);
      }
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function completaCaricamentoIniziale(spia: ReturnType<typeof vi.fn>) {
  await act(async () => Promise.resolve());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await act(async () => Promise.resolve());
  expect(spia).toHaveBeenCalledWith("/api/bi/query", expect.objectContaining({ method: "POST" }));
}

describe("EditorAnalisi", () => {
  it("carica il vocabolario e mostra le metriche disponibili", async () => {
    const spia = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return risposta(VOCABOLARIO);
      const body = JSON.parse(String(init.body)) as { spec: SpecQuery };
      return risposta({ risultato: risultato(body.spec) });
    });
    vi.stubGlobal("fetch", spia);

    render(<EditorAnalisi />);
    await act(async () => Promise.resolve());

    expect(screen.getByRole("option", { name: "Ordinato" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Fatturato" })).toBeInTheDocument();
    expect(screen.getByText("Valore degli ordini acquisiti")).toBeInTheDocument();
  });

  it("accorpa il cambio metrica in una sola query dopo il debounce", async () => {
    const spia = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return risposta(VOCABOLARIO);
      const body = JSON.parse(String(init.body)) as { spec: SpecQuery };
      return risposta({ risultato: risultato(body.spec) });
    });
    vi.stubGlobal("fetch", spia);
    render(<EditorAnalisi />);
    await completaCaricamentoIniziale(spia);
    spia.mockClear();

    fireEvent.change(screen.getByLabelText("Metrica"), { target: { value: "fatturato" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });
    expect(spia).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(spia).toHaveBeenCalledTimes(1);
    expect(spia).toHaveBeenCalledWith("/api/bi/query", expect.objectContaining({ method: "POST" }));
  });

  it("disabilita le dimensioni ulteriori quando due sono già scelte", async () => {
    const spec: SpecQuery = { metrica: "ordinato", raggruppa: ["bu", "agente"] };
    const spia = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      !init?.method ? risposta(VOCABOLARIO) : risposta({ risultato: risultato(spec) })
    );
    vi.stubGlobal("fetch", spia);
    render(<EditorAnalisi specIniziale={spec} />);
    await act(async () => Promise.resolve());

    expect(screen.getByRole("checkbox", { name: "Business unit" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Agente" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Cliente" })).toBeDisabled();
    expect(screen.getByText(/massimo rappresentabile in un grafico/i)).toBeInTheDocument();
  });

  it("salva titolo e spec senza includere il risultato", async () => {
    const spec: SpecQuery = { metrica: "ordinato", periodo: { anno: 2026 } };
    const spia = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/bi/analisi")) return risposta({ analisi: { id: "analisi-1" } });
      if (!init?.method) return risposta(VOCABOLARIO);
      return risposta({ risultato: risultato(spec) });
    });
    vi.stubGlobal("fetch", spia);
    render(<EditorAnalisi specIniziale={spec} titoloIniziale="Ordinato 2026" />);
    await completaCaricamentoIniziale(spia);

    fireEvent.click(screen.getByRole("button", { name: "Salva analisi" }));
    await act(async () => Promise.resolve());

    const chiamata = spia.mock.calls.find(([input]) => String(input).includes("/api/bi/analisi"));
    expect(chiamata).toBeDefined();
    const corpo = JSON.parse(String(chiamata?.[1]?.body)) as Record<string, unknown>;
    expect(corpo.titolo).toBe("Ordinato 2026");
    expect(corpo.spec).toEqual(spec);
    expect(corpo).not.toHaveProperty("risultato");
  });

  it("mostra senza riscriverlo il messaggio di validazione 422", async () => {
    const messaggio = "Il periodo iniziale non può essere successivo a quello finale.";
    const spia = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return risposta(VOCABOLARIO);
      return risposta({ error: messaggio }, false);
    });
    vi.stubGlobal("fetch", spia);
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} />);
    await act(async () => Promise.resolve());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await act(async () => Promise.resolve());

    expect(screen.getByRole("alert")).toHaveTextContent(messaggio);
  });
});
