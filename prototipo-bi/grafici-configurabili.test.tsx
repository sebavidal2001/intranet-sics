/**
 * Le richieste del 25/09/2026 sui grafici del BI:
 *
 *  · più anni insieme (il 2027 delle consegne non si vedeva senza cambiare anno);
 *  · la tabella con più misure nel tempo non deve schiacciare mesi e settimane;
 *  · ordinamento e totale scelto (somma, media…) nelle tabelle;
 *  · colori, legenda e assi per riquadro, con i colori SICS per business unit.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  anniDelPeriodo,
  dataNelPeriodo,
  descriviPeriodo,
  normalizzaPeriodo,
  spostaPeriodo,
} from "@/lib/prototipo-bi/periodo";
import { esegui, validaSpec } from "@/lib/prototipo-bi/semantico";
import { anniDellaSpec } from "@/lib/prototipo-bi/budget-fonte";
import { fondiFiltriPagina } from "@/lib/prototipo-bi/filtri-pagina";
import {
  AspettoNonValido,
  COLORI_BU,
  COLORI_SICS,
  coloreFissato,
  validaAspetto,
} from "@/lib/prototipo-bi/aspetto";
import { GraficoDaAnalisi, GraficoDaRisultato } from "@/components/prototipo-bi/grafico-da-risultato";
import { TabellaAnalitica } from "@/components/prototipo-bi/tabella-analitica";
import { PALETTE_DISPONIBILI } from "@/components/prototipo-bi/impostazioni";
import type {
  RigaFatto,
  RisultatoQuery,
  SerieAnalisiEseguita,
  Snapshot,
} from "@/lib/prototipo-bi/tipi";

function riga(data: string, importo: number, bu = "COMPONENTI"): RigaFatto {
  return {
    data,
    importo,
    bu,
    categoria: "",
    agente: "Agente",
    codiceAgente: "A1",
    cliente: "Cliente",
    codiceCliente: "C1",
    documento: `D-${data}-${bu}`,
    articolo: "ART",
    descrizioneArticolo: "Articolo",
    quantita: 1,
  };
}

const SNAPSHOT = {
  generatoIl: "2026-09-25T08:00:00.000Z",
  runCorrente: "run-1",
  runRicevutoIl: "2026-09-25T07:00:00.000Z",
  dataMassima: "2026-09-24",
  dataMassimaAssoluta: "2027-03-31",
  dataMinima: "2025-01-01",
  dataset: {
    ordinato: [],
    fatturato: [],
    consegnato: [],
    portafoglio: [
      riga("2025-11-10", 100),
      riga("2026-10-05", 200),
      riga("2027-02-15", 400),
      riga("2027-03-20", 800, "IMPIANTI"),
    ],
    preventivi_aperti: [],
    controllo_banco: [],
    consegnato_futuro_per_mese: [],
    acquisti: [],
  },
  conteggi: {},
} as unknown as Snapshot;

describe("periodo con più anni", () => {
  it("una data sta nel periodo se il suo anno è fra quelli scelti", () => {
    const periodo = { anni: [2025, 2027] };
    expect(dataNelPeriodo("2025-06-01", periodo)).toBe(true);
    expect(dataNelPeriodo("2026-06-01", periodo)).toBe(false);
    expect(dataNelPeriodo("2027-01-01", periodo)).toBe(true);
  });

  it("anni e intervallo valgono insieme", () => {
    expect(dataNelPeriodo("2027-05-01", { anni: [2027], al: "2027-03-31" })).toBe(false);
    expect(dataNelPeriodo("2027-03-01", { anni: [2027], al: "2027-03-31" })).toBe(true);
  });

  it("la forma storica con un anno solo resta valida", () => {
    expect(anniDelPeriodo({ anno: 2026 })).toEqual([2026]);
    expect(dataNelPeriodo("2026-02-01", { anno: 2026 })).toBe(true);
  });

  it("l'anno precedente sposta tutti gli anni", () => {
    expect(spostaPeriodo({ anni: [2026, 2027], al: "2027-06-30" }, -1)).toEqual({
      anni: [2025, 2026],
      al: "2026-06-30",
    });
  });

  it("la validazione tiene anni validi, ordinati e senza doppioni", () => {
    expect(normalizzaPeriodo({ anni: [2027, "2025", 2027, 1800, "x"] })).toEqual({ anni: [2025, 2027] });
    expect(validaSpec({ metrica: "portafoglio", periodo: { anni: [2027, 2026] } }).periodo).toEqual({
      anni: [2026, 2027],
    });
  });

  it("si descrive in parole", () => {
    expect(descriviPeriodo({ anni: [2025, 2027] })).toBe("2025, 2027");
    expect(descriviPeriodo({ anni: [2025, 2026, 2027] })).toBe("2025–2027");
  });

  it("il motore include il 2027 quando lo si sceglie", () => {
    const soloOggi = esegui(validaSpec({ metrica: "portafoglio", periodo: { anno: 2026 } }), SNAPSHOT);
    const conIl2027 = esegui(
      validaSpec({ metrica: "portafoglio", periodo: { anni: [2026, 2027] }, granularita: "mese" }),
      SNAPSHOT
    );
    expect(soloOggi.totale).toBe(200);
    expect(conIl2027.totale).toBe(1_400);
    expect(conIl2027.righe.map((r) => r.etichetta)).toEqual(["2026-10", "2027-02", "2027-03"]);
  });

  it("budget e BEP sanno quali anni servono", () => {
    expect(
      anniDellaSpec(
        { metrica: "budget", periodo: { anni: [2027, 2025] } },
        { dataMinima: "2025-01-01", dataMassima: "2026-09-24" }
      )
    ).toEqual([2025, 2027]);
  });

  it("gli anni della pagina completano un riquadro senza periodo", () => {
    const spec = fondiFiltriPagina({ metrica: "portafoglio" }, { periodo: { anni: [2026, 2027] } });
    expect(spec.periodo).toEqual({ anni: [2026, 2027] });
  });
});

describe("aspetto del riquadro", () => {
  it("accetta solo colori #rrggbb", () => {
    expect(() => validaAspetto({ colori: { COMPONENTI: "red" } })).toThrow(AspettoNonValido);
    expect(() => validaAspetto({ colori: { COMPONENTI: "url(#x)" } })).toThrow(AspettoNonValido);
    expect(validaAspetto({ colori: { COMPONENTI: "#95C11F" } })).toEqual({
      colori: { COMPONENTI: "#95c11f" },
    });
  });

  it("un aspetto vuoto si salva come null", () => {
    expect(validaAspetto({})).toBeNull();
    expect(validaAspetto({ asseX: {}, tabella: {} })).toBeNull();
  });

  it("rifiuta estremi dell'asse al contrario e totali sconosciuti", () => {
    expect(() => validaAspetto({ asseY: { minimo: 10, massimo: 5 } })).toThrow(AspettoNonValido);
    expect(() => validaAspetto({ tabella: { totale: "mediana" } })).toThrow(AspettoNonValido);
    expect(validaAspetto({ legenda: "destra", tabella: { totale: "media" } })).toEqual({
      legenda: "destra",
      tabella: { totale: "media" },
    });
  });

  it("le business unit hanno i colori del report, sulla palette SICS", () => {
    expect(COLORI_BU.COMPONENTI).toBe(COLORI_SICS.verde);
    expect(COLORI_BU.IMPIANTI).toBe(COLORI_SICS.rosso);
    expect(COLORI_BU.COSTRUITO).toBe(COLORI_SICS.arancio);
    expect(Object.values(COLORI_SICS)).toContain(COLORI_BU.STRUTTURE);
    expect(PALETTE_DISPONIBILI[0].serie.slice(0, 6).sort()).toEqual(Object.values(COLORI_SICS).sort());
  });

  it("il colore scelto nel riquadro prevale su quello della business unit", () => {
    expect(coloreFissato("IMPIANTI", null)).toBe(COLORI_SICS.rosso);
    expect(coloreFissato("IMPIANTI", { colori: { IMPIANTI: "#000000" } })).toBe("#000000");
    expect(coloreFissato("Un cliente", null)).toBeUndefined();
  });
});

function risultato(metrica: RisultatoQuery["metrica"], righe: [string, number][]): RisultatoQuery {
  return {
    spec: { metrica, granularita: "mese" },
    metrica,
    unita: "euro",
    righe: righe.map(([etichetta, valore]) => ({
      etichetta,
      chiavi: { periodo: etichetta },
      valore,
      conteggio: 1,
    })),
    totale: righe.reduce((s, [, v]) => s + v, 0),
    certificata: true,
    avvisi: [],
  };
}

describe("tabella con più misure nel tempo", () => {
  const serie: SerieAnalisiEseguita[] = [
    {
      ruolo: "principale",
      nome: "Ordinato",
      spec: { metrica: "ordinato", granularita: "mese" },
      risultato: risultato("ordinato", [["2026-01", 100], ["2026-02", 300]]),
    },
    {
      ruolo: "obiettivo",
      nome: "Budget",
      spec: { metrica: "budget", granularita: "mese" },
      risultato: risultato("budget", [["2026-01", 200], ["2026-02", 200]]),
    },
  ];

  it("tiene i mesi sulle righe e una colonna per misura", () => {
    render(<GraficoDaAnalisi serie={serie} tipo="tabella" />);
    const tabella = screen.getByRole("table");
    expect(within(tabella).getByRole("button", { name: /Ordina per Periodo/ })).toBeInTheDocument();
    expect(within(tabella).getByText("2026-01")).toBeInTheDocument();
    expect(within(tabella).getByText("2026-02")).toBeInTheDocument();
    expect(within(tabella).getByRole("button", { name: "Ordina per Ordinato" })).toBeInTheDocument();
    expect(within(tabella).getByRole("button", { name: "Ordina per Budget" })).toBeInTheDocument();
    // Raggiungimento del totale: 400 / 400.
    const piede = tabella.querySelector("tfoot")!;
    expect(piede.textContent).toContain("100%");
  });

  it("l'ordine di partenza è quello del tempo", () => {
    render(<GraficoDaAnalisi serie={serie} tipo="tabella" />);
    const righe = screen.getAllByRole("row").slice(1, 3).map((r) => r.textContent ?? "");
    expect(righe[0]).toContain("2026-01");
    expect(righe[1]).toContain("2026-02");
  });
});

describe("totali e ordinamento delle tabelle", () => {
  const colonne = [{ chiave: "valore", etichetta: "Valore", tipo: "numero" as const, unita: "numero" as const }];
  const righe = [
    { chiave: "Beta", celle: { valore: 30 } },
    { chiave: "Alfa", celle: { valore: 10 } },
    { chiave: "Gamma", celle: { valore: 20 } },
  ];

  it("la riga dei totali si sceglie: somma, media, massimo", () => {
    render(<TabellaAnalitica colonne={colonne} righe={righe} ricercabile={false} />);
    const piede = () => screen.getByRole("table").querySelector("tfoot")!.textContent ?? "";
    expect(piede()).toContain("60");
    fireEvent.change(screen.getByLabelText("Riga dei totali"), { target: { value: "media" } });
    expect(piede()).toContain("Media");
    expect(piede()).toContain("20");
    fireEvent.change(screen.getByLabelText("Riga dei totali"), { target: { value: "massimo" } });
    expect(piede()).toContain("30");
    fireEvent.change(screen.getByLabelText("Riga dei totali"), { target: { value: "nessuno" } });
    expect(screen.getByRole("table").querySelector("tfoot")).toBeNull();
  });

  it("si ordina anche per la colonna delle voci", () => {
    render(<TabellaAnalitica colonne={colonne} righe={righe} ricercabile={false} />);
    const prima = () => screen.getAllByRole("row")[1].textContent ?? "";
    expect(prima()).toContain("Beta"); // di partenza: valore decrescente
    fireEvent.click(screen.getByRole("button", { name: "Ordina per Voce" }));
    expect(prima()).toContain("Alfa");
    fireEvent.click(screen.getByRole("button", { name: "Ordina per Voce" }));
    expect(prima()).toContain("Gamma");
  });

  it("la tabella di un risultato per mese e business unit diventa un incrocio", () => {
    const perMeseEBu: RisultatoQuery = {
      spec: { metrica: "ordinato", granularita: "mese", raggruppa: ["bu"] },
      metrica: "ordinato",
      unita: "euro",
      righe: [
        { etichetta: "2026-01 · COMPONENTI", chiavi: { periodo: "2026-01", bu: "COMPONENTI" }, valore: 10, conteggio: 1 },
        { etichetta: "2026-01 · IMPIANTI", chiavi: { periodo: "2026-01", bu: "IMPIANTI" }, valore: 5, conteggio: 1 },
        { etichetta: "2026-02 · COMPONENTI", chiavi: { periodo: "2026-02", bu: "COMPONENTI" }, valore: 7, conteggio: 1 },
      ],
      totale: 22,
      certificata: true,
      avvisi: [],
    };
    render(<GraficoDaRisultato risultato={perMeseEBu} tipo="tabella" />);
    const tabella = screen.getByRole("table");
    expect(within(tabella).getByRole("button", { name: "Ordina per COMPONENTI" })).toBeInTheDocument();
    expect(within(tabella).getByRole("button", { name: "Ordina per IMPIANTI" })).toBeInTheDocument();
    expect(within(tabella).getAllByRole("row")).toHaveLength(1 + 2 + 1); // intestazione, due mesi, totali
  });
});
