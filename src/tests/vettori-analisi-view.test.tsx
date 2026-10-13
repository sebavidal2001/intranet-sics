import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AnalisiView } from "@/components/portali/vettori/analisi-view";
import type { Analisi } from "@/lib/portali/vettori/letture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

const base: Analisi = {
  da: "2026-01-01",
  a: "2026-12-31",
  fatture_non_quadrate: 0,
  totali: { righe: 10, colli: 12, kg: 100, fatturato: 500, atteso: 480, anomalie: 1 },
  vettori: [],
  mesi: [],
  tipi_anomalia: [],
};

describe("analisi vettori", () => {
  it("non mostra avvisi quando tutte le fatture quadrano", () => {
    render(<AnalisiView dati={base} anno={2026} />);
    expect(screen.queryByText(/senza quadratura/)).toBeNull();
  });

  it("dichiara quante fatture non quadrate sono escluse dai totali", () => {
    render(<AnalisiView dati={{ ...base, fatture_non_quadrate: 2 }} anno={2026} />);
    expect(screen.getByRole("status").textContent).toMatch(/2 fatture acquisite senza quadratura non sono incluse/);
  });

  it("usa il singolare per una sola fattura", () => {
    render(<AnalisiView dati={{ ...base, fatture_non_quadrate: 1 }} anno={2026} />);
    expect(screen.getByRole("status").textContent).toMatch(/Una fattura acquisita senza quadratura non è inclusa/);
  });

  it("le barre mensili stanno in un contenitore che ha altezza propria", () => {
    // jsdom non calcola il layout: si verifica la struttura che dà alla percentuale
    // un genitore alto quanto il grafico (prima era «auto» e le barre valevano zero).
    const mese = (m: number, fatturato: number) => ({ anno: 2026, mese: m, righe: 5, colli: 6, kg: 50, fatturato, atteso: fatturato, anomalie: 0 });
    render(<AnalisiView dati={{ ...base, mesi: [mese(1, 1000), mese(2, 500)] }} anno={2026} />);
    const barre = screen.getAllByTestId("barra-mese");
    expect(barre).toHaveLength(2);
    expect(barre[0].style.height).toBe("100%");
    expect(barre[1].style.height).toBe("50%");
    for (const barra of barre) {
      expect(barra.parentElement?.className).toMatch(/flex-1/);
      expect(barra.parentElement?.parentElement?.className).toMatch(/h-full/);
    }
  });

  it("una risposta vecchia, senza il campo, non rompe la pagina", () => {
    const vecchia = { ...base } as Partial<Analisi>;
    delete vecchia.fatture_non_quadrate;
    render(<AnalisiView dati={vecchia as Analisi} anno={2026} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
