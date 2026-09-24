import { describe, expect, it } from "vitest";
import { calcolaPunteggi, costruisciContesto, rilevaTutto } from "@/lib/prototipo-bi/rilevatori";
import {
  fattoreNovita,
  selezionaVoci,
  storicoDaBriefing,
  type StoricoUscite,
} from "@/lib/prototipo-bi/selezione-briefing";
import type { Briefing, FamigliaRilevatore, RigaFatto, Segnale, Snapshot } from "@/lib/prototipo-bi/tipi";

const OGGI = "2026-08-27";

function riga(p: Partial<RigaFatto> & { data: string; importo: number }): RigaFatto {
  return {
    bu: "COMPONENTI",
    categoria: "",
    agente: "VALERIA BATTELANI",
    codiceAgente: "AG000010",
    cliente: "CLIENTE A",
    codiceCliente: "C001",
    documento: "1",
    articolo: "ART1",
    descrizioneArticolo: "Articolo uno",
    quantita: 1,
    ...p,
  };
}

function snapshot(dataset: Partial<Snapshot["dataset"]>): Snapshot {
  return {
    generatoIl: `${OGGI}T06:00:00Z`,
    runCorrente: null,
    runRicevutoIl: null,
    dataMassima: OGGI,
    dataMinima: "2025-01-02",
    conteggi: {},
    dataset: {
      ordinato: [],
      fatturato: [],
      consegnato: [],
      portafoglio: [],
      preventivi_aperti: [],
      controllo_banco: [],
      consegnato_futuro_per_mese: [],
      ...dataset,
    },
  };
}

function segnali(s: Snapshot): Segnale[] {
  return rilevaTutto(costruisciContesto(s, null));
}

function segnale(id: string, famiglia: FamigliaRilevatore, punteggio: number, direzione: Segnale["direzione"] = "negativo"): Segnale {
  return {
    id,
    famiglia,
    titolo: id,
    descrizione: id,
    magnitudineEuro: 1,
    persistenza: 1,
    azionabilita: 1,
    direzione,
    punteggio,
    prove: [],
  };
}

const NESSUNO_STORICO: StoricoUscite = { giorniPerSegnale: new Map(), giorniPerFamiglia: new Map() };

describe("selezione delle voci", () => {
  it("una sola voce per famiglia", () => {
    const scelti = selezionaVoci(
      [
        segnale("budget-ordinato", "scostamento_budget", 9),
        segnale("budget-fatturato", "scostamento_budget", 8),
        segnale("dormienti", "clienti_dormienti", 7),
        segnale("consegne-ritardo", "consegne", 2),
      ],
      NESSUNO_STORICO
    );
    expect(scelti.map((s) => s.id)).toEqual(["budget-ordinato", "dormienti", "consegne-ritardo"]);
  });

  it("la qualita' del dato passa sempre e per prima", () => {
    const scelti = selezionaVoci(
      [
        segnale("budget-ordinato", "scostamento_budget", 9),
        segnale("dormienti", "clienti_dormienti", 7),
        segnale("pipeline-vecchi", "pipeline", 6),
        segnale("qualita-bu-2026", "qualita_dato", 1),
      ],
      NESSUNO_STORICO
    );
    expect(scelti[0].id).toBe("qualita-bu-2026");
    expect(scelti).toHaveLength(3);
  });

  it("una famiglia assente da una settimana prende un posto", () => {
    const storico: StoricoUscite = {
      giorniPerSegnale: new Map(),
      giorniPerFamiglia: new Map<FamigliaRilevatore, number>([
        ["scostamento_budget", 1],
        ["clienti_dormienti", 1],
        ["pipeline", 2],
      ]),
    };
    const scelti = selezionaVoci(
      [
        segnale("budget-ordinato", "scostamento_budget", 9),
        segnale("dormienti", "clienti_dormienti", 7),
        segnale("pipeline-vecchi", "pipeline", 6),
        segnale("costi-acquisto", "costi_acquisto", 1),
      ],
      storico
    );
    expect(scelti.map((s) => s.id)).toEqual(["budget-ordinato", "dormienti", "costi-acquisto"]);
  });

  it("una notizia positiva entra senza scalzare quella di rotazione", () => {
    const storico: StoricoUscite = {
      giorniPerSegnale: new Map(),
      giorniPerFamiglia: new Map<FamigliaRilevatore, number>([
        ["scostamento_budget", 1],
        ["clienti_dormienti", 1],
        ["pipeline", 1],
        ["clienti_ritornati", 1],
      ]),
    };
    const scelti = selezionaVoci(
      [
        segnale("budget-ordinato", "scostamento_budget", 9),
        segnale("dormienti", "clienti_dormienti", 7),
        segnale("pipeline-vecchi", "pipeline", 6),
        segnale("costi-acquisto", "costi_acquisto", 2),
        segnale("clienti-ritornati", "clienti_ritornati", 1, "positivo"),
      ],
      storico
    );
    expect(scelti.map((s) => s.id)).toEqual(["budget-ordinato", "clienti-ritornati", "costi-acquisto"]);
  });

  it("la stessa notizia positiva non si impone a giorni alterni", () => {
    const storico: StoricoUscite = {
      giorniPerSegnale: new Map([["clienti-ritornati", 2]]),
      giorniPerFamiglia: new Map<FamigliaRilevatore, number>([
        ["scostamento_budget", 1],
        ["clienti_dormienti", 1],
        ["pipeline", 1],
        ["clienti_ritornati", 2],
      ]),
    };
    const scelti = selezionaVoci(
      [
        segnale("budget-ordinato", "scostamento_budget", 9),
        segnale("dormienti", "clienti_dormienti", 7),
        segnale("pipeline-vecchi", "pipeline", 6),
        segnale("clienti-ritornati", "clienti_ritornati", 1, "positivo"),
      ],
      storico
    );
    expect(scelti.map((s) => s.id)).not.toContain("clienti-ritornati");
  });

  it("i segnali a punteggio zero non diventano voci", () => {
    expect(selezionaVoci([segnale("errore-x", "qualita_dato", 0)], NESSUNO_STORICO)).toEqual([]);
  });
});

describe("storico e raffreddamento", () => {
  const briefing = (generatoIl: string, voci: Array<[string, FamigliaRilevatore]>): Briefing => ({
    generatoIl,
    dataRiferimento: OGGI,
    runRicevutoIl: null,
    destinatario: "x",
    ruolo: "direzione",
    voci: voci.map(([segnaleId, famiglia], i) => ({
      ordine: i + 1,
      segnaleId,
      famiglia,
      testo: "",
      azioneSuggerita: null,
      certificata: true,
      prove: [],
    })),
    segnaliValutati: 0,
    segnaliScartati: 0,
    motoreAI: "deterministico",
    nota: null,
  });

  it("i briefing di oggi non raffreddano: riaprire la pagina non cambia le notizie", () => {
    const storico = storicoDaBriefing(
      [
        briefing("2026-09-24T07:00:00Z", [["dormienti", "clienti_dormienti"]]),
        briefing("2026-09-21T07:00:00Z", [["budget-ordinato", "scostamento_budget"]]),
      ],
      "2026-09-24"
    );
    expect(storico.giorniPerSegnale.has("dormienti")).toBe(false);
    expect(storico.giorniPerSegnale.get("budget-ordinato")).toBe(3);
    expect(storico.giorniPerFamiglia.get("scostamento_budget")).toBe(3);
  });

  it("il peso torna pieno dopo due settimane", () => {
    expect(fattoreNovita(undefined)).toBe(1);
    expect(fattoreNovita(1)).toBeLessThan(fattoreNovita(5));
    expect(fattoreNovita(5)).toBeLessThan(fattoreNovita(10));
    expect(fattoreNovita(15)).toBe(1);
  });

  it("un segnale uscito ieri scende sotto uno mai uscito, la qualita' no", () => {
    const [a, b, q] = [
      segnale("dormienti", "clienti_dormienti", 0),
      segnale("margine-clienti", "margine", 0),
      segnale("qualita-bu-2026", "qualita_dato", 0),
    ].map((s) => ({ ...s, magnitudineEuro: 100_000 }));
    const ordinati = calcolaPunteggi([a, b, q], {
      giorniDallUltima: new Map([
        ["dormienti", 1],
        ["qualita-bu-2026", 1],
      ]),
    });
    const punti = Object.fromEntries(ordinati.map((s) => [s.id, s.punteggio]));
    expect(punti["dormienti"]).toBeLessThan(punti["margine-clienti"]);
    expect(punti["qualita-bu-2026"]).toBe(punti["margine-clienti"]);
  });
});

describe("rilevatori nuovi", () => {
  it("margine: segnala il cliente che rende meno di prima", () => {
    const fatturato: RigaFatto[] = [];
    // 12 mesi prima: 40% di margine su 40.000 €
    for (let m = 0; m < 8; m++) {
      fatturato.push(riga({ data: `2025-${String(9 + (m % 4)).padStart(2, "0")}-15`, importo: 5_000, quantita: 100, costoUnitario: 30, documento: `P${m}` }));
    }
    // ultimi 90 giorni: 20% su 20.000 €
    for (let m = 0; m < 4; m++) {
      fatturato.push(riga({ data: `2026-0${6 + (m % 2)}-10`, importo: 5_000, quantita: 100, costoUnitario: 40, documento: `R${m}` }));
    }
    const s = segnali(snapshot({ fatturato })).find((x) => x.famiglia === "margine");
    expect(s?.id).toBe("margine-clienti");
    // 20.000 € al 40% di prima = 8.000; ne ha dati 4.000
    expect(s?.magnitudineEuro).toBe(4_000);
  });

  it("margine: ignora le righe senza costo invece di contarle a margine pieno", () => {
    const fatturato = [
      ...Array.from({ length: 8 }, (_, i) => riga({ data: "2025-10-15", importo: 5_000, quantita: 100, costoUnitario: 30, documento: `P${i}` })),
      ...Array.from({ length: 4 }, (_, i) => riga({ data: "2026-07-10", importo: 5_000, quantita: 100, costoUnitario: null, documento: `R${i}` })),
    ];
    expect(segnali(snapshot({ fatturato })).some((x) => x.famiglia === "margine")).toBe(false);
  });

  it("clienti ritornati: chi riordina dopo sei mesi di silenzio e' una notizia positiva", () => {
    const ordinato = [
      riga({ data: "2025-01-10", importo: 1_000, cliente: "TORNATO", codiceCliente: "T1" }),
      riga({ data: "2026-08-20", importo: 8_000, cliente: "TORNATO", codiceCliente: "T1" }),
      riga({ data: "2026-05-01", importo: 3_000, cliente: "ABITUALE", codiceCliente: "A1" }),
      riga({ data: "2026-08-21", importo: 3_000, cliente: "ABITUALE", codiceCliente: "A1" }),
    ];
    const s = segnali(snapshot({ ordinato })).find((x) => x.famiglia === "clienti_ritornati");
    expect(s?.direzione).toBe("positivo");
    expect(s?.magnitudineEuro).toBe(8_000);
    expect(s?.descrizione).toContain("TORNATO");
    expect(s?.descrizione).not.toContain("ABITUALE");
  });

  it("consegne: misura il valore confermato oltre la data chiesta", () => {
    const ordinato = [
      riga({ data: "2026-08-03", importo: 20_000, dataConsegnaRichiesta: "2026-09-01", dataConsegnaConfermata: "2026-09-15" }),
      riga({ data: "2026-08-04", importo: 20_000, dataConsegnaRichiesta: "2026-09-01", dataConsegnaConfermata: "2026-09-01" }),
      riga({ data: "2026-08-05", importo: 5_000 }), // senza date: fuori dal calcolo
    ];
    const s = segnali(snapshot({ ordinato })).find((x) => x.famiglia === "consegne");
    expect(s?.magnitudineEuro).toBe(20_000);
    expect(s?.titolo).toContain("50%");
  });

  it("costi d'acquisto: conta i rincari degli articoli venduti con continuita', non le commesse", () => {
    const fatturato = [
      // Articolo ricorrente: costo da 10 a 12, 3 documenti nell'ultimo anno
      riga({ data: "2025-09-10", importo: 2_000, quantita: 100, costoUnitario: 10, articolo: "RIC", documento: "A" }),
      riga({ data: "2026-01-10", importo: 20_000, quantita: 1_000, costoUnitario: 11, articolo: "RIC", documento: "B" }),
      riga({ data: "2026-04-10", importo: 20_000, quantita: 1_000, costoUnitario: 11.5, articolo: "RIC", documento: "C" }),
      riga({ data: "2026-07-10", importo: 20_000, quantita: 3_000, costoUnitario: 12, articolo: "RIC", documento: "D" }),
      // Commessa: rincaro enorme ma due soli documenti
      riga({ data: "2025-09-10", importo: 5_000, quantita: 1, costoUnitario: 3_000, articolo: "COMM", documento: "X" }),
      riga({ data: "2026-07-10", importo: 9_000, quantita: 1, costoUnitario: 6_000, articolo: "COMM", documento: "Y" }),
    ];
    const s = segnali(snapshot({ fatturato })).find((x) => x.famiglia === "costi_acquisto");
    expect(s?.dettaglio?.totaleArticoli).toBe(1);
    // (12 - 10) x 5.100 pezzi venduti negli ultimi 12 mesi (dal 28/08/2025)
    expect(s?.magnitudineEuro).toBe(10_200);
  });

  it("gli identificativi non contengono la data: altrimenti niente raffreddamento", () => {
    const ordinato = [
      riga({ data: "2025-01-10", importo: 20_000, documento: "1" }),
      riga({ data: "2025-02-10", importo: 20_000, documento: "2" }),
      riga({ data: "2026-08-20", importo: 1_000, cliente: "ALTRO", codiceCliente: "Z" }),
    ];
    const s = segnali(snapshot({ ordinato })).find((x) => x.famiglia === "clienti_dormienti");
    expect(s?.id).toBe("dormienti");
  });
});
