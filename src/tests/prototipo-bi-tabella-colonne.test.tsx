import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { formattaPeriodo } from "@/lib/prototipo-bi/formato-periodo";
import { GraficoDaAnalisi } from "@/components/prototipo-bi/grafico-da-risultato";
import { GRUPPI_DIMENSIONI } from "@/lib/prototipo-bi/gruppi-campi";
import { CATALOGO } from "@/lib/prototipo-bi/semantico";
import { dimensioniPerMetrica } from "@/lib/prototipo-bi/tassonomia";
import { graficiPossibili } from "@/lib/prototipo-bi/scelta-grafico";
import type { ChiaveMetrica, RisultatoQuery, SerieAnalisiEseguita } from "@/lib/prototipo-bi/tipi";

describe("formattaPeriodo", () => {
  it("scrive le date in gg/mm/aaaa", () => {
    expect(formattaPeriodo("2026-10-05")).toBe("05/10/2026");
    expect(formattaPeriodo("2026-10")).toBe("10/2026");
  });

  it("lascia com'e' tutto cio' che non e' una data", () => {
    expect(formattaPeriodo("2026")).toBe("2026");
    expect(formattaPeriodo("2026-W40")).toBe("2026-W40");
    expect(formattaPeriodo("PELLICONI ITALIA spa")).toBe("PELLICONI ITALIA spa");
  });
});

describe("tabella di un risultato", () => {
  afterEach(cleanup);

  // Come nell'esempio reale: visite per giorno, cliente e agente.
  const risultato = {
    spec: { metrica: "visite_numero", granularita: "giorno", raggruppa: ["cliente", "agente"] },
    metrica: "visite_numero",
    unita: "numero",
    totale: 3,
    certificata: true,
    avvisi: [],
    righe: [
      { etichetta: "2026-10-05 · PELLICONI ITALIA spa · VALERIA BATTELANI", chiavi: { periodo: "2026-10-05", cliente: "PELLICONI ITALIA spa", agente: "VALERIA BATTELANI" }, valore: 1, conteggio: 1 },
      { etichetta: "2026-09-17 · WALVOIL spa · VALERIA BATTELANI", chiavi: { periodo: "2026-09-17", cliente: "WALVOIL spa", agente: "VALERIA BATTELANI" }, valore: 2, conteggio: 2 },
    ],
  } as unknown as RisultatoQuery;
  const serie = [{ ruolo: "principale", nome: "Visite", spec: risultato.spec, risultato }] as unknown as SerieAnalisiEseguita[];

  it("ha una colonna per ogni valore, senza la voce unica concatenata", () => {
    render(<GraficoDaAnalisi serie={serie} tipo="tabella" />);
    const tabella = screen.getByRole("table");
    const intestazioni = within(tabella).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(intestazioni).toEqual(["Data", "Cliente", "Agente", "Visite"]);
    expect(within(tabella).queryByText(/·/)).not.toBeInTheDocument();
  });

  it("mostra le date come gg/mm/aaaa", () => {
    render(<GraficoDaAnalisi serie={serie} tipo="tabella" />);
    expect(screen.getByText("05/10/2026")).toBeInTheDocument();
    expect(screen.getByText("17/09/2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-10-05")).not.toBeInTheDocument();
  });
});

describe("albero dei campi", () => {
  it("elenca ogni dimensione che almeno una misura ammette (CAP e provincia compresi)", () => {
    const nellAlbero = new Set(GRUPPI_DIMENSIONI.flatMap((gruppo) => gruppo.dimensioni));
    const ammesse = new Set(
      (Object.keys(CATALOGO) as ChiaveMetrica[]).flatMap((metrica) => dimensioniPerMetrica(metrica))
    );
    // bu_categoria serve solo ai filtri a matrioska: non si spunta.
    const mancanti = [...ammesse].filter((d) => d !== "bu_categoria" && !nellAlbero.has(d));
    expect(mancanti).toEqual([]);
  });

  it("offre la mappa quando il dato è suddiviso per CAP", () => {
    const perCap = {
      spec: { metrica: "visite_numero", raggruppa: ["cap"] },
      metrica: "visite_numero",
      unita: "numero",
      totale: 3,
      certificata: true,
      avvisi: [],
      righe: [
        { etichetta: "24100", chiavi: { cap: "24100" }, valore: 2, conteggio: 2 },
        { etichetta: "20100", chiavi: { cap: "20100" }, valore: 1, conteggio: 1 },
      ],
    } as unknown as RisultatoQuery;
    expect(graficiPossibili(perCap)).toContain("mappa");
  });
});
