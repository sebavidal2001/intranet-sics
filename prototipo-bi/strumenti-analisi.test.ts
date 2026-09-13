/**
 * Verifica gli strumenti analitici senza rete né database, perché i calcoli
 * che sostengono una risposta AI devono essere riproducibili in isolamento.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chiediAnalista,
  eseguiStrumentoAnalisi,
  type NomeStrumentoAnalisi,
} from "@/lib/prototipo-bi/analista";
import { instrada } from "@/lib/prototipo-bi/modelli";
import type { RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

function riga(data: string, cliente: string, importo: number): RigaFatto {
  return {
    data,
    importo,
    bu: cliente === "Alfa" ? "COMPONENTI" : "IMPIANTI",
    categoria: "",
    agente: cliente === "Alfa" ? "Anna" : "Bruno",
    codiceAgente: cliente === "Alfa" ? "AA" : "BB",
    cliente,
    codiceCliente: cliente,
    documento: `${data}-${cliente}`,
    articolo: "A1",
    descrizioneArticolo: "Articolo",
    quantita: 1,
  };
}

function snapshotCon(righe: RigaFatto[], dataMassima = "2026-03-31"): Snapshot {
  return {
    generatoIl: "2026-04-01T08:00:00.000Z",
    runCorrente: "run-test",
    runRicevutoIl: "2026-04-01T07:00:00.000Z",
    dataMinima: "2025-01-01",
    dataMassima,
    dataset: {
      ordinato: righe,
      fatturato: [],
      consegnato: [],
      portafoglio: [],
      preventivi_aperti: [],
      controllo_banco: [],
      consegnato_futuro_per_mese: [],
    },
    conteggi: { ordinato: righe.length },
  };
}

const SNAPSHOT = snapshotCon([
  riga("2025-01-10", "Alfa", 100),
  riga("2025-01-10", "Beta", 300),
  riga("2026-01-10", "Alfa", 500),
  riga("2026-01-10", "Beta", 200),
  riga("2026-01-10", "Gamma", 100),
]);

function leggi<T>(testo: string): T {
  return JSON.parse(testo) as T;
}

describe("Instradamento analitico", () => {
  it("riconosce le radici flesse della domanda reale", () => {
    expect(instrada("quali sono degli andamenti anomali per vari clienti?").complessita).toBe("analitica");

    // Le radici corte non devono scattare in mezzo a una parola: "fiscale",
    // "locale" e "calendario" contengono "cal" ma non chiedono un'analisi, e
    // farli salire di livello significa pagare il modello grande per un
    // numero solo.
    expect(instrada("qual è il fatturato fiscale 2026").complessita).toBe("semplice");
    expect(instrada("ordinato del calendario di agosto").complessita).toBe("semplice");
    // Il calo vero, invece, resta analitico.
    expect(instrada("il calo di agosto").complessita).toBe("analitica");
  });

  it.each([
    ["due anni", "ordinato nel 2025 e nel 2026"],
    ["due mesi", "ordinato di marzo e aprile"],
    ["negazione e acquisto", "clienti che non hanno acquistato"],
    ["superlativo", "i clienti con più ordinato"],
    ["più dimensioni", "ordinato per clienti e agenti"],
  ])("sale con il segnale strutturale %s", (_nome, domanda) => {
    expect(instrada(domanda).complessita).toBe("analitica");
  });
});

describe("Strumenti deterministici di analisi", () => {
  it("confronta i periodi e ordina per variazione assoluta", () => {
    const risultato = leggi<{
      righe: Array<{ etichetta: string; valoreA: number; valoreB: number; delta: number }>;
    }>(eseguiStrumentoAnalisi("confronta_periodi", {
      metrica: "ordinato",
      periodoA: { anno: 2025 },
      periodoB: { anno: 2026 },
      raggruppa: "cliente",
    }, SNAPSHOT));

    expect(risultato.righe.map((voce) => voce.etichetta)).toEqual(["Alfa", "Beta", "Gamma"]);
    expect(risultato.righe.map((voce) => voce.delta)).toEqual([400, -100, 100]);
  });

  it("ricostruisce esattamente la variazione totale dai contributi", () => {
    const risultato = leggi<{
      variazioneTotale: number;
      sommaContributi: number;
      verifica: boolean;
      contributi: Array<{ contributo: number }>;
    }>(eseguiStrumentoAnalisi("scomponi_variazione", {
      metrica: "ordinato",
      da: { anno: 2025 },
      a: { anno: 2026 },
      dimensione: "cliente",
    }, SNAPSHOT));

    expect(risultato.sommaContributi).toBe(risultato.variazioneTotale);
    expect(risultato.contributi.reduce((somma, voce) => somma + voce.contributo, 0))
      .toBe(risultato.variazioneTotale);
    expect(risultato.verifica).toBe(true);
  });

  it("porta la quota cumulata al cento per cento sull'elenco completo", () => {
    const risultato = leggi<{ righe: Array<{ quotaCumulata: number }> }>(
      eseguiStrumentoAnalisi("classifica", {
        metrica: "ordinato",
        dimensione: "cliente",
        verso: "alto",
        quanti: 10,
        periodo: { anno: 2026 },
      }, SNAPSHOT)
    );

    expect(risultato.righe.at(-1)?.quotaCumulata).toBe(100);
  });

  it("rileva un crollo settimanale evidente", () => {
    const importi = [100_000, 104_000, 97_000, 102_000, 99_000, 105_000, 96_000, 101_000, 103_000, 0];
    const date = [
      "2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02",
      "2026-02-09", "2026-02-16", "2026-02-23", "2026-03-02", "2026-03-09",
    ];
    const snapshot = snapshotCon(date.map((data, indice) => riga(data, "Alfa", importi[indice])), "2026-03-16");
    const risultato = leggi<{ segnali: Array<{ famiglia: string }> }>(
      eseguiStrumentoAnalisi("rileva_anomalie", {}, snapshot)
    );

    expect(risultato.segnali.length).toBeGreaterThan(0);
  });

  it.each<[NomeStrumentoAnalisi, unknown]>([
    ["confronta_periodi", { metrica: "inesistente", periodoA: {}, periodoB: {} }],
    ["scomponi_variazione", { metrica: "ordinato", da: { anno: 2025 }, a: { anno: 2026 }, dimensione: "ignota" }],
    ["classifica", { metrica: "ordinato", dimensione: "cliente", verso: "centro" }],
    ["rileva_anomalie", { famiglie: ["fantasia"] }],
  ])("restituisce JSON di errore per %s senza lanciare", (nome, argomento) => {
    expect(() => eseguiStrumentoAnalisi(nome, argomento, SNAPSHOT)).not.toThrow();
    expect(leggi<{ errore?: string }>(eseguiStrumentoAnalisi(nome, argomento, SNAPSHOT)).errore).toBeTruthy();
  });
});

describe("Conclusione dell'analista", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
  });

  it("all'ultimo passo restituisce testo anche se il modello insiste con gli strumenti", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: "INTERPRETAZIONE: ordinato, 2026, cliente\nRisposta parziale sui dati raccolti.",
          tool_calls: [{
            id: "tool-1",
            type: "function",
            function: {
              name: "classifica",
              arguments: JSON.stringify({
                metrica: "ordinato",
                dimensione: "cliente",
                verso: "alto",
                periodo: { anno: 2026 },
              }),
            },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }), { status: 200 })));

    const risposta = await chiediAnalista({ domanda: "quanto ordinato?", snapshot: SNAPSHOT });

    expect(risposta.testo).toContain("Risposta parziale sui dati raccolti");
    expect(risposta.testo).not.toContain("numero massimo di interrogazioni");
  });
});
