import { describe, expect, it } from "vitest";
import {
  classificaCella,
  costruisciPiano,
  eRivenditore,
  leggiClienti,
  serialeExcelAData,
  trovaColonne,
} from "../../scripts/lib/campagne-excel.mjs";

const INTESTAZIONE = [
  "Codice Cliente", "Ragione Sociale", "Cat Commerciale", "Cat Attivitta", "Agente",
  "C01_26 - CP SICS", "C01_26 - CP SICS\nBANCO",
  "C02_26 -ZECA ZETEK", "C02_26 -ZECA ZETEK BANCO",
  "NOTE",
];
const COL = trovaColonne(INTESTAZIONE);
const D = (data: string) => ({ data });

// [codice, nome, catComm, catAttivita, agente, C01, C01banco, C02, C02banco, note]
type Riga = (string | { data: string } | null)[];
const riga = (...v: Riga) => v;

describe("serialeExcelAData", () => {
  it("converte i seriali senza spostamenti di fuso", () => {
    expect(serialeExcelAData(46217)).toBe("2026-07-14");
    expect(serialeExcelAData(46049)).toBe("2026-01-27");
    expect(serialeExcelAData(46217.75)).toBe("2026-07-14");
  });
  it("rifiuta i valori non numerici", () => {
    expect(() => serialeExcelAData(NaN)).toThrow();
  });
});

describe("trovaColonne", () => {
  it("riconosce campagne e colonne BANCO dall'intestazione, con a-capo e spazi", () => {
    expect(COL.campagne.map((c: { codice: string }) => c.codice)).toEqual(["C_01_26", "C_02_26"]);
    expect(COL.campagne[0].colonnaBanco).toBe(6);
    expect(COL.campagne[1].colonnaBanco).toBe(8);
  });
  it("regge una colonna inserita a meta' foglio", () => {
    const col = trovaColonne(["Extra", ...INTESTAZIONE]);
    expect(col.codice).toBe(1);
    expect(col.campagne[0].colonna).toBe(6);
  });
  it("si ferma se mancano il codice cliente o le campagne", () => {
    expect(() => trovaColonne(["Ragione Sociale", "C01_26 - X"])).toThrow(/Codice Cliente/);
    expect(() => trovaColonne(["Codice Cliente", "Ragione Sociale"])).toThrow(/campagna/);
  });
});

describe("classificaCella", () => {
  it("distingue vuota (destinatario) da assente (non destinatario)", () => {
    expect(classificaCella("").tipo).toBe("vuota");
    expect(classificaCella("   ").tipo).toBe("vuota");
    expect(classificaCella(null).tipo).toBe("nessuna");
  });
  it("riconosce X, RIVENDITORE e date", () => {
    expect(classificaCella("x").tipo).toBe("x");
    expect(classificaCella("RIVENDITORE").tipo).toBe("rivenditore");
    expect(classificaCella(D("2026-05-01"))).toEqual({ tipo: "data", data: "2026-05-01" });
  });
  it("segnala il testo che non conosce invece di indovinare", () => {
    expect(classificaCella("boh").tipo).toBe("sconosciuta");
  });
});

describe("eRivenditore", () => {
  it("usa la categoria, come la vista campagne.v_clienti", () => {
    expect(eRivenditore("RIVEND-RIV.UTENSILERIE")).toBe(true);
    expect(eRivenditore("RIV. RIVENDITORI")).toBe(true);
    expect(eRivenditore("RIPARA-RIPARATORI")).toBe(false);
    expect(eRivenditore(null)).toBe(false);
  });
});

describe("piano di import", () => {
  const righe = [
    // consegnata, e destinataria di C02 (cella vuota)
    riga("A1", "Alfa", "Attivo", "UFSTAB", "AIRFLUID", D("2026-03-01"), null, "", null, null),
    // consegnata al banco
    riga("A2", "Beta", "Attivo", "UFSTAB", "AIRFLUID", D("2026-04-02"), "B", "", null, null),
    // busta preparata (X) con una nota del foglio
    riga("A3", "Gamma", "Attivo", "UFSTAB", "AIRFLUID", "X", null, "", null, "SEGUITO DAL SERVICE"),
    // Potenziale con cella vuota: fuori dal pubblico di oggi
    riga("A4", "Delta", "Potenziale", "UFSTAB", "AIRFLUID", "", null, "", null, null),
    // rivenditore per categoria ma cella NON marcata: escluso lo stesso
    riga("A5", "Eps", "Attivo", "RIVEND-RIV.ARTICOLI TECNICI", "AIRFLUID", "", null, "RIVENDITORE", null, null),
    // rivenditore che ha gia' ricevuto C01: l'invio storico si conserva
    riga("A6", "Zeta", "Attivo", "RIVEND-RIV.UTENSILERIE", "AIRFLUID", D("2026-05-05"), null, "RIVENDITORE", null, null),
    // agente non selezionato: cella assente
    riga("A7", "Eta", "Attivo", "UFSTAB", "DANIELE BONI", null, null, null, null, null),
    // cliente nuovo, senza categoria ne' agente
    riga("A8", "Nuovo srl", null, null, null, null, null, null, null, null),
  ];
  const { clienti, avvisi: avvisiLettura } = leggiClienti(righe, COL);
  const piano = costruisciPiano(clienti, COL);
  const c01 = piano.campagne.find((c: { codice: string }) => c.codice === "C_01_26");
  const c02 = piano.campagne.find((c: { codice: string }) => c.codice === "C_02_26");

  it("trasforma date, banco e X negli stati giusti", () => {
    const per = Object.fromEntries(c01.invii.map((i: { codice_cliente: string; stato: string }) => [i.codice_cliente, i.stato]));
    expect(per).toEqual({ A1: "consegnata", A2: "consegnata_banco", A3: "preparata", A6: "consegnata" });
    expect(c01.invii.find((i: { codice_cliente: string }) => i.codice_cliente === "A1").data_consegna).toBe("2026-03-01");
  });

  it("scrive solo invii che la migration accetta", () => {
    for (const i of piano.campagne.flatMap((c: { invii: unknown[] }) => c.invii) as Array<Record<string, unknown>>) {
      expect(i.origine).toBe("import_excel");
      const consegnata = i.stato === "consegnata" || i.stato === "consegnata_banco";
      // invii_data_consegna_coerente: consegna <=> data
      expect(Boolean(i.data_consegna)).toBe(consegnata);
      expect(typeof i.ragione_sociale).toBe("string");
    }
  });

  it("destinatari: cella vuota + Attivo + non rivenditore, piu' chi ha gia' ricevuto", () => {
    expect([...c01.destinatari].sort()).toEqual(["A1", "A2", "A3", "A6"]);
    expect([...c02.destinatari].sort()).toEqual(["A1", "A2", "A3"]);
  });

  it("i Potenziali rientrano solo se lo si chiede", () => {
    const con = costruisciPiano(clienti, COL, { includiPotenziali: true });
    const dest = con.campagne.find((c: { codice: string }) => c.codice === "C_01_26").destinatari;
    expect(dest).toContain("A4");
    expect(c01.stats.esclusiPotenziali).toBe(1);
  });

  it("i rivenditori si ricalcolano dalla categoria, non dal testo della cella", () => {
    expect(c01.destinatari).not.toContain("A5");
    expect(c01.stats.escluseRivenditori).toBe(1);
    expect(piano.avvisi.some((a: { tipo: string; codice: string }) => a.tipo === "rivenditore_con_invio" && a.codice === "A6")).toBe(true);
  });

  it("segnala senza perdere: clienti da verificare e note senza invio", () => {
    expect(piano.daVerificare.map((d: { codice: string }) => d.codice)).toEqual(["A8"]);
    // la nota di A3 finisce nell'invio, non negli avvisi
    expect(c01.invii.find((i: { codice_cliente: string }) => i.codice_cliente === "A3").note).toBe("Nota Excel: SEGUITO DAL SERVICE");
    expect(avvisiLettura).toEqual([]);
  });
});

describe("codici doppi", () => {
  it("fonde le righe e tiene il dato piu' informativo", () => {
    const { clienti, avvisi } = leggiClienti(
      [
        riga("B1", "Rossi srl", "Attivo", "UFSTAB", "AIRFLUID", "", null, null, null, null),
        riga("B1", "Rossi srl", "Attivo", "UFSTAB", "DANIELE BONI", D("2026-02-02"), null, null, null, null),
      ],
      COL
    );
    expect(clienti.size).toBe(1);
    expect(clienti.get("B1").celle.C_01_26.cella).toEqual({ tipo: "data", data: "2026-02-02" });
    expect(avvisi).toHaveLength(1);
    expect(avvisi[0].tipo).toBe("codice_duplicato");
    expect(avvisi[0].dettaglio).toContain("agente AIRFLUID / DANIELE BONI");
  });

  it("ignora le righe senza codice cliente", () => {
    const { clienti } = leggiClienti([riga(null, null, null, null, null, null, null, null, null, null)], COL);
    expect(clienti.size).toBe(0);
  });
});
