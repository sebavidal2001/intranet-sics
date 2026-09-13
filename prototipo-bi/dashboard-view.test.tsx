import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DashboardView,
  type AnalisiDashboard,
  type DashboardCompleta,
} from "@/components/prototipo-bi/dashboard-view";

vi.mock("@/components/prototipo-bi/grafico-da-risultato", () => ({
  GraficoDaRisultato: ({ risultato }: { risultato: { totale: number } }) => (
    <div>Risultato {risultato.totale}</div>
  ),
  GraficoDaAnalisi: ({ serie }: { serie: Array<{ risultato: { totale: number } }> }) => (
    <div>Risultato {serie[0]?.risultato.totale}</div>
  ),
}));

const DASHBOARD: DashboardCompleta = {
  id: "dashboard-1",
  titolo: "Commerciale 2026",
  descrizione: "Controllo direzionale",
  autore_id: "utente-1",
  visibilita: "privata",
  modificabile: false,
  pagine: [
    {
      id: "pagina-1",
      dashboard_id: "dashboard-1",
      titolo: "Sintesi",
      ordine: 0,
      filtri: { periodo: { anno: 2026 } },
      riquadri: [
        {
          id: "riquadro-1",
          pagina_id: "pagina-1",
          analisi_id: "analisi-1",
          titolo: null,
          posizione: 0,
          larghezza: 6,
          altezza: 4,
          grafico: "kpi",
          analisi: {
            id: "analisi-1",
            titolo: "Ordinato totale",
            descrizione: null,
            spec: { metrica: "ordinato" },
            grafico: "kpi",
            autore_id: "utente-1",
            visibilita: "privata",
          },
        },
        {
          id: "riquadro-2",
          pagina_id: "pagina-1",
          analisi_id: "analisi-2",
          titolo: null,
          posizione: 1,
          larghezza: 6,
          altezza: 4,
          grafico: "barre",
          analisi: {
            id: "analisi-2",
            titolo: "Clienti principali",
            descrizione: null,
            spec: { metrica: "fatturato", raggruppa: ["cliente"] },
            grafico: "barre",
            autore_id: "utente-1",
            visibilita: "privata",
          },
        },
      ],
    },
    {
      id: "pagina-2",
      dashboard_id: "dashboard-1",
      titolo: "Agenti",
      ordine: 1,
      filtri: {},
      riquadri: [
        {
          id: "riquadro-3",
          pagina_id: "pagina-2",
          analisi_id: "analisi-3",
          titolo: null,
          posizione: 0,
          larghezza: 12,
          altezza: 4,
          grafico: "barre",
          analisi: {
            id: "analisi-3",
            titolo: "Risultati per agente",
            descrizione: null,
            spec: { metrica: "ordinato", raggruppa: ["agente"] },
            grafico: "barre",
            autore_id: "utente-1",
            visibilita: "privata",
          },
        },
      ],
    },
  ],
};

describe("Dashboard a pagine", () => {
  it("mostra le linguette, cambia pagina e usa un solo batch per pagina", async () => {
    const spiaFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        specs?: Array<{ id: string; spec: unknown }>;
      };
      return {
        ok: true,
        json: async () => ({
          risultati: (body.specs ?? []).map(({ id }) => ({
            id,
            risultato: {
              spec: {},
              metrica: "ordinato",
              unita: "euro",
              righe: [{ etichetta: "Totale", chiavi: {}, valore: 10, conteggio: 1 }],
              totale: 10,
              certificata: true,
              avvisi: [],
            },
          })),
        }),
      };
    });
    vi.stubGlobal("fetch", spiaFetch);

    render(<DashboardView dashboardIniziale={DASHBOARD} />);

    expect(screen.getByRole("tab", { name: "Sintesi" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Agenti" })).toBeInTheDocument();
    expect(screen.getByText("Ordinato totale")).toBeInTheDocument();

    await waitFor(() => expect(spiaFetch).toHaveBeenCalledTimes(1));
    const primoBody = JSON.parse(String(spiaFetch.mock.calls[0][1]?.body ?? "{}")) as {
      specs: unknown[];
    };
    expect(primoBody.specs).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: "Agenti" }));
    expect(screen.getByText("Risultati per agente")).toBeInTheDocument();
    expect(screen.queryByText("Ordinato totale")).not.toBeInTheDocument();

    await waitFor(() => expect(spiaFetch).toHaveBeenCalledTimes(2));
    const secondoBody = JSON.parse(String(spiaFetch.mock.calls[1][1]?.body ?? "{}")) as {
      specs: unknown[];
    };
    expect(secondoBody.specs).toHaveLength(1);
  });

  it("offre i tre modi di aggiunta e collega dalla libreria una volta sola", async () => {
    const analisiLibreria: AnalisiDashboard = {
      id: "analisi-libreria",
      titolo: "Ordini dalla libreria",
      descrizione: "Una domanda già pronta",
      spec: { metrica: "n_ordini" },
      grafico: "kpi",
      autore_id: "utente-1",
      visibilita: "privata",
    };
    const spiaFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/bi/analisi") {
        return { ok: true, json: async () => ({ analisi: [analisiLibreria] }) };
      }
      if (url.endsWith("/riquadri") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            riquadro: {
              id: "riquadro-nuovo",
              pagina_id: "pagina-1",
              analisi_id: analisiLibreria.id,
              titolo: null,
              posizione: 2,
              larghezza: 6,
              altezza: 4,
              grafico: null,
            },
          }),
        };
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        specs?: Array<{ id: string }>;
      };
      return {
        ok: true,
        json: async () => ({
          risultati: (body.specs ?? []).map(({ id }) => ({
            id,
            risultato: {
              spec: {}, metrica: "ordinato", unita: "euro", righe: [],
              totale: 10, certificata: true, avvisi: [],
            },
          })),
        }),
      };
    });
    vi.stubGlobal("fetch", spiaFetch);

    render(
      <DashboardView
        dashboardIniziale={{ ...DASHBOARD, modificabile: true }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi" }));
    expect(screen.getByRole("tab", { name: "Dalla libreria" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Costruisci" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Chiedi all'AI" })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Aggiungi alla pagina" }));
    await waitFor(() => {
      const chiamate = spiaFetch.mock.calls.filter(([input, init]) =>
        String(input).endsWith("/riquadri") && init?.method === "POST"
      );
      expect(chiamate).toHaveLength(1);
    });
  });

  it("sul Cruscotto di sistema sostituisce Aggiungi con la duplicazione", async () => {
    const spiaFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { specs?: Array<{ id: string }> };
      return {
        ok: true,
        json: async () => ({ risultati: (body.specs ?? []).map(({ id }) => ({
          id,
          risultato: {
            spec: {}, metrica: "ordinato", unita: "euro", righe: [],
            totale: 10, certificata: true, avvisi: [],
          },
        })) }),
      };
    });
    vi.stubGlobal("fetch", spiaFetch);

    render(<DashboardView dashboardIniziale={{ ...DASHBOARD, di_sistema: true, modificabile: false }} />);

    expect(screen.queryByRole("button", { name: "Aggiungi" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duplica per modificare" })).toBeInTheDocument();
  });
});
