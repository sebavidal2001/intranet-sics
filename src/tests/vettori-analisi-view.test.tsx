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

  it("una risposta vecchia, senza il campo, non rompe la pagina", () => {
    const vecchia = { ...base } as Partial<Analisi>;
    delete vecchia.fatture_non_quadrate;
    render(<AnalisiView dati={vecchia as Analisi} anno={2026} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
