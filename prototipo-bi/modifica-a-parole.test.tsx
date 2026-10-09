/**
 * «Modifica a parole», il componente: cosa si vede (cosa cambia, prima e dopo),
 * cosa si puo' fare (applicare, scartare, rispondere a una domanda) e, di piu',
 * cosa NON si puo' fare — applicare una modifica che il motore non riesce a
 * calcolare.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModificaAParole } from "@/components/prototipo-bi/modifica-a-parole";
import type { EsitoModificaAi } from "@/lib/prototipo-bi/modifica-riquadro-ai";
import type { StatoRiquadro } from "@/lib/prototipo-bi/modifica-riquadro";
import type { RisultatoQuery, SerieAnalisi, SerieAnalisiEseguita, SpecQuery } from "@/lib/prototipo-bi/tipi";

// I grafici veri non servono: conta quante serie e di che tipo vengono disegnate.
vi.mock("@/components/prototipo-bi/grafico-da-risultato", () => ({
  GraficoDaRisultato: () => <div />,
  GraficoDaAnalisi: ({ serie, tipo }: { serie: Array<{ nome: string }>; tipo: string }) => (
    <div data-testid="grafico" data-tipo={tipo}>
      {serie.map((s) => s.nome).join(" | ")}
    </div>
  ),
}));

function risultato(spec: SpecQuery, totale: number): RisultatoQuery {
  return {
    spec,
    metrica: spec.metrica,
    unita: "euro",
    righe: [
      { etichetta: "COMPONENTI", chiavi: { bu: "COMPONENTI" }, valore: totale * 0.6, conteggio: 1 },
      { etichetta: "IMPIANTI", chiavi: { bu: "IMPIANTI" }, valore: totale * 0.4, conteggio: 1 },
    ],
    totale,
    certificata: true,
    avvisi: [],
  };
}

const PRIMA: SerieAnalisi[] = [
  { ruolo: "principale", nome: "Ordinato", spec: { metrica: "ordinato", raggruppa: ["bu"] } },
  { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget", raggruppa: ["bu"] } },
];

const STATO: StatoRiquadro = { titolo: "Ordinato per business unit", serie: PRIMA };

const RISULTATI_PRIMA: SerieAnalisiEseguita[] = PRIMA.map((s, i) => ({ ...s, risultato: risultato(s.spec, i === 0 ? 1_000_000 : 1_200_000) }));

const NUOVO: StatoRiquadro = {
  titolo: "Ordinato per business unit",
  serie: [
    { ruolo: "principale", nome: "Ordinato", spec: { metrica: "ordinato", raggruppa: ["bu"], filtri: [{ campo: "cliente", op: "eq", valore: "Boni" }] } },
    { ruolo: "confronto", nome: "Anno precedente", spec: { metrica: "ordinato", raggruppa: ["bu"], modificatore: "anno_precedente", filtri: [{ campo: "cliente", op: "eq", valore: "Boni" }] } },
  ],
};

const MODIFICA: EsitoModificaAi = {
  tipo: "modifica",
  stato: NUOVO,
  riepilogo: ["Aggiungo il confronto «Anno precedente»", "Tolgo la serie «Budget»", "Filtro: Cliente = Boni"],
  ignorati: [],
  spiegazione: "Confronto con l'anno scorso, senza budget, solo Boni.",
  modelli: ["Haiku 5.5"],
  escalato: false,
  consumo: { tokenIngresso: 3200, tokenUscita: 180, costoUsd: 0.00041 },
};

function risposta(corpo: unknown, ok = true) {
  return { ok, json: async () => corpo };
}

interface Opzioni {
  esito?: unknown;
  statoModifica?: boolean;
  dopoFallisce?: boolean;
  dopoTotale?: number;
}

function preparaFetch(o: Opzioni = {}) {
  const spia = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/bi/riquadro/modifica") return risposta(o.esito ?? MODIFICA, o.statoModifica ?? true);
    if (url === "/api/bi/query") {
      if (o.dopoFallisce) return risposta({ error: "Metrica non calcolabile per questo perimetro." }, false);
      const body = JSON.parse(String(init?.body)) as { specs: Array<{ id: string; spec: SpecQuery }> };
      return risposta({ risultati: body.specs.map((s) => ({ id: s.id, risultato: risultato(s.spec, o.dopoTotale ?? 40_000) })) });
    }
    throw new Error(`URL inatteso: ${url}`);
  });
  vi.stubGlobal("fetch", spia);
  return spia;
}

function monta(over: Partial<React.ComponentProps<typeof ModificaAParole>> = {}) {
  const onApplica = vi.fn();
  const onAnnulla = vi.fn();
  render(
    <ModificaAParole
      stato={STATO}
      risultatiPrima={RISULTATI_PRIMA}
      graficoPrima="barre"
      aspetto={null}
      periodoEreditato={{ anno: 2026 }}
      onApplica={onApplica}
      puoAnnullare={false}
      onAnnulla={onAnnulla}
      {...over}
    />
  );
  return { onApplica, onAnnulla };
}

async function scrivi(testo: string) {
  fireEvent.change(screen.getByLabelText(/Cosa vuoi cambiare/), { target: { value: testo } });
  fireEvent.click(screen.getByRole("button", { name: "Proponi la modifica" }));
  await act(async () => Promise.resolve());
  await act(async () => Promise.resolve());
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ModificaAParole: una modifica valida", () => {
  it("manda la richiesta con lo stato attuale e mostra cosa cambia, il prima e il dopo con i totali", async () => {
    const spia = preparaFetch();
    monta();
    await scrivi("aggiungi il confronto con l'anno scorso, togli il budget, filtra su Boni");

    const chiamata = spia.mock.calls.find(([url]) => String(url) === "/api/bi/riquadro/modifica");
    const corpo = JSON.parse(String(chiamata?.[1]?.body)) as { testo: string; stato: StatoRiquadro };
    expect(corpo.testo).toContain("anno scorso");
    expect(corpo.stato.serie.map((s) => s.nome)).toEqual(["Ordinato", "Budget"]);

    const elenco = screen.getByRole("list", { name: "Modifiche proposte" });
    expect(within(elenco).getAllByRole("listitem").map((li) => li.textContent)).toEqual(MODIFICA.riepilogo);
    expect(screen.getByText(/senza budget, solo Boni/)).toBeInTheDocument();

    const prima = screen.getByRole("figure", { name: "Prima" });
    const dopo = screen.getByRole("figure", { name: "Dopo" });
    expect(within(prima).getByTestId("grafico")).toHaveTextContent("Ordinato | Budget");
    expect(within(prima).getByText("1.000.000 €")).toBeInTheDocument();
    // Il dopo e' calcolato dal motore sul nuovo stato: stesse serie della proposta.
    expect(within(dopo).getByTestId("grafico")).toHaveTextContent("Ordinato | Anno precedente");
    expect(within(dopo).getByText("40.000 €")).toBeInTheDocument();
    expect(screen.getByText(/Preparata da Haiku 5.5/)).toBeInTheDocument();
  });

  it("il dopo si calcola con la query di sempre, passando tutte le serie del nuovo stato", async () => {
    const spia = preparaFetch();
    monta();
    await scrivi("aggiungi il confronto con l'anno scorso");
    const query = spia.mock.calls.find(([url]) => String(url) === "/api/bi/query");
    const corpo = JSON.parse(String(query?.[1]?.body)) as { specs: Array<{ spec: SpecQuery }> };
    expect(corpo.specs).toHaveLength(2);
    expect(corpo.specs[1].spec.modificatore).toBe("anno_precedente");
    expect(corpo.specs[0].spec.filtri).toEqual([{ campo: "cliente", op: "eq", valore: "Boni" }]);
  });

  it("«Applica la modifica» passa il nuovo stato al chiamante e lo dice; niente e' applicato prima", async () => {
    preparaFetch();
    const { onApplica } = monta();
    await scrivi("aggiungi il confronto con l'anno scorso");
    expect(onApplica).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Applica la modifica" }));
    expect(onApplica).toHaveBeenCalledTimes(1);
    expect(onApplica).toHaveBeenCalledWith(NUOVO);
    expect(screen.getByRole("status")).toHaveTextContent("Modifica applicata");
    expect(screen.queryByRole("figure", { name: "Dopo" })).not.toBeInTheDocument();
  });

  it("«Scarta» non applica niente e torna a scrivere", async () => {
    preparaFetch();
    const { onApplica } = monta();
    await scrivi("aggiungi il confronto con l'anno scorso");
    fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
    expect(onApplica).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Cosa vuoi cambiare/)).toBeInTheDocument();
    expect(screen.queryByRole("figure", { name: "Dopo" })).not.toBeInTheDocument();
  });

  it("le cose non applicate a qualche serie si dicono accanto alla proposta", async () => {
    preparaFetch({ esito: { ...MODIFICA, ignorati: ["Il filtro «Cliente = Boni» non si applica a «Budget»: il budget esiste solo per business unit e agente."] } });
    monta();
    await scrivi("filtra su Boni");
    const note = screen.getByRole("list", { name: "Cose non applicate" });
    expect(note).toHaveTextContent("non si applica a «Budget»");
  });

  it("un grafico chiesto che non si adatta ai nuovi dati lo dice, e resta quello che regge", async () => {
    // Il dopo ha una sola categoria raggruppata e due serie: la torta non regge.
    preparaFetch({ esito: { ...MODIFICA, stato: { ...NUOVO, grafico: "torta" } } });
    monta();
    await scrivi("mostralo a torta");
    expect(screen.getByText(/non si adatta ai nuovi dati/)).toBeInTheDocument();
    expect(within(screen.getByRole("figure", { name: "Dopo" })).getByTestId("grafico").dataset.tipo).not.toBe("torta");
  });
});

describe("ModificaAParole: cio' che NON si applica", () => {
  it("se il motore non riesce a calcolare il dopo, la modifica non si puo' applicare", async () => {
    preparaFetch({ dopoFallisce: true });
    const { onApplica } = monta();
    await scrivi("aggiungi il confronto con l'anno scorso");

    expect(within(screen.getByRole("figure", { name: "Dopo" })).getByRole("alert")).toHaveTextContent("Metrica non calcolabile");
    const applica = screen.getByRole("button", { name: "Applica la modifica" });
    expect(applica).toBeDisabled();
    fireEvent.click(applica);
    expect(onApplica).not.toHaveBeenCalled();
  });

  it("un rifiuto del server si legge com'e', col suggerimento, e si puo' riprovare", async () => {
    preparaFetch({ esito: { error: "Non sono riuscito a tradurre la richiesta.", suggerimento: "Riformula." }, statoModifica: false });
    monta();
    await scrivi("qualcosa di impossibile qui");
    expect(screen.getByRole("alert")).toHaveTextContent("Non sono riuscito a tradurre la richiesta. Riformula.");
    expect(screen.getByRole("button", { name: "Proponi la modifica" })).toBeEnabled();
  });

  it("un rifiuto motivato (cosa le operazioni non sanno fare) si mostra e non propone niente", async () => {
    preparaFetch({ esito: { tipo: "non_possibile", motivo: "I colori si scelgono dal pannello Aspetto.", modelli: ["Haiku 5.5"], escalato: false, consumo: { tokenIngresso: 1, tokenUscita: 1, costoUsd: 0 } } });
    monta();
    await scrivi("metti le barre in rosso");
    expect(screen.getByRole("status")).toHaveTextContent("pannello Aspetto");
    expect(screen.queryByRole("button", { name: "Applica la modifica" })).not.toBeInTheDocument();
  });

  it("«gia' cosi'» lo dice, con il perche'", async () => {
    preparaFetch({ esito: { tipo: "invariato", ignorati: ["«Budget» e' gia' nel riquadro: non l'ho aggiunta due volte."], modelli: ["Haiku 5.5"], escalato: false, consumo: { tokenIngresso: 1, tokenUscita: 1, costoUsd: 0 } } });
    monta();
    await scrivi("aggiungi il budget");
    expect(screen.getByRole("status")).toHaveTextContent("già così");
    expect(screen.getByText(/gia' nel riquadro/)).toBeInTheDocument();
  });

  it("le richieste troppo corte non partono", () => {
    const spia = preparaFetch();
    monta();
    fireEvent.change(screen.getByLabelText(/Cosa vuoi cambiare/), { target: { value: "ok" } });
    expect(screen.getByRole("button", { name: "Proponi la modifica" })).toBeDisabled();
    expect(spia).not.toHaveBeenCalled();
  });
});

describe("ModificaAParole: una domanda dell'assistente", () => {
  it("la risposta si unisce alla richiesta originale e la richiesta riparte", async () => {
    const spia = preparaFetch({
      esito: { tipo: "chiarimento", chiarimento: "Boni è un cliente o un agente?", modelli: ["Haiku 5.5"], escalato: false, consumo: { tokenIngresso: 1, tokenUscita: 1, costoUsd: 0 } },
    });
    monta();
    await scrivi("filtra su Boni");
    expect(screen.getByRole("status")).toHaveTextContent("cliente o un agente");

    fireEvent.change(screen.getByLabelText("La tua risposta"), { target: { value: "un cliente" } });
    fireEvent.click(screen.getByRole("button", { name: "Rispondi" }));
    await act(async () => Promise.resolve());

    const chiamate = spia.mock.calls.filter(([url]) => String(url) === "/api/bi/riquadro/modifica");
    expect(chiamate).toHaveLength(2);
    expect(JSON.parse(String(chiamate[1][1]?.body)).testo).toBe("filtra su Boni — un cliente");
  });
});

describe("ModificaAParole: tastiera e annullamento", () => {
  it("Invio propone, Maiusc+Invio va a capo", async () => {
    const spia = preparaFetch();
    monta();
    const campo = screen.getByLabelText(/Cosa vuoi cambiare/);
    fireEvent.change(campo, { target: { value: "togli il budget" } });
    fireEvent.keyDown(campo, { key: "Enter", shiftKey: true });
    expect(spia).not.toHaveBeenCalled();
    fireEvent.keyDown(campo, { key: "Enter" });
    await act(async () => Promise.resolve());
    expect(spia.mock.calls.some(([url]) => String(url) === "/api/bi/riquadro/modifica")).toBe(true);
  });

  it("«Annulla l'ultima modifica» compare solo quando c'e' qualcosa da annullare, e chiama il chiamante", () => {
    const { onAnnulla } = monta({ puoAnnullare: false });
    expect(screen.queryByRole("button", { name: /Annulla l’ultima modifica/ })).not.toBeInTheDocument();
    cleanupMonta();
    const { onAnnulla: onAnnulla2 } = monta({ puoAnnullare: true });
    fireEvent.click(screen.getByRole("button", { name: /Annulla l’ultima modifica/ }));
    expect(onAnnulla2).toHaveBeenCalledTimes(1);
    expect(onAnnulla).not.toHaveBeenCalled();
  });
});

function cleanupMonta() {
  document.body.innerHTML = "";
}
