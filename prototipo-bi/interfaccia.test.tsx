/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Smoke test dell'interfaccia: verifica che le schermate montino, chiamino le
 * API giuste e reggano i casi limite (nessun dato, errore di rete). Serve
 * perché il login non è automatizzabile: senza questi test l'unica prova che
 * la UI non esplode sarebbe cliccare a mano.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BriefingView } from "@/components/prototipo-bi/briefing-view";
import { CruscottoView } from "@/components/prototipo-bi/cruscotto-view";
import { ConfigurazioneView } from "@/components/prototipo-bi/configurazione-view";
import { AnalistaView } from "@/components/prototipo-bi/analista-view";
import { AnalisiList } from "@/components/prototipo-bi/analisi-list";

// Recharts misura il contenitore: in jsdom ha dimensione zero e non disegna.
// Si forza una dimensione, altrimenti i grafici restano vuoti e i test non
// dimostrano nulla.
beforeEach(() => {
  // jsdom non implementa IntersectionObserver, che framer-motion usa per far
  // partire l'animazione dei numeri quando entrano nel viewport. Nel browser
  // esiste ovunque: qui va simulato, altrimenti i KPI non montano.
  // jsdom non implementa ResizeObserver, che il ResponsiveContainer di
  // Recharts usa per misurare il contenitore. Senza, nessun grafico monta.
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

  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 400,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(mappa: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = String(input);
    const chiave = Object.keys(mappa).find((k) => url.includes(k));
    if (!chiave) return { ok: false, json: async () => ({ error: "rotta non attesa: " + url }) };
    return { ok: true, json: async () => mappa[chiave] };
  });
}

const BRIEFING_FINTO = {
  briefing: {
    generatoIl: new Date().toISOString(),
    dataRiferimento: "2026-08-27",
    runRicevutoIl: "2026-08-27T23:31:00Z",
    destinatario: "Sebastiano",
    ruolo: "direzione",
    segnaliValutati: 7,
    segnaliScartati: 4,
    motoreAI: "deterministico",
    nota: null,
    voci: [
      {
        ordine: 1,
        segnaleId: "budget-ordinato-2026-08-27",
        famiglia: "scostamento_budget",
        testo: "Ordinato progressivo sotto budget del 42%.",
        azioneSuggerita: "Verificare il recupero previsto nel mese in corso.",
        certificata: true,
        prove: [{ descrizione: "ordinato progressivo", spec: { metrica: "ordinato" } }],
      },
      {
        ordine: 2,
        segnaleId: "dormienti-2026-08-27",
        famiglia: "clienti_dormienti",
        testo: "26 clienti non ordinano da oltre 120 giorni.",
        azioneSuggerita: "Assegnare la lista agli agenti.",
        certificata: true,
        prove: [],
      },
    ],
  },
  configurazioneBudget: true,
  segnali: [
    {
      id: "conc-2026-08",
      famiglia: "concentrazione",
      titolo: "CURTI vale il 53,8% dell'ordinato del mese",
      descrizione: "…",
      punteggio: 2.95,
      magnitudineEuro: 73751,
      direzione: "neutro",
      selezionato: false,
    },
  ],
};

describe("Briefing", () => {
  it("mostra le voci, il destinatario e la freschezza del dato", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/api/bi/briefing": BRIEFING_FINTO }));
    render(<BriefingView />);

    await waitFor(() => {
      expect(screen.getByText(/Buongiorno, Sebastiano/)).toBeInTheDocument();
    });
    expect(screen.getByText(/2026-08-27/)).toBeInTheDocument();
    expect(screen.getByText(/Ordinato progressivo sotto budget del 42%/)).toBeInTheDocument();
    expect(screen.getByText(/26 clienti non ordinano/)).toBeInTheDocument();
    // Il segnale scartato è disponibile per la taratura ma non è una voce.
    expect(screen.getByText(/1 segnali non/)).toBeInTheDocument();
  });

  it("dice esplicitamente quando non c'è nulla da segnalare", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/api/bi/briefing": {
          briefing: { ...BRIEFING_FINTO.briefing, voci: [], segnaliValutati: 12 },
          configurazioneBudget: true,
          segnali: [],
        },
      })
    );
    render(<BriefingView />);

    await waitFor(() => {
      expect(screen.getByText(/Niente di rilevante oggi/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Il silenzio è un risultato valido/)).toBeInTheDocument();
  });

  it("avverte se budget e BEP non sono configurati", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/api/bi/briefing": { ...BRIEFING_FINTO, configurazioneBudget: false },
      })
    );
    render(<BriefingView />);

    await waitFor(() => {
      expect(screen.getByText(/Budget e BEP non ancora configurati/)).toBeInTheDocument();
    });
  });
});

describe("Cruscotto", () => {
  it("monta, interroga le metriche e mostra i KPI", async () => {
    const risposta = {
      dataMassima: "2026-08-27",
      risultati: [
        { id: "ordinatoTot", risultato: { spec: {}, metrica: "ordinato", unita: "euro", righe: [], totale: 2_900_000, certificata: true, avvisi: [] } },
        { id: "ordinatoAP", risultato: { spec: {}, metrica: "ordinato", unita: "euro", righe: [], totale: 2_600_000, certificata: true, avvisi: [] } },
        { id: "fatturatoTot", risultato: { spec: {}, metrica: "fatturato", unita: "euro", righe: [], totale: 3_100_000, certificata: true, avvisi: [] } },
      ],
    };
    const spia = mockFetch({ "/api/bi/query": risposta });
    vi.stubGlobal("fetch", spia);

    render(
      <CruscottoView
        anniDisponibili={[2026, 2025]}
        buDisponibili={["COMPONENTI", "IMPIANTI"]}
        agentiDisponibili={["AIRFLUID"]}
        dataMassima="2026-08-27"
        runRicevutoIl="2026-08-27T23:31:00Z"
      />
    );

    await waitFor(() => expect(spia).toHaveBeenCalled());

    // Il corpo della richiesta deve contenere spec, non SQL.
    const body = JSON.parse(String(spia.mock.calls[0][1]?.body ?? "{}"));
    expect(body.specs.length).toBeGreaterThan(3);
    expect(body.specs[0].spec).toHaveProperty("metrica");
    expect(JSON.stringify(body)).not.toMatch(/select|SELECT/);

    await waitFor(() => {
      expect(screen.getByText(/Ordinato 2026/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Dati aggiornati al/)).toBeInTheDocument();
  });
});

describe("Configurazione Budget & BEP", () => {
  it("mostra l'anteprima e i suggerimenti storici", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/api/bi/configurazione": {
          config: {
            anno: 2026,
            budgetAnnuo: 7_500_000,
            bepAnnuo: 6_200_000,
            modalita: "giorni_lavorativi",
            escludiWeekend: true,
            chiusure: [
              { id: "e", dal: "2026-08-10", al: "2026-08-23", descrizione: "Chiusura estiva" },
            ],
            incidenzeBU: [{ bu: "COMPONENTI", pesoPct: 55 }],
            commerciali: [],
            aggiornatoIl: new Date().toISOString(),
          },
          anniConfigurati: [2026],
          avvisi: [],
          anteprima: {
            giorniLavorativi: 240,
            budgetGiornaliero: 31_250,
            bepGiornaliero: 25_833,
            righeGenerate: 5845,
            perMese: [
              { mese: 8, budget: 343_750, bep: 284_166, giorni: 11 },
              { mese: 9, budget: 687_500, bep: 568_333, giorni: 22 },
            ],
          },
          suggerimenti: {
            buDisponibili: ["COMPONENTI", "IMPIANTI"],
            agentiDisponibili: [{ codice: "AG009999", nome: "AIRFLUID" }],
            incidenzeStoriche: [{ bu: "COMPONENTI", pesoPct: 55 }],
            quoteStoriche: [{ agente: "AIRFLUID", quotaPct: 30 }],
          },
        },
      })
    );

    render(<ConfigurazioneView annoIniziale={2026} />);

    await waitFor(() => {
      expect(screen.getByText("Budget & BEP")).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("7500000")).toBeInTheDocument();
    expect(screen.getByText("240")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Chiusura estiva")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-08-10")).toBeInTheDocument();
    expect(screen.getByText(/Usa pesi storici/)).toBeInTheDocument();
    // Agosto (11 giorni) accanto a settembre (22): la prova visiva che il
    // budget segue i giorni lavorativi.
    const rigaAgosto = screen.getByText("agosto").closest("tr")!;
    const rigaSettembre = screen.getByText("settembre").closest("tr")!;
    expect(rigaAgosto).toHaveTextContent("11");
    expect(rigaSettembre).toHaveTextContent("22");
  });
});

describe("Analista", () => {
  it("mostra la copertura reale dei dati e gli esempi", () => {
    vi.stubGlobal("fetch", mockFetch({}));
    render(<AnalistaView dataMinima="2025-01-07" dataMassima="2026-08-27" />);

    expect(screen.getByText("Chiedi ai dati")).toBeInTheDocument();
    expect(screen.getByText("2025-01-07")).toBeInTheDocument();
    expect(screen.getByText(/non scrive SQL/)).toBeInTheDocument();
    expect(screen.getByText(/Prova a chiedere/)).toBeInTheDocument();
  });
});

describe("Riquadri salvati", () => {
  it("mostra gli utilizzi ed elimina tramite l'endpoint dedicato", async () => {
    const spiaFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") return { ok: true, json: async () => ({ eliminata: true }) };
      return {
        ok: true,
        json: async () => ({
          analisi: [{
            id: "analisi-prova",
            titolo: "Prova",
            descrizione: "Analisi salvata dall'utente",
            spec: { metrica: "ordinato" },
            grafico: "kpi",
            autore_id: "utente-1",
            visibilita: "privata",
            aggiornato_il: "2026-09-13T10:00:00Z",
            chiave: null,
            modificabile: true,
            utilizzi: [{
              dashboard_id: "dashboard-1",
              dashboard_titolo: "Commerciale",
              pagina_id: "pagina-1",
              pagina_titolo: "Sintesi",
            }],
          }],
        }),
      };
    });
    vi.stubGlobal("fetch", spiaFetch);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<AnalisiList />);

    expect(await screen.findByText("Prova")).toBeInTheDocument();
    expect(screen.getByText("Commerciale / Sintesi")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Elimina" }));

    await waitFor(() => {
      expect(spiaFetch).toHaveBeenCalledWith("/api/bi/analisi?id=analisi-prova", { method: "DELETE" });
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Commerciale / Sintesi"));
  });

  it("nello stato vuoto rimanda dove i riquadri si costruiscono davvero", async () => {
    // Non piu' all'editor isolato: i riquadri nascono dentro una pagina, con
    // il pulsante "Aggiungi", ed e' li' che va mandato chi non ha niente.
    vi.stubGlobal("fetch", mockFetch({ "/api/bi/analisi": { analisi: [] } }));
    render(<AnalisiList />);

    expect(await screen.findByRole("link", { name: /Vai alle dashboard/i })).toHaveAttribute("href", "/bi/dashboard");
  });
});
