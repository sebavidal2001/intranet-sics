import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { VistaAcquisti } from "@/components/prototipo-bi/vista-acquisti";
import { calcolaCruscottoAcquisti, type RigaAcquisto } from "@/lib/prototipo-bi/acquisti";

function riga(p: Partial<RigaAcquisto> & { dataOrdine: string }): RigaAcquisto {
  return {
    idRiga: 1, profilo: "OF", numeroOrdine: 12, codiceFornitore: "F1", fornitore: "COLUMBUS McKINNON",
    buyerUtente: "claudiodalsass", buyer: "Claudio Dalsass", articolo: "ART-1", descrizione: "Colonna",
    gruppoArticoli: "SISTEMI", quantita: 10, qtaArrivata: 10, valore: 1000, dataPrevista: null,
    dataConfermata: null, rigaEvasa: true, chiusaForzata: false, primoArrivo: null, ...p,
  };
}

// jsdom non ha i due osservatori che Recharts e framer-motion usano per
// misurare e animare. Si definiscono PRIMA degli import (vi.hoisted): simularli
// dentro il test non bastava, perche' sotto il carico della suite completa
// framer-motion poteva cercarli prima, e il test falliva una volta su tre.
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class {
    constructor(private cb: (e: unknown[]) => void) {}
    observe() {
      this.cb([{ contentRect: { width: 800, height: 400 } }]);
    }
    unobserve() {}
    disconnect() {}
  };
  g.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
});

afterEach(() => vi.unstubAllGlobals());

describe("VistaAcquisti", () => {
  it("mostra KPI, buyer, fornitori e righe da sollecitare", async () => {
    const dati = calcolaCruscottoAcquisti(
      [
        riga({ dataOrdine: "2026-09-02", dataConfermata: "2026-09-10", primoArrivo: "2026-09-08" }),
        riga({ dataOrdine: "2026-09-03", buyer: "Linda Carlone", rigaEvasa: false, qtaArrivata: 0, dataConfermata: "2026-09-12" }),
      ],
      { dal: "2026-01-01", al: "2026-09-24", oggi: "2026-09-24" }
    );
    const fetchFinta = vi.fn().mockResolvedValue({ ok: true, json: async () => dati });
    vi.stubGlobal("fetch", fetchFinta);

    render(<VistaAcquisti anno={2026} periodo={{ dal: "2026-01-01", al: "2026-09-24" }} />);

    // Sotto il carico della suite completa i grafici impiegano piu' del
    // secondo predefinito a montare: senza margine il test diventa instabile.
    await waitFor(() => expect(screen.getByText("Per buyer")).toBeInTheDocument(), { timeout: 5000 });
    expect(fetchFinta).toHaveBeenCalledWith("/api/bi/acquisti?dal=2026-01-01&al=2026-09-24");
    expect(screen.getAllByText("Claudio Dalsass").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Linda Carlone").length).toBeGreaterThan(0);
    expect(screen.getAllByText("COLUMBUS McKINNON").length).toBeGreaterThan(0);
    expect(screen.getByText("Da sollecitare")).toBeInTheDocument();
    expect(screen.getByText("12 gg")).toBeInTheDocument();
  });

  it("dice perche' i dati mancano invece di mostrare zeri", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Ordini di acquisto non disponibili: la vista bi_acquisti non è raggiungibile." }),
    }));
    render(<VistaAcquisti anno={2026} periodo={{ anno: 2026 }} />);
    await waitFor(() => expect(screen.getByText(/non è raggiungibile/)).toBeInTheDocument(), { timeout: 5000 });
  });
});
