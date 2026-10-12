import { describe, expect, it } from "vitest";
import { costruisciContesto, rilevaTutto } from "@/lib/prototipo-bi/rilevatori";
import { RILEVATORI_ESTESI } from "@/lib/prototipo-bi/rilevatori-estesi";
import { FAMIGLIE_RILEVATORI } from "@/lib/prototipo-bi/tipi";
import type { FamigliaRilevatore, RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

const OGGI = "2026-10-09";

function riga(p: Partial<RigaFatto>): RigaFatto {
  return {
    data: OGGI,
    importo: 0,
    bu: "",
    categoria: "-",
    agente: "ROSSI",
    codiceAgente: "R",
    cliente: "CLIENTE",
    codiceCliente: "C1",
    documento: "D1",
    articolo: "",
    descrizioneArticolo: "",
    quantita: 1,
    ...p,
  };
}

function snapshot(extra: Partial<Snapshot["dataset"]>): Snapshot {
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
      ...extra,
    },
  };
}

function segnaliDi(s: Snapshot, famiglia: FamigliaRilevatore, agente?: string) {
  return rilevaTutto(costruisciContesto(s, null, agente)).filter((x) => x.famiglia === famiglia);
}

describe("rilevatori estesi", () => {
  it("ogni famiglia nuova ha un rilevatore e nessun dataset assente fa uscire errori", () => {
    const vuoto = rilevaTutto(costruisciContesto(snapshot({}), null));
    expect(vuoto.filter((s) => s.id.startsWith("errore-"))).toEqual([]);
    expect(RILEVATORI_ESTESI.length).toBe(16);
    expect(FAMIGLIE_RILEVATORI.length).toBe(29);
  });

  it("incassi scaduti: somma i saldi A con data passata e ignora i P e i futuri", () => {
    const s = snapshot({
      scadenze: [
        riga({ tipoScadenza: "A", data: "2026-08-01", saldoAperto: 30_000, cliente: "ALFA", codiceCliente: "A" }),
        riga({ tipoScadenza: "A", data: "2026-09-20", saldoAperto: 5_000, cliente: "BETA", codiceCliente: "B" }),
        riga({ tipoScadenza: "A", data: "2026-10-30", saldoAperto: 99_000, cliente: "GAMMA", codiceCliente: "G" }),
        riga({ tipoScadenza: "P", data: "2026-08-01", saldoAperto: 77_000, fornitore: "F" }),
      ],
    });
    const [sig] = segnaliDi(s, "incassi_scaduti");
    expect(sig.magnitudineEuro).toBe(35_000);
    expect(sig.direzione).toBe("negativo");
  });

  it("incassi scaduti: sotto soglia non esce", () => {
    const s = snapshot({ scadenze: [riga({ tipoScadenza: "A", data: "2026-08-01", saldoAperto: 1_000 })] });
    expect(segnaliDi(s, "incassi_scaduti")).toEqual([]);
  });

  it("pagamenti ai fornitori: conta scaduti e in scadenza entro 14 giorni, non oltre", () => {
    const s = snapshot({
      scadenze: [
        riga({ tipoScadenza: "P", data: "2026-10-01", saldoAperto: 20_000, fornitore: "UNO" }),
        riga({ tipoScadenza: "P", data: "2026-10-15", saldoAperto: 15_000, fornitore: "DUE" }),
        riga({ tipoScadenza: "P", data: "2026-12-15", saldoAperto: 500_000, fornitore: "TRE" }),
      ],
    });
    const [sig] = segnaliDi(s, "pagamenti_fornitori");
    expect(sig.magnitudineEuro).toBe(35_000);
    expect(sig.direzione).toBe("negativo");
  });

  it("cassa a 30 giorni: segnala la settimana con uscite molto sopra le entrate", () => {
    const s = snapshot({
      scadenze: [
        riga({ tipoScadenza: "A", data: "2026-10-12", saldoAperto: 5_000 }),
        riga({ tipoScadenza: "P", data: "2026-10-13", saldoAperto: 45_000, fornitore: "F" }),
      ],
    });
    const [sig] = segnaliDi(s, "cassa_30_giorni");
    expect(sig.magnitudineEuro).toBe(40_000);
  });

  it("clienti che pagano tardi: confronta il cliente con se stesso", () => {
    const fatture = (mese: string, giorni: number, n: number) =>
      Array.from({ length: n }, (_, i) =>
        riga({
          profilo: "FC",
          data: `${mese}-0${i + 1}`,
          giorniMedi: giorni,
          importoScadenze: 5_000,
          cliente: "LENTO",
          codiceCliente: "L",
        })
      );
    const s = snapshot({
      pagamenti: [...fatture("2026-08", 90, 4), ...fatture("2025-11", 60, 4)],
    });
    const [sig] = segnaliDi(s, "clienti_pagano_tardi");
    expect(sig.magnitudineEuro).toBe(20_000);
  });

  it("articoli scoperti: ordini cliente oltre giacenza e ordini fornitore, al costo", () => {
    const s = snapshot({
      articoli: [
        riga({ articolo: "A1", documento: "A1", esistenza: 10, qtaOrdClienti: 110, qtaOrdFornitori: 20, ultimoCosto: 200, valoreGiacenza: 2_000 }),
        riga({ articolo: "A2", documento: "A2", esistenza: 50, qtaOrdClienti: 10, qtaOrdFornitori: 0, ultimoCosto: 500, valoreGiacenza: 25_000 }),
      ],
    });
    const [sig] = segnaliDi(s, "articoli_scoperti");
    expect(sig.magnitudineEuro).toBe(16_000); // (110 - 10 - 20) * 200
  });

  it("giacenza ferma: esclude gli articoli che si sono mossi", () => {
    const s = snapshot({
      articoli: [
        riga({ articolo: "FERMO", documento: "FERMO", esistenza: 10, ultimoCosto: 4_000, valoreGiacenza: 40_000 }),
        riga({ articolo: "VIVO", documento: "VIVO", esistenza: 10, ultimoCosto: 9_000, valoreGiacenza: 90_000 }),
      ],
      fatturato: [riga({ articolo: "vivo", data: "2026-09-01", importo: 100 })],
    });
    const [sig] = segnaliDi(s, "giacenza_ferma");
    expect(sig.magnitudineEuro).toBe(40_000);
  });

  it("clienti senza visite: ordinano ma l'ultima visita e' vecchia o manca", () => {
    const ordini = Array.from({ length: 6 }, (_, i) =>
      riga({ cliente: `CLI${i}`, codiceCliente: `K${i}`, importo: 12_000, data: "2026-09-01" })
    );
    const s = snapshot({
      ordinato: ordini,
      visite: [riga({ codiceCliente: "K0", cliente: "CLI0", data: "2026-09-15" })],
    });
    const [sig] = segnaliDi(s, "clienti_senza_visite");
    expect(sig.magnitudineEuro).toBe(60_000); // K1..K5
  });

  it("clienti senza visite: nello scope di un agente restano solo i suoi", () => {
    const ordini = [
      ...Array.from({ length: 6 }, (_, i) => riga({ cliente: `R${i}`, codiceCliente: `R${i}`, importo: 30_000, agente: "ROSSI" })),
      ...Array.from({ length: 6 }, (_, i) => riga({ cliente: `B${i}`, codiceCliente: `B${i}`, importo: 30_000, agente: "BIANCHI" })),
    ];
    const s = snapshot({ ordinato: ordini, visite: [riga({ codiceCliente: "ALTRO", data: "2026-01-01" })] });
    const [sig] = segnaliDi(s, "clienti_senza_visite", "ROSSI");
    expect(sig.magnitudineEuro).toBe(180_000);
  });

  it("i rilevatori aziendali tacciono nel briefing di un agente", () => {
    const s = snapshot({
      scadenze: [riga({ tipoScadenza: "P", data: "2026-10-01", saldoAperto: 90_000, fornitore: "F" })],
    });
    expect(segnaliDi(s, "pagamenti_fornitori")).toHaveLength(1);
    expect(segnaliDi(s, "pagamenti_fornitori", "ROSSI")).toEqual([]);
  });

  it("fatture fornitore senza ordine: conta solo le righe senza profilo ordine", () => {
    const s = snapshot({
      fatture_fornitore: [
        riga({ profilo: "FF", data: "2026-09-20", importo: 30_000, fornitore: "UNO", profiloOrdine: "" }),
        riga({ profilo: "FF", data: "2026-09-20", importo: 40_000, fornitore: "DUE", profiloOrdine: "BF" }),
      ],
    });
    const [sig] = segnaliDi(s, "fatture_senza_ordine");
    expect(sig.magnitudineEuro).toBe(30_000);
  });

  it("dipendenza da un fornitore: oltre il 40% dei 12 mesi", () => {
    const s = snapshot({
      fatture_fornitore: [
        riga({ profilo: "FF", data: "2026-05-01", importo: 90_000, fornitore: "GRANDE" }),
        riga({ profilo: "FF", data: "2026-05-01", importo: 60_000, fornitore: "PICCOLO" }),
      ],
    });
    const [sig] = segnaliDi(s, "dipendenza_fornitore");
    expect(sig.magnitudineEuro).toBe(90_000);
  });

  it("clienti senza agente: solo con valore e numero minimi", () => {
    const ordini = Array.from({ length: 3 }, (_, i) =>
      riga({ cliente: `S${i}`, codiceCliente: `S${i}`, agente: "(senza agente)", importo: 10_000, data: "2026-08-01" })
    );
    const [sig] = segnaliDi(snapshot({ ordinato: ordini }), "clienti_senza_agente");
    expect(sig.magnitudineEuro).toBe(30_000);
  });

  it("spese di trasporto e vettore unico", () => {
    const spedizioni = [
      ...Array.from({ length: 60 }, (_, i) =>
        riga({ direzioneMerce: "Merce in uscita", data: "2026-09-0" + ((i % 8) + 1), vettore: "BRT", pesoLordo: 200, speseTrasporto: 60, documento: `T${i}` })
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        riga({ direzioneMerce: "Merce in uscita", data: "2026-03-0" + ((i % 8) + 1), vettore: "BRT", pesoLordo: 1_000, speseTrasporto: 100, documento: `P${i}` })
      ),
    ];
    const s = snapshot({ spedizioni });
    const [costo] = segnaliDi(s, "trasporto_costo");
    expect(costo.magnitudineEuro).toBeGreaterThan(1_500);
    const [vettore] = segnaliDi(s, "vettore_concentrato");
    expect(vettore.titolo).toContain("BRT");
  });
});
