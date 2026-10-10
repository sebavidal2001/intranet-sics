/**
 * Le misure personalizzate nell'interfaccia: il gruppo nell'albero, la
 * creazione a parole, l'uso in un riquadro e, soprattutto, i casi in cui una
 * misura NON deve restare attaccata a una domanda che non e' piu' la sua.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorAnalisi } from "@/components/prototipo-bi/editor-analisi";
import { CreaMisura } from "@/components/prototipo-bi/crea-misura";
import { validaMisura } from "@/lib/prototipo-bi/misure";
import type { MisuraSalvata } from "@/lib/prototipo-bi/misure-catalogo";
import type { EsitoProposta } from "@/lib/prototipo-bi/proposta-misura";
import type { RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

const VOCABOLARIO = {
  tipologie: [
    { chiave: "ordinato", etichetta: "Ordinato", descrizione: "Ordini ricevuti.", metriche: ["ordinato", "n_ordini"] },
    { chiave: "fatturato", etichetta: "Fatturato", descrizione: "Fatture emesse.", metriche: ["fatturato", "margine"] },
  ],
  metriche: [
    { chiave: "ordinato", etichetta: "Valore ordinato", descrizione: "", unita: "euro" },
    { chiave: "n_ordini", etichetta: "Numero ordini", descrizione: "", unita: "numero" },
    { chiave: "fatturato", etichetta: "Valore fatturato", descrizione: "", unita: "euro" },
    { chiave: "margine", etichetta: "Margine", descrizione: "", unita: "euro" },
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
    margine: ["bu", "agente", "cliente"],
  },
  modificatori: [
    { chiave: "corrente", descrizione: "valore del periodo richiesto" },
    { chiave: "anno_precedente", descrizione: "stesso periodo dell’anno prima" },
    { chiave: "progressivo", descrizione: "cumulato dall’inizio dell’anno" },
  ],
  granularita: ["giorno", "settimana", "mese", "anno"],
};

const DEFINIZIONE = validaMisura({
  id: "11111111-1111-4111-8111-111111111111",
  versione: 1,
  nome: "Margine componenti sul fatturato",
  espressione: {
    tipo: "rapporto",
    numeratore: { metrica: "margine", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
    denominatore: { metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
  },
});

function salvata(autoreId = "u1"): MisuraSalvata {
  return {
    id: DEFINIZIONE.id!,
    nome: DEFINIZIONE.nome,
    descrizione: "Margine (Business unit = COMPONENTI) diviso Fatturato (Business unit = COMPONENTI), in percentuale",
    versione: 1,
    sostituisceId: null,
    autoreId,
    autoreNome: "Anna Rossi",
    creatoIl: "2026-10-09T08:00:00.000Z",
    misura: DEFINIZIONE,
  };
}

function risultato(spec: SpecQuery): RisultatoQuery {
  return {
    spec,
    metrica: spec.metrica,
    unita: spec.misura ? "percentuale" : "euro",
    righe: [{ etichetta: "Totale", chiavi: {}, valore: 40, conteggio: 1 }],
    totale: 40,
    certificata: true,
    avvisi: [],
  };
}

function risposta(corpo: unknown, ok = true) {
  return { ok, json: async () => corpo };
}

interface Opzioni {
  misure?: MisuraSalvata[];
  utenteId?: string;
  gestisceTutte?: boolean;
  proposta?: EsitoProposta;
}

function preparaFetch(opzioni: Opzioni = {}) {
  let misure = opzioni.misure ?? [];
  const spia = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/bi/misure" && !init?.method) {
      return risposta({ misure, utenteId: opzioni.utenteId ?? "u1", puoGestireTutte: opzioni.gestisceTutte ?? false });
    }
    if (url === "/api/bi/misure/proponi") return risposta(opzioni.proposta ?? {});
    if (url === "/api/bi/misure" && init?.method === "POST") {
      const corpo = JSON.parse(String(init.body)) as { misura: { nome: string } };
      const nuova = { ...salvata(), nome: corpo.misura.nome };
      misure = [nuova, ...misure];
      return risposta({ misura: nuova }, true);
    }
    if (url.startsWith("/api/bi/misure/") && init?.method === "DELETE") {
      misure = misure.filter((m) => !url.endsWith(m.id));
      return risposta({ ok: true });
    }
    if (url.includes("/api/bi/analisi")) return risposta({ analisi: { id: "analisi-1" } });
    if (!init?.method) return risposta(VOCABOLARIO);
    const body = JSON.parse(String(init.body)) as { specs?: Array<{ id: string; spec: SpecQuery }> };
    return risposta({ risultati: (body.specs ?? []).map((v) => ({ id: v.id, risultato: risultato(v.spec) })) });
  });
  vi.stubGlobal("fetch", spia);
  return spia;
}

function specInviate(spia: ReturnType<typeof preparaFetch>): SpecQuery[] {
  return spia.mock.calls
    .filter(([url, init]) => String(url) === "/api/bi/query" && init?.method === "POST")
    .flatMap(([, init]) => (JSON.parse(String(init?.body)) as { specs: Array<{ spec: SpecQuery }> }).specs.map((s) => s.spec));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "IntersectionObserver",
    class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
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

function apriGruppoMisure() {
  fireEvent.click(screen.getByRole("button", { name: /Misure personalizzate/ }));
}

describe("albero dei campi con le misure", () => {
  it("le misure del catalogo compaiono in un gruppo a parte, con la definizione in parole", async () => {
    preparaFetch({ misure: [salvata()] });
    render(<EditorAnalisi />);
    await carica();

    apriGruppoMisure();
    const casella = screen.getByRole("checkbox", { name: /^Margine componenti sul fatturato/ });
    expect(casella).not.toBeChecked();
    expect(screen.getByText(/diviso Fatturato \(Business unit = COMPONENTI\), in percentuale/)).toBeInTheDocument();
  });

  it("senza misure il gruppo non c'e' e il bottone per crearne una si', sempre", async () => {
    preparaFetch();
    render(<EditorAnalisi />);
    await carica();
    expect(screen.queryByRole("button", { name: /Misure personalizzate/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuova misura a parole" })).toBeInTheDocument();
  });

  it("spuntare una misura manda al motore la sua definizione, e il titolo e' il suo nome", async () => {
    const spia = preparaFetch({ misure: [salvata()] });
    render(<EditorAnalisi />);
    await carica();

    apriGruppoMisure();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Margine componenti sul fatturato/ }));
    await completaDebounce();

    const inviate = specInviate(spia);
    expect(inviate.length).toBeGreaterThan(0);
    const ultima = inviate.at(-1)!;
    expect(ultima.misura?.nome).toBe("Margine componenti sul fatturato");
    expect(ultima.misura?.id).toBe(DEFINIZIONE.id);
    expect(screen.getByDisplayValue("Margine componenti sul fatturato")).toBeInTheDocument();
  });

  it("una misura si suddivide solo per le dimensioni che tutti i suoi operandi ammettono", async () => {
    preparaFetch({ misure: [salvata()] });
    render(<EditorAnalisi />);
    await carica();
    apriGruppoMisure();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Margine componenti sul fatturato/ }));
    await completaDebounce();
    // Si aprono i gruppi delle suddivisioni: bu, agente e cliente sono ammesse
    // da entrambi gli operandi, quindi spuntabili.
    for (const gruppo of screen.getAllByRole("button", { expanded: false })) fireEvent.click(gruppo);
    expect(screen.getByRole("checkbox", { name: "Business unit" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Agente" })).toBeEnabled();
  });

  it("riaprendo un riquadro con una misura, questa risulta spuntata anche se il catalogo e' vuoto", async () => {
    preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "margine", misura: DEFINIZIONE }} />);
    await carica();
    expect(screen.getByRole("checkbox", { name: /^Margine componenti sul fatturato/ })).toBeChecked();
  });

  it("il cestino compare solo sulle proprie misure, o su tutte per la direzione", async () => {
    preparaFetch({ misure: [salvata("altro-utente")], utenteId: "u1", gestisceTutte: false });
    const { unmount } = render(<EditorAnalisi />);
    await carica();
    apriGruppoMisure();
    expect(screen.queryByRole("button", { name: /Togli la misura/ })).not.toBeInTheDocument();
    unmount();

    preparaFetch({ misure: [salvata("altro-utente")], utenteId: "u1", gestisceTutte: true });
    render(<EditorAnalisi />);
    await carica();
    apriGruppoMisure();
    expect(screen.getByRole("button", { name: /Togli la misura/ })).toBeInTheDocument();
  });

  it("togliere una misura chiede conferma, la archivia e riaggiorna l'elenco", async () => {
    const spia = preparaFetch({ misure: [salvata("u1")], utenteId: "u1" });
    const conferma = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<EditorAnalisi />);
    await carica();
    apriGruppoMisure();

    fireEvent.click(screen.getByRole("button", { name: /Togli la misura/ }));
    await carica();

    expect(conferma).toHaveBeenCalledWith(expect.stringContaining("continuano a funzionare"));
    expect(spia).toHaveBeenCalledWith(`/api/bi/misure/${DEFINIZIONE.id}`, expect.objectContaining({ method: "DELETE" }));
    expect(screen.queryByRole("button", { name: /Misure personalizzate/ })).not.toBeInTheDocument();
  });

  it("se non si conferma non si tocca niente", async () => {
    const spia = preparaFetch({ misure: [salvata("u1")], utenteId: "u1" });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<EditorAnalisi />);
    await carica();
    apriGruppoMisure();
    fireEvent.click(screen.getByRole("button", { name: /Togli la misura/ }));
    await carica();
    expect(spia.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
});

describe("una misura non resta attaccata a una domanda che non e' piu' la sua", () => {
  it("«Un'altra metrica» come confronto parte senza la misura della principale", async () => {
    const spia = preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "margine", misura: DEFINIZIONE }} />);
    await carica();
    await completaDebounce();

    fireEvent.click(screen.getByRole("tab", { name: "Confronti" }));
    fireEvent.click(screen.getByRole("button", { name: /Un’altra metrica/ }));
    fireEvent.change(screen.getByLabelText("Metrica di confronto"), { target: { value: "fatturato" } });
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi confronto" }));
    await completaDebounce();

    const ultimoBatch = spia.mock.calls
      .filter(([url, init]) => String(url) === "/api/bi/query" && init?.method === "POST")
      .map(([, init]) => (JSON.parse(String(init?.body)) as { specs: Array<{ spec: SpecQuery }> }).specs)
      .find((specs) => specs.length === 2);
    expect(ultimoBatch).toBeDefined();
    expect(ultimoBatch![0].spec.misura?.nome).toBe("Margine componenti sul fatturato");
    expect(ultimoBatch![1].spec.metrica).toBe("fatturato");
    expect(ultimoBatch![1].spec.misura).toBeUndefined();
  });

  it("il progressivo e' spento per una misura, con la ragione, e acceso per una metrica", async () => {
    preparaFetch();
    const { unmount } = render(<EditorAnalisi specIniziale={{ metrica: "margine", misura: DEFINIZIONE }} />);
    await carica();
    fireEvent.click(screen.getByRole("tab", { name: "Confronti" }));
    expect(screen.getByRole("button", { name: "Progressivo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Progressivo" })).toHaveAttribute("title", expect.stringContaining("misure personalizzate"));
    // Anche dal menu del valore, il periodo «progressivo» e' spento per una misura.
    fireEvent.click(screen.getByRole("tab", { name: "Campi" }));
    fireEvent.click(screen.getByRole("button", { name: /^Calcolo e periodo di/ }));
    const progressivi = within(screen.getByRole("group", { name: /^Calcolo e periodo di/ })).getAllByRole("button", { name: /progressivo/i });
    expect(progressivi.length).toBeGreaterThan(0);
    progressivi.forEach((bottone) => expect(bottone).toBeDisabled());
    unmount();

    preparaFetch();
    render(<EditorAnalisi specIniziale={{ metrica: "ordinato" }} />);
    await carica();
    fireEvent.click(screen.getByRole("tab", { name: "Confronti" }));
    expect(screen.getByRole("button", { name: "Progressivo" })).toBeEnabled();
  });

  it("passando da una misura a una metrica la misura sparisce dalla spec", async () => {
    const spia = preparaFetch({ misure: [salvata()] });
    render(<EditorAnalisi specIniziale={{ metrica: "margine", misura: DEFINIZIONE }} />);
    await carica();
    await completaDebounce();

    // Si toglie la misura e si spunta una metrica semplice.
    fireEvent.click(screen.getByRole("checkbox", { name: /^Margine componenti sul fatturato/ }));
    // C'e' gia' una misura scelta: si apre il gruppo «Ordinato», dove sta il valore.
    fireEvent.click(screen.getByRole("button", { name: /^Ordinato/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Valore ordinato" }));
    await completaDebounce();

    const ultima = specInviate(spia).at(-1)!;
    expect(ultima.metrica).toBe("ordinato");
    expect(ultima.misura).toBeUndefined();
  });
});

describe("«Nuova misura a parole»", () => {
  const PROPOSTA: EsitoProposta = {
    tipo: "misura",
    misura: DEFINIZIONE,
    descrizione: "Margine (Business unit = COMPONENTI) diviso Fatturato (Business unit = COMPONENTI), in percentuale",
    nota: "Il confronto con l'anno scorso non fa parte della misura: si aggiunge al riquadro.",
    prova: {
      periodo: { anno: 2025 },
      risultato: { ...risultato({ metrica: "margine", misura: DEFINIZIONE }), totale: 31.4, avvisi: ["Costo noto per il 88,0% del valore nel periodo."] },
      foglie: [
        { descrizione: "Margine (Business unit = COMPONENTI)", unita: "euro", valore: 123000 },
        { descrizione: "Fatturato (Business unit = COMPONENTI)", unita: "euro", valore: 391000 },
      ],
    },
    modelli: ["Haiku 5.5"],
    escalato: false,
    consumo: { tokenIngresso: 3200, tokenUscita: 180, costoUsd: 0.00041 },
    dalCache: false,
  };

  it("mostra cio' che ha capito, la prova pezzo per pezzo, le avvertenze, e salva solo dopo", async () => {
    const spia = preparaFetch({ proposta: PROPOSTA });
    const onSalvata = vi.fn();
    render(<CreaMisura onChiudi={() => undefined} onSalvata={onSalvata} />);

    fireEvent.change(screen.getByLabelText(/Cosa vuoi misurare/), { target: { value: "margine sul fatturato dei soli componenti" } });
    fireEvent.click(screen.getByRole("button", { name: "Proponi la misura" }));
    await carica();

    expect(screen.getByText("Ho capito così")).toBeInTheDocument();
    expect(screen.getByText(/diviso Fatturato \(Business unit = COMPONENTI\)/)).toBeInTheDocument();
    expect(screen.getByText(/non fa parte della misura/)).toBeInTheDocument();
    const prova = screen.getByRole("region", { name: "Prova sui dati" });
    expect(within(prova).getByText("123.000 €")).toBeInTheDocument();
    expect(within(prova).getByText("391.000 €")).toBeInTheDocument();
    expect(within(prova).getByText("31,4%")).toBeInTheDocument();
    expect(within(prova).getByText(/Costo noto per il 88,0%/)).toBeInTheDocument();
    expect(screen.getByText(/Preparata da Haiku 5.5/)).toBeInTheDocument();
    // Ancora niente salvato.
    expect(spia.mock.calls.some(([url, init]) => String(url) === "/api/bi/misure" && init?.method === "POST")).toBe(false);

    fireEvent.change(screen.getByLabelText(/Nome della misura/), { target: { value: "Margine % componenti" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva e usa" }));
    await carica();

    const salvataggio = spia.mock.calls.find(([url, init]) => String(url) === "/api/bi/misure" && init?.method === "POST");
    const corpo = JSON.parse(String(salvataggio?.[1]?.body)) as { misura: { nome: string; espressione: { tipo: string } } };
    expect(corpo.misura.nome).toBe("Margine % componenti");
    expect(corpo.misura.espressione.tipo).toBe("rapporto");
    expect(onSalvata).toHaveBeenCalledTimes(1);
    expect(onSalvata.mock.calls[0][0].nome).toBe("Margine % componenti");
  });

  it("un'ambiguita' diventa una domanda, e la risposta si unisce alla richiesta", async () => {
    const spia = preparaFetch({
      proposta: {
        tipo: "chiarimento",
        chiarimento: "Intendi il margine sulle sole righe con costo noto o sul fatturato intero?",
        modelli: ["Haiku 5.5"],
        escalato: false,
        consumo: { tokenIngresso: 3000, tokenUscita: 40, costoUsd: 0.0003 },
        dalCache: false,
      },
    });
    render(<CreaMisura onChiudi={() => undefined} onSalvata={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/Cosa vuoi misurare/), { target: { value: "margine dei componenti" } });
    fireEvent.click(screen.getByRole("button", { name: "Proponi la misura" }));
    await carica();

    expect(screen.getByRole("status")).toHaveTextContent("costo noto o sul fatturato intero");
    fireEvent.change(screen.getByLabelText("La tua risposta"), { target: { value: "sul fatturato intero" } });
    fireEvent.click(screen.getByRole("button", { name: "Rispondi" }));
    await carica();

    const chiamate = spia.mock.calls.filter(([url]) => String(url) === "/api/bi/misure/proponi");
    expect(chiamate).toHaveLength(2);
    expect(JSON.parse(String(chiamate[1][1]?.body)).testo).toBe("margine dei componenti — sul fatturato intero");
  });

  it("un rifiuto del server si legge cosi' com'e', col suggerimento, e si puo' riprovare", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => risposta({ error: "Non riesco a tradurre la richiesta.", suggerimento: "Riformula." }, false))
    );
    render(<CreaMisura onChiudi={() => undefined} onSalvata={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/Cosa vuoi misurare/), { target: { value: "qualcosa di impossibile qui" } });
    fireEvent.click(screen.getByRole("button", { name: "Proponi la misura" }));
    await carica();
    expect(screen.getByRole("alert")).toHaveTextContent("Non riesco a tradurre la richiesta. Riformula.");
    expect(screen.getByRole("button", { name: "Proponi la misura" })).toBeEnabled();
  });

  it("il bottone resta spento finche' la richiesta e' troppo breve", () => {
    render(<CreaMisura onChiudi={() => undefined} onSalvata={() => undefined} />);
    expect(screen.getByRole("button", { name: "Proponi la misura" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Cosa vuoi misurare/), { target: { value: "margine" } });
    expect(screen.getByRole("button", { name: "Proponi la misura" })).toBeDisabled();
  });

  it("Escape chiude la finestra", () => {
    const onChiudi = vi.fn();
    render(<CreaMisura onChiudi={onChiudi} onSalvata={() => undefined} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onChiudi).toHaveBeenCalled();
  });

  it("dal pulsante dell'albero, salvare una misura la mette subito in uso nel riquadro", async () => {
    const spia = preparaFetch({ proposta: PROPOSTA });
    render(<EditorAnalisi />);
    await carica();

    fireEvent.click(screen.getByRole("button", { name: "Nuova misura a parole" }));
    fireEvent.change(screen.getByLabelText(/Cosa vuoi misurare/), { target: { value: "margine sul fatturato dei soli componenti" } });
    fireEvent.click(screen.getByRole("button", { name: "Proponi la misura" }));
    await carica();
    fireEvent.click(screen.getByRole("button", { name: "Salva e usa" }));
    await carica();
    await completaDebounce();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const ultima = specInviate(spia).at(-1)!;
    expect(ultima.misura?.nome).toBe("Margine componenti sul fatturato");
    expect(screen.getByRole("checkbox", { name: /^Margine componenti sul fatturato/ })).toBeChecked();
  });
});
