/**
 * La modifica a parole dentro l'editor vero: cosa succede al riquadro DOPO
 * «Applica» (le serie derivate seguono ancora la principale, il nome e le
 * differenze di tabella restano coerenti, il titolo cambia solo se richiesto) e
 * che «Annulla» riporti tutto com'era.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorAnalisi } from "@/components/prototipo-bi/editor-analisi";
import type { StatoRiquadro } from "@/lib/prototipo-bi/modifica-riquadro";
import type { AspettoGrafico, RisultatoQuery, SerieAnalisi, SpecQuery } from "@/lib/prototipo-bi/tipi";

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
    { chiave: "ordinato", etichetta: "Ordinato", descrizione: "", unita: "euro" },
    { chiave: "n_ordini", etichetta: "Numero ordini", descrizione: "", unita: "numero" },
    { chiave: "fatturato", etichetta: "Fatturato", descrizione: "", unita: "euro" },
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

const PRINCIPALE: SpecQuery = { metrica: "ordinato", raggruppa: ["bu"], periodo: { anno: 2026 } };
const SERIE_INIZIALI: SerieAnalisi[] = [
  { ruolo: "principale", nome: "Ordinato", spec: PRINCIPALE },
  { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget", raggruppa: ["bu"], periodo: { anno: 2026 } } },
];

const FILTRO_BONI = [{ campo: "cliente" as const, op: "eq" as const, valore: "Boni" }];

/** Lo stato che l'assistente propone per «aggiungi il confronto con l'anno scorso, togli il budget, filtra su Boni». */
function statoProposto(over: Partial<StatoRiquadro> = {}): StatoRiquadro {
  return {
    titolo: "Ordinato per business unit",
    serie: [
      { ruolo: "principale", nome: "Ordinato", spec: { ...PRINCIPALE, filtri: FILTRO_BONI } },
      { ruolo: "confronto", nome: "Anno precedente", spec: { ...PRINCIPALE, modificatore: "anno_precedente", filtri: FILTRO_BONI } },
    ],
    ...over,
  };
}

function risposta(corpo: unknown, ok = true) {
  return { ok, json: async () => corpo };
}

function risultato(spec: SpecQuery): RisultatoQuery {
  return {
    spec,
    metrica: spec.metrica,
    unita: "euro",
    righe: [
      { etichetta: "COMPONENTI", chiavi: { bu: "COMPONENTI" }, valore: 600, conteggio: 1 },
      { etichetta: "IMPIANTI", chiavi: { bu: "IMPIANTI" }, valore: 400, conteggio: 1 },
    ],
    totale: 1000,
    certificata: true,
    avvisi: [],
  };
}

function preparaFetch(proposto: StatoRiquadro) {
  const spia = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/bi/misure") return risposta({ error: "no" }, false);
    if (url === "/api/bi/riquadro/modifica") {
      return risposta({
        tipo: "modifica",
        stato: proposto,
        riepilogo: ["Aggiungo il confronto «Anno precedente»", "Tolgo la serie «Budget»", "Filtro: Cliente = Boni"],
        ignorati: [],
        modelli: ["Haiku 5.5"],
        escalato: false,
        consumo: { tokenIngresso: 3000, tokenUscita: 150, costoUsd: 0.0004 },
      });
    }
    if (url.includes("/api/bi/analisi")) return risposta({ analisi: { id: "analisi-1" } });
    if (!init?.method) return risposta(VOCABOLARIO);
    const body = JSON.parse(String(init.body)) as { specs?: Array<{ id: string; spec: SpecQuery }> };
    return risposta({ risultati: (body.specs ?? []).map((s) => ({ id: s.id, risultato: risultato(s.spec) })) });
  });
  vi.stubGlobal("fetch", spia);
  return spia;
}

function batch(spia: ReturnType<typeof preparaFetch>): Array<Array<{ spec: SpecQuery }>> {
  return spia.mock.calls
    .filter(([url, init]) => String(url) === "/api/bi/query" && init?.method === "POST")
    .map(([, init]) => (JSON.parse(String(init?.body)) as { specs: Array<{ spec: SpecQuery }> }).specs);
}

const ultimoBatch = (spia: ReturnType<typeof preparaFetch>) => batch(spia).at(-1)!;

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

function apriAParole() {
  const bottone = screen.getByRole("button", { name: "A parole" });
  if (bottone.getAttribute("aria-expanded") !== "true") fireEvent.click(bottone);
}

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

function monta(aspetto?: AspettoGrafico) {
  render(
    <EditorAnalisi
      specIniziale={PRINCIPALE}
      serieIniziali={SERIE_INIZIALI}
      titoloIniziale="Ordinato per business unit"
      aspettoIniziale={aspetto ?? null}
      periodoEreditato={{ anno: 2026 }}
    />
  );
}

async function proponiEApplica(testo = "aggiungi il confronto con l'anno scorso, togli il budget, filtra su Boni") {
  apriAParole();
  fireEvent.change(screen.getByLabelText(/Cosa vuoi cambiare/), { target: { value: testo } });
  fireEvent.click(screen.getByRole("button", { name: "Proponi la modifica" }));
  await carica();
  await carica();
  fireEvent.click(screen.getByRole("button", { name: "Applica la modifica" }));
  await carica();
  await completaDebounce();
}

describe("modifica a parole dentro l'editor", () => {
  it("applicando, il riquadro ricalcola con le serie e i filtri nuovi, senza il budget", async () => {
    const spia = preparaFetch(statoProposto());
    monta();
    await carica();
    await completaDebounce();
    expect(ultimoBatch(spia).map((s) => s.spec.metrica)).toEqual(["ordinato", "budget"]);

    await proponiEApplica();

    const specs = ultimoBatch(spia);
    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.spec.metrica)).toEqual(["ordinato", "ordinato"]);
    expect(specs[1].spec.modificatore).toBe("anno_precedente");
    for (const s of specs) expect(s.spec.filtri).toEqual(FILTRO_BONI);
    expect(screen.getByRole("button", { name: /Annulla l’ultima modifica/ })).toBeInTheDocument();
    expect(screen.getByText(/Modifica applicata/)).toBeInTheDocument();
  });

  it("senza «Applica» il riquadro non cambia: le serie restano quelle di prima", async () => {
    preparaFetch(statoProposto());
    monta();
    await carica();
    await completaDebounce();
    // Prima: c'e' il budget fra le serie aggiunte, non c'e' l'anno precedente.
    fireEvent.click(screen.getByRole("tab", { name: "Confronti" }));
    expect(screen.getByRole("button", { name: "Rimuovi serie Budget" })).toBeInTheDocument();

    apriAParole();

    fireEvent.change(screen.getByLabelText(/Cosa vuoi cambiare/), { target: { value: "togli il budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Proponi la modifica" }));
    await carica();
    await carica();
    // La proposta e' sullo schermo, ma il riquadro vero e' ancora quello di prima.
    expect(screen.getByRole("figure", { name: "Dopo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Confronti" }));
    expect(screen.getByRole("button", { name: "Rimuovi serie Budget" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
    await completaDebounce();
    fireEvent.click(screen.getByRole("tab", { name: "Confronti" }));
    expect(screen.getByRole("button", { name: "Rimuovi serie Budget" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Confronti" }));
    expect(screen.queryByRole("button", { name: /Rimuovi serie Anno precedente/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Annulla l’ultima modifica/ })).not.toBeInTheDocument();
  });

  it("l'anno precedente adottato resta una scorciatoia: segue la principale quando si cambia suddivisione", async () => {
    const spia = preparaFetch(statoProposto());
    monta();
    await carica();
    await completaDebounce();
    await proponiEApplica();

    // Si aggiunge «Agente» dall'albero: la serie derivata deve seguire la principale.
    for (const gruppo of screen.getAllByRole("button", { expanded: false })) fireEvent.click(gruppo);
    fireEvent.click(screen.getByRole("checkbox", { name: "Agente" }));
    await completaDebounce();

    const specs = ultimoBatch(spia);
    expect(specs).toHaveLength(2);
    expect(specs[0].spec.raggruppa).toEqual(["bu", "agente"]);
    expect(specs[1].spec.modificatore).toBe("anno_precedente");
    expect(specs[1].spec.raggruppa).toEqual(["bu", "agente"]);
    // E il filtro della modifica non e' andato perso.
    expect(specs[1].spec.filtri).toEqual(FILTRO_BONI);
  });

  it("«Annulla l'ultima modifica» riporta serie, filtri e budget com'erano, e il bottone sparisce", async () => {
    const spia = preparaFetch(statoProposto());
    monta();
    await carica();
    await completaDebounce();
    await proponiEApplica();

    fireEvent.click(screen.getByRole("button", { name: /Annulla l’ultima modifica/ }));
    await completaDebounce();

    const specs = ultimoBatch(spia);
    expect(specs.map((s) => s.spec.metrica)).toEqual(["ordinato", "budget"]);
    // Il validatore delle query mette l'elenco vuoto: nessun filtro.
    expect(specs[0].spec.filtri ?? []).toEqual([]);
    expect(screen.queryByRole("button", { name: /Annulla l’ultima modifica/ })).not.toBeInTheDocument();
  });

  it("piu' modifiche si annullano una alla volta, dall'ultima", async () => {
    const spia = preparaFetch(statoProposto());
    monta();
    await carica();
    await completaDebounce();
    await proponiEApplica();
    await proponiEApplica();

    fireEvent.click(screen.getByRole("button", { name: /Annulla l’ultima modifica/ }));
    await completaDebounce();
    // Dopo il primo annulla c'e' ancora la prima modifica applicata.
    expect(ultimoBatch(spia).map((s) => s.spec.modificatore ?? "corrente")).toEqual(["corrente", "anno_precedente"]);

    fireEvent.click(screen.getByRole("button", { name: /Annulla l’ultima modifica/ }));
    await completaDebounce();
    expect(ultimoBatch(spia).map((s) => s.spec.metrica)).toEqual(["ordinato", "budget"]);
    expect(screen.queryByRole("button", { name: /Annulla l’ultima modifica/ })).not.toBeInTheDocument();
  });

  it("il titolo cambia solo se la modifica lo chiede, e poi non lo riscrive la domanda", async () => {
    preparaFetch(statoProposto({ titolo: "Ordinato di Boni" }));
    monta();
    await carica();
    await completaDebounce();
    await proponiEApplica("filtra su Boni e chiamalo Ordinato di Boni");
    expect(screen.getByLabelText("Titolo del riquadro")).toHaveValue("Ordinato di Boni");

    fireEvent.click(screen.getByRole("button", { name: /Annulla l’ultima modifica/ }));
    await completaDebounce();
    expect(screen.getByLabelText("Titolo del riquadro")).toHaveValue("Ordinato per business unit");
  });

  it("un titolo non toccato dalla modifica resta quello di prima", async () => {
    preparaFetch(statoProposto());
    monta();
    await carica();
    await completaDebounce();
    await proponiEApplica();
    expect(screen.getByLabelText("Titolo del riquadro")).toHaveValue("Ordinato per business unit");
  });

  it("la misura principale cambiata da una modifica porta il suo nome, e si salva con quello", async () => {
    const proposto: StatoRiquadro = {
      titolo: "Ordinato per business unit",
      serie: [
        { ruolo: "principale", nome: "Fatturato", spec: { metrica: "fatturato", raggruppa: ["bu"], periodo: { anno: 2026 } } },
        { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget", raggruppa: ["bu"], periodo: { anno: 2026 } } },
      ],
    };
    const spia = preparaFetch(proposto);
    monta();
    await carica();
    await completaDebounce();
    await proponiEApplica("usa il fatturato invece dell'ordinato");

    fireEvent.click(screen.getByRole("button", { name: "Salva il riquadro" }));
    await act(async () => Promise.resolve());
    const salvataggio = spia.mock.calls.find(([url]) => String(url).includes("/api/bi/analisi"));
    const corpo = JSON.parse(String(salvataggio?.[1]?.body)) as { spec: SpecQuery; serie: Array<{ nome: string; ruolo: string }> };
    expect(corpo.spec.metrica).toBe("fatturato");
    expect(corpo.serie[0]).toMatchObject({ ruolo: "principale", nome: "Fatturato" });
  });

  it("le differenze della tabella seguono le serie: quella verso il budget tolto sparisce", async () => {
    const spia = preparaFetch(statoProposto());
    monta({ tabella: { differenze: [{ da: 0, con: 1 }], totale: "somma" } });
    await carica();
    await completaDebounce();
    await proponiEApplica();

    fireEvent.click(screen.getByRole("button", { name: "Salva il riquadro" }));
    await act(async () => Promise.resolve());
    const salvataggio = spia.mock.calls.find(([url]) => String(url).includes("/api/bi/analisi"));
    const corpo = JSON.parse(String(salvataggio?.[1]?.body)) as { aspetto: AspettoGrafico | null };
    // Prima la differenza era Ordinato − Budget; il budget non c'e' piu'.
    expect(corpo.aspetto?.tabella?.differenze).toEqual([]);
    expect(corpo.aspetto?.tabella?.totale).toBe("somma");
  });

  it("applicare segna il riquadro come da salvare", async () => {
    preparaFetch(statoProposto());
    monta();
    await carica();
    await completaDebounce();
    // Prima del cambio il bottone di salvataggio e' quello normale.
    expect(screen.getByRole("button", { name: "Salva il riquadro" })).toBeEnabled();
    await proponiEApplica();
    expect(screen.getByRole("button", { name: "Salva il riquadro" })).toBeEnabled();
  });
});
