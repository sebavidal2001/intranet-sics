/**
 * I SEI GRAFICI NUOVI E IL COLORE SCELTO A MANO.
 *
 * Il rischio di aggiungere tipi di grafico non è che non disegnino: è che
 * vengano offerti su dati che non li reggono. Un box plot su due osservazioni
 * disegna una scatola che sembra dire qualcosa e non dice niente; uno slope
 * chart su otto periodi è un grafico a linee fatto male. Metà di questi test
 * verifica quindi cosa il sistema **non** propone.
 *
 * L'altra metà è il colore: finisce dentro un attributo SVG `fill`/`stroke`,
 * quindi una stringa arbitraria là dentro non è un problema estetico.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  NOMI_GRAFICI,
  graficiPossibili,
  scegliGrafico,
  type TipoGrafico,
} from "@/lib/prototipo-bi/scelta-grafico";
import { validaSerieAnalisi } from "@/lib/prototipo-bi/analisi-composita";
import { SpecNonValida } from "@/lib/prototipo-bi/semantico";
import {
  Distribuzione,
  Flusso,
  Istogramma,
  Matrice,
  Pendenza,
  Posizioni,
} from "@/components/prototipo-bi/grafici-nuovi";
import { ImpostazioniProvider } from "@/components/prototipo-bi/impostazioni";
import type { Dimensione, RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

/** Serie temporale: `categorie` categorie osservate su `periodi` mesi. */
function nelTempo(categorie: number, periodi: number, raggruppa: Dimensione = "bu"): RisultatoQuery {
  const spec: SpecQuery = { metrica: "ordinato", granularita: "mese", raggruppa: [raggruppa] };
  const righe = [];
  for (let p = 0; p < periodi; p += 1) {
    const periodo = `2026-${String(p + 1).padStart(2, "0")}`;
    for (let c = 0; c < categorie; c += 1) {
      righe.push({
        etichetta: periodo,
        chiavi: { periodo, [raggruppa]: `Cat ${c}` },
        // Valori che si incrociano, così la classifica cambia davvero.
        valore: 1000 + c * 100 + ((p * (c + 1) * 37) % 500),
        conteggio: 1,
      });
    }
  }
  return {
    spec,
    metrica: "ordinato",
    unita: "euro",
    righe,
    totale: righe.reduce((somma, riga) => somma + riga.valore, 0),
    certificata: true,
    avvisi: [],
  };
}

/** Righe non temporali, con i valori dati (per il flusso e l'istogramma). */
function perCategoria(valori: number[], raggruppa: Dimensione | null = "bu"): RisultatoQuery {
  const spec: SpecQuery = { metrica: "ordinato", ...(raggruppa ? { raggruppa: [raggruppa] } : {}) };
  const righe = valori.map((valore, indice) => ({
    etichetta: `Cat ${indice}`,
    chiavi: raggruppa ? { [raggruppa]: `Cat ${indice}` } : {},
    valore,
    conteggio: 1,
  }));
  return {
    spec,
    metrica: "ordinato",
    unita: "euro",
    righe,
    totale: valori.reduce((somma, valore) => somma + valore, 0),
    certificata: true,
    avvisi: [],
  };
}

/** Incrocio di due dimensioni. */
function incrocio(quanteRighe: number, quanteColonne: number): RisultatoQuery {
  const spec: SpecQuery = { metrica: "ordinato", raggruppa: ["bu", "agente"] };
  const righe = [];
  for (let r = 0; r < quanteRighe; r += 1) {
    for (let c = 0; c < quanteColonne; c += 1) {
      righe.push({
        etichetta: `BU ${r}`,
        chiavi: { bu: `BU ${r}`, agente: `Agente ${c}` },
        valore: 500 + r * 100 + c * 10,
        conteggio: 1,
      });
    }
  }
  return {
    spec,
    metrica: "ordinato",
    unita: "euro",
    righe,
    totale: righe.reduce((somma, riga) => somma + riga.valore, 0),
    certificata: true,
    avvisi: [],
  };
}

describe("Quando i sei tipi vengono offerti", () => {
  it("la pendenza serve a confrontare due momenti, e solo due", () => {
    expect(graficiPossibili(nelTempo(3, 2))).toContain("pendenza");
    expect(graficiPossibili(nelTempo(3, 3))).not.toContain("pendenza");
    expect(graficiPossibili(nelTempo(3, 8))).not.toContain("pendenza");
  });

  it("la matrice vuole due dimensioni: con una sola non compare", () => {
    expect(graficiPossibili(incrocio(3, 3))).toContain("matrice");
    expect(graficiPossibili(perCategoria([5, 4, 3]))).not.toContain("matrice");
  });

  it("le posizioni in classifica vogliono almeno tre periodi", () => {
    expect(graficiPossibili(nelTempo(4, 2))).not.toContain("posizioni");
    expect(graficiPossibili(nelTempo(4, 3))).toContain("posizioni");
  });

  it("la distribuzione vuole abbastanza osservazioni per avere quartili veri", () => {
    // Con quattro periodi Q1 coinciderebbe con il minimo e Q3 con il massimo.
    expect(graficiPossibili(nelTempo(3, 4))).not.toContain("distribuzione");
    expect(graficiPossibili(nelTempo(3, 5))).toContain("distribuzione");
  });

  it("il flusso vuole valori che calano, come un imbuto", () => {
    expect(graficiPossibili(perCategoria([100, 70, 40, 10]))).toContain("flusso");
    expect(graficiPossibili(perCategoria([100, 40, 70, 10]))).not.toContain("flusso");
  });

  it("l'istogramma sotto le otto righe sarebbe un grafico a barre travestito", () => {
    expect(graficiPossibili(perCategoria([9, 8, 7, 6, 5]))).not.toContain("istogramma");
    expect(graficiPossibili(perCategoria([9, 8, 7, 6, 5, 4, 3, 2]))).toContain("istogramma");
  });

  it("nessuno dei sei viene offerto quando non c'è un dato", () => {
    const offerti = graficiPossibili(perCategoria([]));
    const nuovi: TipoGrafico[] = [
      "matrice",
      "pendenza",
      "distribuzione",
      "posizioni",
      "flusso",
      "istogramma",
    ];
    for (const tipo of nuovi) expect(offerti).not.toContain(tipo);
  });
});

describe("Cosa il sistema propone da solo", () => {
  it("non propone mai distribuzione, flusso o istogramma", () => {
    // Sono letture specialistiche: chi apre un cruscotto vuole una risposta, e
    // se la vuole in quella forma la sceglie.
    const casi = [
      nelTempo(3, 12),
      nelTempo(1, 8),
      perCategoria([100, 70, 40, 10, 8, 6, 4, 2]),
      incrocio(4, 4),
      perCategoria([50, 30, 20]),
    ];
    for (const caso of casi) {
      expect(["distribuzione", "flusso", "istogramma"]).not.toContain(scegliGrafico(caso).tipo);
    }
  });

  it("ogni tipo proposto è anche fra quelli offerti", () => {
    // Senza questo vincolo la proposta cadrebbe nel ripiego e al posto del
    // grafico comparirebbe un messaggio di errore.
    const casi = [
      nelTempo(3, 2),
      nelTempo(4, 6),
      incrocio(3, 2),
      incrocio(20, 3),
      perCategoria([5, 4, 3]),
    ];
    for (const caso of casi) {
      expect(graficiPossibili(caso)).toContain(scegliGrafico(caso).tipo);
    }
  });

  it("ogni tipo ha un nome da mostrare", () => {
    const tipi = Object.keys(NOMI_GRAFICI) as TipoGrafico[];
    expect(tipi).toContain("matrice");
    for (const tipo of tipi) expect(NOMI_GRAFICI[tipo].length).toBeGreaterThan(0);
  });
});

describe("Il colore scelto a mano", () => {
  const base = { ruolo: "principale" as const, nome: "Ordinato", spec: { metrica: "ordinato" } };

  it("accetta un esadecimale a sei cifre", () => {
    expect(validaSerieAnalisi([{ ...base, colore: "#00a1be" }])[0].colore).toBe("#00a1be");
  });

  it("senza colore la serie resta sulla palette", () => {
    expect(validaSerieAnalisi([base])[0].colore).toBeUndefined();
  });

  it.each([
    ["rosso", "un nome di colore CSS"],
    ["#fff", "la forma a tre cifre"],
    ["#00a1be; fill:url(#x)", "un tentativo di uscire dall'attributo"],
    ["url(#cattivo)", "un riferimento esterno"],
    ["", "la stringa vuota"],
  ])("rifiuta %s: %s", (colore) => {
    expect(() => validaSerieAnalisi([{ ...base, colore }])).toThrow(SpecNonValida);
  });
});

describe("I sei grafici disegnano", () => {
  function disegna(nodo: React.ReactElement) {
    return render(<ImpostazioniProvider>{nodo}</ImpostazioniProvider>);
  }

  it("la matrice produce una tabella", () => {
    const { container } = disegna(<Matrice risultato={incrocio(3, 3)} />);
    expect(container.querySelector("table")).not.toBeNull();
  });

  it.each([
    ["pendenza", (r: RisultatoQuery) => <Pendenza risultato={r} />, nelTempo(4, 2)],
    ["distribuzione", (r: RisultatoQuery) => <Distribuzione risultato={r} />, nelTempo(4, 8)],
    ["posizioni", (r: RisultatoQuery) => <Posizioni risultato={r} />, nelTempo(4, 5)],
    ["flusso", (r: RisultatoQuery) => <Flusso risultato={r} />, perCategoria([100, 70, 40, 10])],
    [
      "istogramma",
      (r: RisultatoQuery) => <Istogramma risultato={r} />,
      perCategoria([9, 8, 7, 6, 5, 4, 3, 2]),
    ],
  ])("%s produce un SVG", (_nome, costruisci, dati) => {
    const { container } = disegna(costruisci(dati));
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("con dati insufficienti dicono cosa manca invece di disegnare il vuoto", () => {
    const { container } = disegna(<Pendenza risultato={nelTempo(3, 7)} />);
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
