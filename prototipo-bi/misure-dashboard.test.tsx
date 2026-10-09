/**
 * Una misura personalizzata in una dashboard: Ctrl+clic non apre i documenti
 * (non ce n'e' UN insieme: i filtri incorporati negli operandi non passerebbero
 * al dettaglio), mentre su una metrica semplice li apre ancora.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DashboardView, type DashboardCompleta } from "@/components/prototipo-bi/dashboard-view";
import { validaMisura } from "@/lib/prototipo-bi/misure";

vi.mock("@/components/prototipo-bi/grafico-da-risultato", () => ({
  GraficoDaRisultato: () => <div />,
  GraficoDaAnalisi: ({
    onClickEtichetta,
    serie,
  }: {
    onClickEtichetta?: (etichetta: string) => void;
    serie: Array<{ nome: string }>;
  }) => (
    <button type="button" onClick={() => onClickEtichetta?.("IMA spa")}>
      clic {serie[0]?.nome}
    </button>
  ),
}));

const MISURA = validaMisura({
  nome: "Margine componenti",
  espressione: {
    tipo: "rapporto",
    numeratore: { metrica: "margine", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
    denominatore: { metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
  },
});

function analisi(id: string, titolo: string, spec: object) {
  return { id, titolo, descrizione: null, spec, grafico: "barre" as const, autore_id: "u", visibilita: "privata" as const };
}

const DASHBOARD = {
  id: "d",
  titolo: "Prova",
  descrizione: null,
  autore_id: "u",
  visibilita: "privata",
  modificabile: false,
  pagine: [
    {
      id: "p1",
      dashboard_id: "d",
      titolo: "Sintesi",
      ordine: 0,
      filtri: {},
      riquadri: [
        {
          id: "r1", pagina_id: "p1", analisi_id: "a1", titolo: "Fatturato per cliente", posizione: 0, larghezza: 6, altezza: 4, grafico: "barre",
          analisi: analisi("a1", "Fatturato per cliente", { metrica: "fatturato", raggruppa: ["cliente"] }),
        },
        {
          id: "r2", pagina_id: "p1", analisi_id: "a2", titolo: "Margine componenti per cliente", posizione: 1, larghezza: 6, altezza: 4, grafico: "barre",
          analisi: analisi("a2", "Margine componenti per cliente", { metrica: "margine", misura: MISURA, raggruppa: ["cliente"] }),
        },
      ],
    },
  ],
} as unknown as DashboardCompleta;

function preparaFetch() {
  const spia = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/bi/dettaglio") return { ok: true, json: async () => ({ documenti: [], righe: [] }) };
    const body = JSON.parse(String(init?.body ?? "{}")) as { specs?: Array<{ id: string }> };
    return {
      ok: true,
      json: async () => ({
        risultati: (body.specs ?? []).map(({ id }) => ({
          id,
          risultato: { spec: {}, metrica: "fatturato", unita: "euro", righe: [], totale: 0, certificata: true, avvisi: [] },
        })),
      }),
    };
  });
  vi.stubGlobal("fetch", spia);
  return spia;
}

const chiamateDettaglio = (spia: ReturnType<typeof preparaFetch>) =>
  spia.mock.calls.filter(([url]) => String(url) === "/api/bi/dettaglio");

describe("dashboard con una misura personalizzata", () => {
  it("la misura arriva al motore con la sua definizione, e la legenda porta il suo nome", async () => {
    const spia = preparaFetch();
    render(<DashboardView dashboardIniziale={DASHBOARD} />);
    await waitFor(() => expect(spia.mock.calls.some(([url]) => String(url) === "/api/bi/query")).toBe(true));

    const corpo = JSON.parse(String(spia.mock.calls.find(([url]) => String(url) === "/api/bi/query")![1]?.body)) as {
      specs: Array<{ id: string; spec: { misura?: { nome: string } } }>;
    };
    expect(corpo.specs.find((s) => s.id.startsWith("r2"))?.spec.misura?.nome).toBe("Margine componenti");
    expect(screen.getByText("clic Margine componenti")).toBeInTheDocument();
  });

  it("Ctrl+clic su una metrica apre i documenti", async () => {
    const spia = preparaFetch();
    render(<DashboardView dashboardIniziale={DASHBOARD} />);
    await waitFor(() => expect(spia.mock.calls.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText("clic fatturato"), { ctrlKey: true });
    await waitFor(() => expect(chiamateDettaglio(spia).length).toBeGreaterThan(0));
  });

  it("Ctrl+clic su una misura NON apre i documenti: non ce n'e' uno solo che la compone", async () => {
    const spia = preparaFetch();
    render(<DashboardView dashboardIniziale={DASHBOARD} />);
    await waitFor(() => expect(spia.mock.calls.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText("clic Margine componenti"), { ctrlKey: true });
    // Si lascia il tempo a un'eventuale apertura asincrona prima di concludere.
    await new Promise((r) => setTimeout(r, 50));
    expect(chiamateDettaglio(spia)).toHaveLength(0);
  });
});
