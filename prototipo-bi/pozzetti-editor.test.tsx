/**
 * I pozzetti dentro l'editor vero: un gesto cambia la domanda e il riquadro si
 * ricalcola, albero e pozzetti restano la stessa selezione, il filtro nasce nel
 * riquadro «Solo dove» e la modifica a parole si riflette nei pozzetti.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorAnalisi } from "@/components/prototipo-bi/editor-analisi";
import { TIPO_MIME_CAMPO, type VoceCampo } from "@/components/prototipo-bi/pozzetti-regole";
import type { RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

vi.mock("@/components/prototipo-bi/grafico-da-risultato", () => ({
  GraficoDaRisultato: () => <div />,
  GraficoDaAnalisi: ({ serie }: { serie: Array<{ nome: string }> }) => <div data-testid="grafico">{serie.map((s) => s.nome).join(" | ")}</div>,
}));

const VOCABOLARIO = {
  tipologie: [
    { chiave: "ordinato", etichetta: "Ordinato", descrizione: "Ordini ricevuti.", metriche: ["ordinato", "n_ordini"] },
    { chiave: "fatturato", etichetta: "Fatturato", descrizione: "Fatture emesse.", metriche: ["fatturato"] },
  ],
  metriche: [
    { chiave: "ordinato", etichetta: "Valore ordinato", descrizione: "", unita: "euro" },
    { chiave: "n_ordini", etichetta: "Numero ordini", descrizione: "", unita: "numero" },
    { chiave: "fatturato", etichetta: "Valore fatturato", descrizione: "", unita: "euro" },
  ],
  dimensioni: [
    { chiave: "bu", etichetta: "Business unit" },
    { chiave: "agente", etichetta: "Agente" },
    { chiave: "cliente", etichetta: "Cliente" },
  ],
  dimensioniPerMetrica: {
    ordinato: ["bu", "agente", "cliente"],
    n_ordini: ["bu", "agente", "cliente"],
    fatturato: ["bu", "agente", "cliente"],
  },
  modificatori: [
    { chiave: "corrente", descrizione: "valore del periodo richiesto" },
    { chiave: "anno_precedente", descrizione: "stesso periodo dell’anno prima" },
  ],
  granularita: ["giorno", "settimana", "mese", "anno"],
};

function risposta(corpo: unknown, ok = true) {
  return { ok, json: async () => corpo };
}

function risultato(spec: SpecQuery): RisultatoQuery {
  return {
    spec,
    metrica: spec.metrica,
    unita: "euro",
    righe: [{ etichetta: "Totale", chiavi: {}, valore: 1000, conteggio: 1 }],
    totale: 1000,
    certificata: true,
    avvisi: [],
  };
}

function preparaFetch(modifica?: unknown) {
  const spia = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/bi/misure") return risposta({ error: "no" }, false);
    if (url === "/api/bi/riquadro/modifica") return risposta(modifica);
    if (url.includes("/api/bi/analisi")) return risposta({ analisi: { id: "a1" } });
    if (!init?.method) return risposta(VOCABOLARIO);
    const body = JSON.parse(String(init.body)) as { specs?: Array<{ id: string; spec: SpecQuery }> };
    return risposta({ risultati: (body.specs ?? []).map((s) => ({ id: s.id, risultato: risultato(s.spec) })) });
  });
  vi.stubGlobal("fetch", spia);
  return spia;
}

const batch = (spia: ReturnType<typeof preparaFetch>) =>
  spia.mock.calls
    .filter(([url, init]) => String(url) === "/api/bi/query" && init?.method === "POST")
    .map(([, init]) => (JSON.parse(String(init?.body)) as { specs: Array<{ spec: SpecQuery }> }).specs);
const ultimo = (spia: ReturnType<typeof preparaFetch>) => batch(spia).at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function carica() {
  await act(async () => Promise.resolve());
  await act(async () => Promise.resolve());
}

async function completaDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await act(async () => Promise.resolve());
}

function rilascia(pozzetto: string, voce: VoceCampo) {
  const dati: Record<string, string> = { [TIPO_MIME_CAMPO]: JSON.stringify(voce) };
  fireEvent.drop(screen.getByRole("region", { name: pozzetto }), {
    dataTransfer: { dropEffect: "", getData: (t: string) => dati[t] ?? "", setData: () => undefined },
  });
}

const misura = (chiave: string): VoceCampo => ({ tipo: "misura", chiave: chiave as never });

describe("pozzetti dentro l'editor", () => {
  it("dal nulla: una misura nei valori accende il riquadro e il risultato arriva", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi />);
    await carica();
    expect(batch(spia)).toHaveLength(0);

    rilascia("Valori", misura("ordinato"));
    await completaDebounce();

    expect(ultimo(spia)[0].spec.metrica).toBe("ordinato");
    expect(screen.getByRole("checkbox", { name: "Valore ordinato" })).toBeChecked();
    expect(within(screen.getByRole("region", { name: "Valori" })).getByText("Valore ordinato")).toBeInTheDocument();
  });

  it("una dimensione sull'asse ricalcola subito, e l'albero la mostra spuntata", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} />);
    await carica();
    await completaDebounce();

    rilascia("Asse", { tipo: "dimensione", chiave: "cliente" });
    await completaDebounce();

    expect(ultimo(spia)[0].spec.raggruppa).toEqual(["cliente"]);
    expect(screen.getByRole("checkbox", { name: "Cliente" })).toBeChecked();
    expect(within(screen.getByRole("region", { name: "Asse" })).getByText("Cliente")).toBeInTheDocument();
  });

  it("il tempo sull'asse e una dimensione in legenda: andamento per categoria", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} />);
    await carica();
    await completaDebounce();

    rilascia("Asse", { tipo: "calendario", chiave: "mese" });
    rilascia("Legenda", { tipo: "dimensione", chiave: "bu" });
    await completaDebounce();

    const spec = ultimo(spia)[0].spec;
    expect(spec.granularita).toBe("mese");
    expect(spec.raggruppa).toEqual(["bu"]);
  });

  it("una seconda misura nei valori finisce nello stesso riquadro come serie", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} />);
    await carica();
    await completaDebounce();

    rilascia("Valori", misura("fatturato"));
    await completaDebounce();

    const specs = ultimo(spia);
    expect(specs.map((s) => s.spec.metrica)).toEqual(["ordinato", "fatturato"]);
  });

  it("togliere un valore dal pozzetto toglie la serie", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} />);
    await carica();
    await completaDebounce();
    rilascia("Valori", misura("fatturato"));
    await completaDebounce();

    fireEvent.click(screen.getByRole("button", { name: "Togli Valore fatturato dai valori" }));
    await completaDebounce();
    expect(ultimo(spia).map((s) => s.spec.metrica)).toEqual(["ordinato"]);
  });

  it("un filtro nasce nel pozzetto e nel riquadro «Solo dove», pronto per scegliere i valori", async () => {
    preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} />);
    await carica();
    await completaDebounce();
    expect(screen.queryByLabelText("Dimensione filtro 1")).not.toBeInTheDocument();

    rilascia("Filtri", { tipo: "dimensione", chiave: "cliente" });

    expect(within(screen.getByRole("region", { name: "Filtri" })).getByText("Cliente: da scegliere")).toBeInTheDocument();
    expect((screen.getByLabelText("Dimensione filtro 1") as HTMLSelectElement).value).toBe("cliente");
    expect(screen.getByRole("button", { name: "Vai ai filtri" })).toBeInTheDocument();
  });

  it("togliere il chip del filtro lo toglie anche dal riquadro «Solo dove»", async () => {
    preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato", filtri: [{ campo: "cliente", op: "in", valore: ["Boni"] }] }} />);
    await carica();
    await completaDebounce();
    expect(screen.getByLabelText("Dimensione filtro 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Togli il filtro su Cliente" }));
    expect(screen.queryByLabelText("Dimensione filtro 1")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Filtri" })).queryByText(/Cliente:/)).not.toBeInTheDocument();
  });

  it("un gesto rifiutato non cambia il riquadro e dice perche'", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} />);
    await carica();
    await completaDebounce();
    const prima = batch(spia).length;

    rilascia("Valori", { tipo: "dimensione", chiave: "cliente" });
    await completaDebounce();

    expect(within(screen.getByRole("region", { name: "Valori" })).getByText("Valore ordinato")).toBeInTheDocument();
    expect(screen.getAllByRole("status").some((s) => /Nei valori vanno le misure/.test(s.textContent ?? ""))).toBe(true);
    expect(batch(spia).length).toBe(prima);
  });

  it("spuntare nell'albero o scegliere dal menu del pozzetto danno lo stesso riquadro", async () => {
    const dalMenu = preparaFetch();
    const { unmount } = render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} />);
    await carica();
    await completaDebounce();
    fireEvent.change(within(screen.getByRole("region", { name: "Asse" })).getByLabelText("Aggiungi a Asse"), { target: { value: "dimensione:agente" } });
    await completaDebounce();
    const specMenu = ultimo(dalMenu)[0].spec;
    unmount();

    const dalAlbero = preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} />);
    await carica();
    await completaDebounce();
    for (const gruppo of screen.getAllByRole("button", { expanded: false })) fireEvent.click(gruppo);
    fireEvent.click(screen.getByRole("checkbox", { name: "Agente" }));
    await completaDebounce();
    expect(ultimo(dalAlbero)[0].spec.raggruppa).toEqual(specMenu.raggruppa);
  });

  it("una modifica a parole si riflette nei pozzetti: il filtro appena applicato compare in «Filtri»", async () => {
    const proposto = {
      tipo: "modifica",
      stato: {
        titolo: "x",
        serie: [{ ruolo: "principale", nome: "Valore ordinato", spec: { metrica: "ordinato", filtri: [{ campo: "cliente", op: "eq", valore: "Boni" }] } }],
      },
      riepilogo: ["Filtro: Cliente = Boni"],
      ignorati: [],
      modelli: ["Haiku 5.5"],
      escalato: false,
      consumo: { tokenIngresso: 1, tokenUscita: 1, costoUsd: 0 },
    };
    preparaFetch(proposto);
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} titoloIniziale="x" />);
    await carica();
    await completaDebounce();

    fireEvent.change(screen.getByLabelText(/Cosa vuoi cambiare/), { target: { value: "filtra su Boni" } });
    fireEvent.click(screen.getByRole("button", { name: "Proponi la modifica" }));
    await carica();
    await carica();
    fireEvent.click(screen.getByRole("button", { name: "Applica la modifica" }));
    await carica();

    expect(within(screen.getByRole("region", { name: "Filtri" })).getByText("Cliente: Boni")).toBeInTheDocument();
  });
});
