import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DashboardView,
  type DashboardCompleta,
} from "@/components/prototipo-bi/dashboard-view";

vi.mock("@/components/prototipo-bi/grafico-da-risultato", () => ({
  GraficoDaRisultato: ({ risultato }: { risultato: { totale: number } }) => (
    <div>Risultato {risultato.totale}</div>
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
});
