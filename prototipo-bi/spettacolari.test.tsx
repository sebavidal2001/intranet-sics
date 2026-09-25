/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Grafici ad alto impatto, impostazioni e le due viste nuove.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import {
  Anelli,
  AreeImpilate,
  CalendarioAttivita,
  Composizione,
  Imbuto,
  Radiale,
} from "@/components/prototipo-bi/grafici-spettacolari";
import {
  ImpostazioniProvider,
  PannelloImpostazioni,
  PALETTE_DISPONIBILI,
} from "@/components/prototipo-bi/impostazioni";
import { VistaConversione } from "@/components/prototipo-bi/vista-conversione";
import { VistaBackoffice } from "@/components/prototipo-bi/vista-backoffice";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: (e: unknown[]) => void) {}
      observe() {
        this.cb([{ contentRect: { width: 800, height: 400 } }]);
      }
      unobserve() {}
      disconnect() {}
    }
  );
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
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 400 });
  window.localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────────────────

describe("Imbuto", () => {
  it("mostra le fasi e la perdita fra una e l'altra", () => {
    render(
      <Imbuto
        fasi={[
          { etichetta: "Preventivato", valore: 6_454_654 },
          { etichetta: "Convertito", valore: 2_284_088, nota: "35,4%" },
        ]}
      />
    );
    expect(screen.getByText("Preventivato")).toBeInTheDocument();
    expect(screen.getByText("Convertito")).toBeInTheDocument();
    // 2.284.088 / 6.454.654 - 1 = -64,6%
    expect(screen.getByText(/-64,6%|-64.6%/)).toBeInTheDocument();
  });

  it("non disegna nulla con una fase sola", () => {
    render(<Imbuto fasi={[{ etichetta: "Solo una", valore: 10 }]} />);
    expect(screen.getByText(/Nessun dato/)).toBeInTheDocument();
  });
});

describe("Radiale", () => {
  it("mostra la percentuale di raggiungimento", () => {
    render(<Radiale valore={2_284_088} obiettivo={5_200_000} etichetta="Conversione" />);
    expect(screen.getByText("44%")).toBeInTheDocument();
    expect(screen.getByText("Conversione")).toBeInTheDocument();
  });

  it("regge un obiettivo a zero senza dividere per zero", () => {
    render(<Radiale valore={100} obiettivo={0} etichetta="Senza obiettivo" />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});

describe("Calendario attività", () => {
  it("riassume totale, giorni attivi e picco", () => {
    render(
      <CalendarioAttivita
        anno={2026}
        valori={{ "2026-01-07": 12, "2026-01-08": 30, "2026-03-02": 5 }}
      />
    );
    expect(screen.getByText(/3 giorni attivi/)).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("lo dice quando non c'è attività, invece di disegnare una griglia vuota", () => {
    render(<CalendarioAttivita anno={2026} valori={{}} />);
    expect(screen.getByText(/Nessuna attività/)).toBeInTheDocument();
  });
});

describe("Aree impilate", () => {
  const serie = [
    { nome: "LUCIA RODA", valori: { gen: 300, feb: 280 } },
    { nome: "JESSICA GORDINI", valori: { gen: 150, feb: 200 } },
  ];

  it("disegna una serie per persona", () => {
    render(<AreeImpilate periodi={["gen", "feb"]} serie={serie} unita="numero" />);
    expect(screen.getByText("LUCIA RODA")).toBeInTheDocument();
    expect(screen.getByText("JESSICA GORDINI")).toBeInTheDocument();
  });

  it("regge la modalità normalizzata", () => {
    // Le etichette degli assi di Recharts non vengono misurate in jsdom, quindi
    // qui si verifica che il componente monti e mantenga tutte le serie: la
    // correttezza del calcolo normalizzato è coperta dal test del motore.
    render(<AreeImpilate periodi={["gen", "feb"]} serie={serie} normalizzato />);
    expect(screen.getByText("LUCIA RODA")).toBeInTheDocument();
    expect(screen.getByText("JESSICA GORDINI")).toBeInTheDocument();
  });
});

describe("Anelli e composizione", () => {
  it("gli anelli arrotondano le percentuali", () => {
    render(
      <Anelli
        voci={[
          { etichetta: "COMPONENTI", percentuale: 47.8 },
          { etichetta: "IMPIANTI", percentuale: 48.6 },
        ]}
      />
    );
    expect(screen.getByText("48%")).toBeInTheDocument();
    expect(screen.getByText("49%")).toBeInTheDocument();
  });

  it("la composizione scarta i valori nulli", () => {
    render(
      <Composizione
        dati={[
          { etichetta: "A", valore: 100 },
          { etichetta: "B", valore: 0 },
        ]}
      />
    );
    // Con un solo nodo valido il treemap monta comunque.
    expect(screen.queryByText(/Nessun dato/)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Impostazioni grafici", () => {
  it("apre il pannello e propone tutte le palette", () => {
    render(
      <ImpostazioniProvider>
        <PannelloImpostazioni />
      </ImpostazioniProvider>
    );
    fireEvent.click(screen.getByLabelText("Impostazioni grafici"));
    expect(screen.getByText("Impostazioni grafici")).toBeInTheDocument();
    for (const p of PALETTE_DISPONIBILI) {
      // "SICS" compare anche nella riga di riepilogo in fondo al pannello:
      // basta che il nome ci sia almeno una volta.
      expect(screen.getAllByText(p.nome).length).toBeGreaterThan(0);
      expect(screen.getByText(p.descrizione)).toBeInTheDocument();
    }
  });

  it("salva la scelta nel browser e la ripristina alla riapertura", async () => {
    const { unmount } = render(
      <ImpostazioniProvider>
        <PannelloImpostazioni />
      </ImpostazioniProvider>
    );
    fireEvent.click(screen.getByLabelText("Impostazioni grafici"));
    fireEvent.click(screen.getByText("Alto contrasto"));

    await waitFor(() => {
      const salvate = window.localStorage.getItem("proto-bi:impostazioni:v1");
      expect(salvate).toContain("accessibile");
    });

    unmount();
    render(
      <ImpostazioniProvider>
        <PannelloImpostazioni />
      </ImpostazioniProvider>
    );
    fireEvent.click(screen.getByLabelText("Impostazioni grafici"));
    await waitFor(() => {
      expect(screen.getByText(/Palette attiva:/).textContent).toContain("Alto contrasto");
    });
  });

  it("gli interruttori cambiano stato", async () => {
    render(
      <ImpostazioniProvider>
        <PannelloImpostazioni />
      </ImpostazioniProvider>
    );
    fireEvent.click(screen.getByLabelText("Impostazioni grafici"));

    const griglia = screen.getByText("Griglia").closest("button")!;
    expect(griglia).toHaveAttribute("aria-checked", "true");
    fireEvent.click(griglia);
    await waitFor(() => expect(griglia).toHaveAttribute("aria-checked", "false"));
  });

  it("il ripristino riporta ai valori iniziali", async () => {
    render(
      <ImpostazioniProvider>
        <PannelloImpostazioni />
      </ImpostazioniProvider>
    );
    fireEvent.click(screen.getByLabelText("Impostazioni grafici"));
    fireEvent.click(screen.getByText("Oceano"));
    await waitFor(() =>
      expect(screen.getByText(/Palette attiva:/).textContent).toContain("Oceano")
    );

    fireEvent.click(screen.getByTitle("Ripristina i valori iniziali"));
    await waitFor(() =>
      expect(screen.getByText(/Palette attiva:/).textContent).toContain("SICS")
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function risultato(righe: [string, number][], chiave: string, unita = "euro") {
  return {
    spec: { metrica: "preventivi_valore" },
    metrica: "preventivi_valore",
    unita,
    righe: righe.map(([etichetta, valore]) => ({
      etichetta,
      chiavi: { [chiave]: etichetta },
      valore,
      conteggio: 20,
    })),
    totale: righe.reduce((s, [, v]) => s + v, 0),
    certificata: true,
    avvisi: [],
  };
}

function mockQuery(perId: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      specs?: { id: string; spec: unknown }[];
    };
    // La scheda Back office chiede anche gli ordini a fornitore, in GET.
    if (String(input).startsWith("/api/bi/acquisti")) {
      return {
        ok: true,
        json: async () => ({ perBuyer: [], caricoMensile: [], avvisi: [] }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        dataMassima: "2026-08-28",
        risultati: (body.specs ?? []).map((s) => ({
          id: s.id,
          risultato: perId[s.id] ?? {
            spec: {},
            metrica: "x",
            unita: "euro",
            righe: [],
            totale: 0,
            certificata: true,
            avvisi: [],
          },
        })),
      }),
    };
  });
}

describe("Vista Conversione", () => {
  it("mostra l'imbuto, il tasso e la tabella clienti", async () => {
    const spia = mockQuery({
      valore: risultato([["x", 6_454_654]], "bu"),
      convertito: risultato([["x", 2_284_088]], "bu"),
      aperto: risultato([["x", 4_180_296]], "bu"),
      tasso: { ...risultato([["x", 35.4]], "bu", "percentuale"), totale: 35.4 },
      nPrev: { ...risultato([["x", 1846]], "bu", "numero"), totale: 1846 },
      tassoBu: risultato(
        [
          ["IMPIANTI", 48.6],
          ["COMPONENTI", 47.8],
        ],
        "bu",
        "percentuale"
      ),
      valoreCliente: risultato([["IMA spa", 500_000]], "cliente"),
      convertitoCliente: risultato([["IMA spa", 200_000]], "cliente"),
      tassoCliente: risultato([["IMA spa", 40]], "cliente", "percentuale"),
    });
    vi.stubGlobal("fetch", spia);

    render(
      <ImpostazioniProvider>
        <VistaConversione anno={2026} periodo={{ anno: 2026 }} filtriSpec={[]} alternaFiltro={() => {}} filtroDi={() => null} />
      </ImpostazioniProvider>
    );

    await waitFor(() => expect(spia).toHaveBeenCalled());

    // Le spec devono nominare le metriche nuove, non SQL.
    const query = spia.mock.calls.find(([url]) => url === "/api/bi/query");
    const inviato = JSON.stringify(JSON.parse(String(query?.[1]?.body)));
    expect(inviato).toContain("tasso_conversione");
    expect(inviato).toContain("preventivi_convertito");
    expect(inviato).not.toMatch(/select|SELECT/);

    await waitFor(() => {
      // "Preventivato" compare due volte: nell'imbuto e come colonna della
      // tabella clienti. Sono entrambe volute.
      expect(screen.getAllByText("Preventivato").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/Dal preventivo all'ordine/)).toBeInTheDocument();
    // Il cliente compare sia nel Pareto sia nella tabella: entrambi voluti.
    expect(screen.getAllByText("IMA spa").length).toBeGreaterThan(0);
    expect(screen.getByText("Tasso di conversione")).toBeInTheDocument();
  });
});

describe("Vista Back office", () => {
  it("mostra volume, reattività e il quadro degli addetti", async () => {
    const spia = mockQuery({
      documenti: { ...risultato([["x", 1846]], "creatore", "numero"), totale: 1846 },
      righe: { ...risultato([["x", 6476]], "creatore", "numero"), totale: 6476 },
      giorni: { ...risultato([["x", 0.29]], "creatore", "giorni"), totale: 0.29 },
      inGiornata: { ...risultato([["x", 92.3]], "creatore", "percentuale"), totale: 92.3 },
      docPerAddetto: risultato(
        [
          ["LUCIA RODA", 814],
          ["JESSICA GORDINI", 499],
        ],
        "creatore",
        "numero"
      ),
      righePerAddetto: risultato(
        [
          ["LUCIA RODA", 3202],
          ["JESSICA GORDINI", 1546],
        ],
        "creatore",
        "numero"
      ),
      giornataPerAddetto: risultato(
        [
          ["LUCIA RODA", 93.7],
          ["JESSICA GORDINI", 96.6],
        ],
        "creatore",
        "percentuale"
      ),
      righeGiorno: risultato(
        [
          ["2026-01-07", 12],
          ["2026-01-08", 30],
        ],
        "periodo",
        "numero"
      ),
    });
    vi.stubGlobal("fetch", spia);

    render(
      <ImpostazioniProvider>
        <VistaBackoffice anno={2026} periodo={{ anno: 2026 }} filtriSpec={[]} alternaFiltro={() => {}} filtroDi={() => null} />
      </ImpostazioniProvider>
    );

    // La scheda chiede anche gli ordini a fornitore: si guarda solo il batch di query.
    const query = () => spia.mock.calls.find(([url]) => url === "/api/bi/query");
    await waitFor(() => expect(query()).toBeDefined());

    const inviato = JSON.stringify(JSON.parse(String(query()?.[1]?.body)));
    expect(inviato).toContain("righe_preventivo");
    expect(inviato).toContain("quota_stesso_giorno");
    expect(inviato).toContain("creatore");

    await waitFor(() => {
      expect(screen.getByText("Volume di lavoro")).toBeInTheDocument();
    });
    expect(screen.getByText(/Risposte in giornata/)).toBeInTheDocument();
    expect(screen.getByText(/Addetti back office/)).toBeInTheDocument();

    // La tabella deve contenere le persone.
    const tabella = screen.getByText(/Addetti back office/).closest("section")!;
    expect(within(tabella).getByText("LUCIA RODA")).toBeInTheDocument();
  });

  it("alterna volumi e quote percentuali", async () => {
    vi.stubGlobal("fetch", mockQuery({}));
    render(
      <ImpostazioniProvider>
        <VistaBackoffice anno={2026} periodo={{ anno: 2026 }} filtriSpec={[]} alternaFiltro={() => {}} filtroDi={() => null} />
      </ImpostazioniProvider>
    );
    // Due grafici hanno il loro interruttore: si prova quello del carico dei preventivi.
    await waitFor(() => expect(screen.getByText("Come si distribuisce il carico")).toBeInTheDocument());
    const sezione = screen.getByText("Come si distribuisce il carico").closest("section")!;
    fireEvent.click(within(sezione).getByText("Mostra quote %"));
    expect(within(sezione).getByText("Mostra volumi")).toBeInTheDocument();
  });
});
