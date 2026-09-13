import { describe, expect, it } from "vitest";
import { eseguiPropostaAnalisi, type AnalisiProposta } from "@/lib/prototipo-bi/analista";
import { verificaNumeri, type ValoreNoto } from "@/lib/prototipo-bi/verifica-numeri";
import type { RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

function riga(importo: number, bu: string, documento: string): RigaFatto {
  return {
    data: "2026-03-10",
    importo,
    bu,
    categoria: "",
    agente: "Agente",
    codiceAgente: "A1",
    cliente: "Cliente",
    codiceCliente: "C1",
    documento,
    articolo: "ART",
    descrizioneArticolo: "Articolo",
    quantita: 1,
  };
}

const SNAPSHOT: Snapshot = {
  generatoIl: "2026-03-11T08:00:00.000Z",
  runCorrente: "run-1",
  runRicevutoIl: "2026-03-11T07:00:00.000Z",
  dataMassima: "2026-03-10",
  dataMinima: "2026-01-01",
  dataset: {
    ordinato: [riga(1_100, "COMPONENTI", "D1"), riga(550, "IMPIANTI", "D2")],
    fatturato: [],
    consegnato: [],
    portafoglio: [],
    preventivi_aperti: [],
    controllo_banco: [],
    consegnato_futuro_per_mese: [],
  },
  conteggi: { ordinato: 2 },
};

function destinazione() {
  return {
    analisi: [] as AnalisiProposta[],
    valoriNoti: [] as ValoreNoto[],
  };
}

describe("proponi_analisi", () => {
  it("produce un'analisi eseguita con grafico scelto e motivo", () => {
    const raccolta = destinazione();
    const esito = eseguiPropostaAnalisi(
      {
        titolo: "Ordinato per business unit, 2026",
        spec: { metrica: "ordinato", raggruppa: ["bu"], periodo: { anno: 2026 } },
        commento: "Confronta il peso delle business unit.",
      },
      SNAPSHOT,
      raccolta
    );

    expect(JSON.parse(esito)).toMatchObject({
      titolo: "Ordinato per business unit, 2026",
      grafico: "torta",
      totale: 1_650,
      righe: 2,
    });
    expect(raccolta.analisi).toHaveLength(1);
    expect(raccolta.analisi[0]).toMatchObject({
      grafico: "torta",
      risultato: { totale: 1_650, unita: "euro" },
    });
    expect(raccolta.analisi[0]?.motivoGrafico).toContain("categorie");
  });

  it("restituisce l'errore al modello e consente al ciclo di proseguire", () => {
    const raccolta = destinazione();
    const fallita = eseguiPropostaAnalisi(
      { titolo: "Analisi non valida", spec: { metrica: "inesistente" } },
      SNAPSHOT,
      raccolta
    );

    expect(JSON.parse(fallita)).toHaveProperty("errore");
    expect(raccolta.analisi).toHaveLength(0);

    const successiva = eseguiPropostaAnalisi(
      { titolo: "Totale ordinato", spec: { metrica: "ordinato" } },
      SNAPSHOT,
      raccolta
    );
    expect(JSON.parse(successiva)).not.toHaveProperty("errore");
    expect(raccolta.analisi).toHaveLength(1);
  });

  it("alimenta i valori noti con l'unita corretta per la verifica numerica", () => {
    const raccolta = destinazione();
    eseguiPropostaAnalisi(
      {
        titolo: "Ordinato per business unit",
        spec: { metrica: "ordinato", raggruppa: ["bu"] },
      },
      SNAPSHOT,
      raccolta
    );

    expect(raccolta.valoriNoti).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ valore: 1_650, unita: "euro" }),
        expect.objectContaining({ valore: 1_100, unita: "euro" }),
        expect.objectContaining({ valore: 550, unita: "euro" }),
      ])
    );
    expect(verificaNumeri("Il totale e 1.650 euro.", raccolta.valoriNoti).nonVerificati).toBe(0);
  });
});
