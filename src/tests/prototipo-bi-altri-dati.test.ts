import { describe, expect, it } from "vitest";
import { esegui, validaSpec, SpecNonValida } from "@/lib/prototipo-bi/semantico";
import {
  agganciaAnagrafica,
  agganciaCondizioniAcquisti,
  agganciaCondizioniVendite,
  articoloComeFatto,
  clienteComeFatto,
  documentoUtenteComeFatto,
  mappaAnagrafica,
  mappaCondizioni,
  spedizioneComeFatto,
  variazioneCostoComeFatto,
} from "@/lib/prototipo-bi/altri-dati";
import { CARTELLE, GRUPPI_OPERAZIONI } from "@/lib/prototipo-bi/albero-modello";
import { dimensioniPerMetrica } from "@/lib/prototipo-bi/tassonomia";
import { applicaPerimetro } from "@/lib/prototipo-bi/perimetro";
import type { RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

function snapshot(dataset: Partial<Snapshot["dataset"]>): Snapshot {
  return {
    generatoIl: "", runCorrente: null, runRicevutoIl: null, dataMassima: "2026-10-09", dataMinima: "2025-01-01",
    conteggi: {},
    dataset: {
      ordinato: [], fatturato: [], consegnato: [], portafoglio: [], preventivi_aperti: [], controllo_banco: [],
      consegnato_futuro_per_mese: [], ...dataset,
    },
  };
}

const base: RigaFatto = {
  data: "2026-03-10", importo: 100, bu: "COMPONENTI", categoria: "-", agente: "A", codiceAgente: "1",
  cliente: "ICA spa", codiceCliente: "C1", documento: "22", articolo: "", descrizioneArticolo: "", quantita: 1, profilo: "OC",
};

describe("carico di lavoro: documenti per utente", () => {
  const doc = (p: Record<string, unknown>) =>
    documentoUtenteComeFatto({
      id_documento: 1, profilo: "OC", numero_registrazione: 1, data_registrazione: "2026-03-31", data_creazione: "2026-03-10T09:15:00",
      codice_utente: "erikalivreri", utente: "Erika Livreri", n_righe: 3, importo_documento: 500, codice_soggetto: "C1", soggetto: "ICA spa", ...p,
    });
  const S = snapshot({
    documenti_utente: [
      doc({}),
      doc({ numero_registrazione: 2, n_righe: 5 }),
      doc({ profilo: "FC", numero_registrazione: 3, utente: "segreteria", n_righe: 2, data_creazione: "2026-03-11 14:00:00" }),
      doc({ profilo: "OF", numero_registrazione: 4, utente: "Claudio Dalsass", n_righe: 7, soggetto: "I.L.C. srl" }),
    ],
  });

  it("la data e' quella di creazione, non di registrazione, e l'ora si legge", () => {
    expect(doc({}).data).toBe("2026-03-10");
    expect(doc({}).oraCreazione).toBe("09");
    expect(doc({ data_creazione: "2026-03-11 14:00:00" }).oraCreazione).toBe("14");
  });

  it("documenti e righe, divisi fra area vendite e area acquisti", () => {
    expect(esegui({ metrica: "documenti_vendita_creati" }, S).totale).toBe(3);
    expect(esegui({ metrica: "righe_vendita_inserite" }, S).totale).toBe(10);
    expect(esegui({ metrica: "documenti_acquisto_creati" }, S).totale).toBe(1);
    expect(esegui({ metrica: "righe_acquisto_inserite" }, S).totale).toBe(7);
  });

  it("per utente e per tipo di documento", () => {
    const r = esegui({ metrica: "documenti_vendita_creati", raggruppa: ["creatore"] }, S);
    expect(r.righe.find((x) => x.etichetta === "Erika Livreri")?.valore).toBe(2);
    expect(r.righe.find((x) => x.etichetta === "segreteria")?.valore).toBe(1);
    const t = esegui({ metrica: "documenti_vendita_creati", raggruppa: ["profilo"] }, S);
    expect(t.righe.map((x) => x.etichetta).sort()).toEqual(["FC", "OC"]);
  });

  it("l'ora del giorno in cui si lavora", () => {
    const r = esegui({ metrica: "documenti_vendita_creati", raggruppa: ["ora_creazione"] }, S);
    expect(r.righe.map((x) => x.etichetta).sort()).toEqual(["09:00", "14:00"]);
  });

  it("l'utente creatore vale anche per i preventivi, e i campi del carico non esistono sulle vendite", () => {
    expect(() => validaSpec({ metrica: "preventivi_creati", raggruppa: ["creatore"] })).not.toThrow();
    expect(() => validaSpec({ metrica: "ordinato", raggruppa: ["ora_creazione"] })).toThrow(SpecNonValida);
  });
});

describe("la condizione di pagamento agganciata ai documenti", () => {
  const condizioni = mappaCondizioni([
    { profilo: "OC", numero_registrazione: 22, codice_soggetto: "C1", data_registrazione: "2026-03-10", condizione_codice: "03", condizione_descrizione: "RB 90 ggfm" },
    { profilo: "OF", numero_registrazione: 12, codice_soggetto: "F9", data_registrazione: "2026-07-01", condizione_codice: "02", condizione_descrizione: "RB 60 ggfm" },
  ]);

  it("una riga di vendita trova la condizione del suo documento per profilo, numero, cliente e data", () => {
    const righe = [{ ...base }, { ...base, documento: "99" }];
    agganciaCondizioniVendite(righe, condizioni);
    expect(righe[0].condizione).toBe("RB 90 ggfm");
    expect(righe[1].condizione).toBeUndefined();
  });

  it("un ordine a fornitore la trova dal suo documento («OF 12/2026»), senza il codice del fornitore", () => {
    const righe = [{ ...base, profilo: "OF", documento: "OF 12/2026", data: "2026-07-01", fornitore: "ILC" }];
    agganciaCondizioniAcquisti(righe, condizioni);
    expect(righe[0].condizione).toBe("RB 60 ggfm");
  });

  it("si analizza l'ordinato per condizione di pagamento", () => {
    const righe = [{ ...base }, { ...base, documento: "23", importo: 50 }];
    agganciaCondizioniVendite(righe, condizioni);
    const r = esegui({ metrica: "ordinato", raggruppa: ["condizione_pagamento"] }, snapshot({ ordinato: righe }));
    expect(r.righe.find((x) => x.etichetta === "RB 90 ggfm")?.valore).toBe(100);
    expect(r.righe.find((x) => x.etichetta === "(non indicata)")?.valore).toBe(50);
  });
});

describe("l'anagrafica del cliente agganciata alle righe", () => {
  const anagrafica = mappaAnagrafica([
    { codice_cliente: "C1", cat_attivita: "Alimentare", cat_commerciale: "Costruttori", cat_zona: "Nord", tipo: "Cliente", attivo: true },
  ]);

  it("ordinato per categoria di attivita' del cliente", () => {
    const righe = [{ ...base }, { ...base, codiceCliente: "C2", importo: 30 }];
    agganciaAnagrafica(righe, anagrafica);
    const r = esegui({ metrica: "ordinato", raggruppa: ["categoria_attivita"] }, snapshot({ ordinato: righe }));
    expect(r.righe.find((x) => x.etichetta === "Alimentare")?.valore).toBe(100);
    expect(r.righe.find((x) => x.etichetta === "(non indicata)")?.valore).toBe(30);
  });

  it("l'anagrafica come dataset: quanti clienti, per categoria e provincia", () => {
    const c = (p: Record<string, unknown>) =>
      clienteComeFatto({ codice_cliente: "C1", ragione_sociale: "ICA", cat_attivita: "Alimentare", cat_zona: "Nord", agente: "Rossi", agente_codice: "A1", provincia: "bo", creato_il: "2020-05-01", attivo: true, ...p });
    const S = snapshot({ clienti: [c({}), c({ codice_cliente: "C2", cat_attivita: "Meccanica" }), c({ codice_cliente: "C3", attivo: false })] });
    expect(esegui({ metrica: "clienti_numero" }, S).totale).toBe(3);
    const r = esegui({ metrica: "clienti_numero", raggruppa: ["categoria_attivita"] }, S);
    expect(r.righe.find((x) => x.etichetta === "Alimentare")?.valore).toBe(2);
    expect(esegui({ metrica: "clienti_numero", raggruppa: ["cliente_attivo"] }, S).righe.map((x) => x.etichetta).sort()).toEqual(["Attivo", "Non attivo"]);
    expect(esegui({ metrica: "clienti_numero", raggruppa: ["provincia"] }, S).righe[0].etichetta).toBe("BO");
  });
});

describe("articoli e variazioni di costo", () => {
  const art = (p: Record<string, unknown>) =>
    articoloComeFatto({
      "Codice Articolo": "ab-1", Descrizione: "VALVOLA", Categoria: "Pneumatica", Gruppo: "COMPONENTI", Reparto: "R1", Fornitore: "ILC", Magazzino: "M1",
      Esistenza: 10, Disponibilita: 6, "Qta Ord Clienti": 3, "Qta Ord Fornitori": 5, "Qta Imp Produzione": 1, "Qta Ord Produzione": 2,
      "Ultimo Costo": 4, "Aggiornato Il": "2026-10-10T02:00:00Z", ...p,
    });
  const S = snapshot({ articoli: [art({}), art({ Magazzino: "M2", Esistenza: 5 }), art({ "Codice Articolo": "cd-2", "Ultimo Costo": null, Esistenza: 7 })] });

  it("il numero degli articoli conta gli articoli, non le righe per magazzino", () => {
    expect(esegui({ metrica: "articoli_numero" }, S).totale).toBe(2);
    expect(esegui({ metrica: "articoli_esistenza" }, S).totale).toBe(22);
  });

  it("il valore della giacenza conta solo dove il costo e' noto", () => {
    expect(esegui({ metrica: "articoli_valore_giacenza" }, S).totale).toBe(60);
    expect(esegui({ metrica: "articoli_ultimo_costo" }, S).totale).toBe(4);
  });

  it("per magazzino e per fornitore", () => {
    const m = esegui({ metrica: "articoli_esistenza", raggruppa: ["magazzino"] }, S);
    expect(m.righe.find((x) => x.etichetta === "M2")?.valore).toBe(5);
    expect(dimensioniPerMetrica("articoli_esistenza")).toEqual(expect.arrayContaining(["fornitore", "reparto", "magazzino", "codice_articolo"]));
  });

  it("le variazioni di costo: quante e di quanto in media", () => {
    const v = (p: Record<string, unknown>) =>
      variazioneCostoComeFatto({ "Codice Articolo": "ab-1", Descrizione: "VALVOLA", "Data Variazione": "2026-09-01", Delta: 1, "Delta %": 10, ...p });
    const T = snapshot({ variazioni_costo: [v({}), v({ "Delta %": 20, "Data Variazione": "2026-09-15" }), v({ "Delta %": null })] });
    expect(esegui({ metrica: "variazioni_costo_numero" }, T).totale).toBe(3);
    expect(esegui({ metrica: "variazioni_costo_pct_media" }, T).totale).toBe(15);
  });
});

describe("spedizioni", () => {
  const sp = (p: Record<string, unknown>) =>
    spedizioneComeFatto({
      codice_profilo: "DV", numero_progressivo: 1, data_documento: "2026-03-10", data_registrazione: "2026-03-10", soggetto: "ICA spa",
      direzione: "USCITA", vettore: "GLS", num_colli: 2, num_pallet: 1, peso_lordo: 30, volume: 0.5, val_spese: 12, provincia_destinazione: "bo", ...p,
    });
  const S = snapshot({ spedizioni: [sp({}), sp({ numero_progressivo: 2, vettore: "TNT", num_colli: 3, peso_lordo: 10 }), sp({ codice_profilo: "DA", numero_progressivo: 1, direzione: "ENTRATA", vettore: "" })] });

  it("spedizioni, colli e peso per vettore", () => {
    expect(esegui({ metrica: "spedizioni_numero" }, S).totale).toBe(3);
    expect(esegui({ metrica: "spedizioni_colli" }, S).totale).toBe(7);
    const r = esegui({ metrica: "spedizioni_peso_lordo", raggruppa: ["vettore"] }, S);
    expect(r.righe.find((x) => x.etichetta === "GLS")?.valore).toBe(30);
    expect(r.righe.find((x) => x.etichetta === "(senza vettore)")).toBeDefined();
  });

  it("merce in entrata e in uscita, per provincia di destinazione", () => {
    const d = esegui({ metrica: "spedizioni_numero", raggruppa: ["direzione_merce"] }, S);
    expect(d.righe.find((x) => x.etichetta === "Merce in entrata")?.valore).toBe(1);
    expect(esegui({ metrica: "spedizioni_numero", raggruppa: ["provincia_destinazione"] }, S).righe[0].etichetta).toBe("BO");
  });

  it("un perimetro ristretto non vede spedizioni, articoli, carico di lavoro", () => {
    const p = applicaPerimetro(S, { tipo: "agente", codici: ["AG000010"] });
    expect(p.dataset.spedizioni).toEqual([]);
  });
});

describe("l'albero in cartelle", () => {
  it("le cartelle sono Vendite, Acquisti, Personale e i dati che prima mancavano", () => {
    expect(CARTELLE.map((c) => c.etichetta)).toEqual(["Vendite", "Acquisti", "Personale", "Magazzino e articoli", "Logistica", "Clienti"]);
  });

  it("Vendite: ordinato, fatturato, consegnato, portafoglio, banco, preventivi, budget", () => {
    expect(CARTELLE[0].voci.map((v) => v.etichetta)).toEqual(["Ordinato", "Fatturato", "Consegnato", "Portafoglio", "Banco", "Preventivi", "Budget"]);
  });

  it("Acquisti: ordinato, consegnato, fatturato; Personale: commerciale, acquisti, backoffice", () => {
    expect(CARTELLE[1].voci.map((v) => v.etichetta)).toEqual(["Ordinato", "Consegnato", "Fatturato"]);
    expect(CARTELLE[2].voci.map((v) => v.etichetta.split(" (")[0])).toEqual(["Commerciale", "Acquisti", "Backoffice"]);
  });

  it("gli incassi attesi stanno nel fatturato di vendita, i pagamenti dovuti in quello di acquisto", () => {
    const v = (chiave: string) => GRUPPI_OPERAZIONI.find((g) => g.chiave === chiave)!;
    expect(v("fatturato").valori).toContain("incassi_attesi");
    expect(v("acquisti_fatturato").valori).toContain("pagamenti_dovuti");
  });

  it("il portafoglio e' uno solo e ha le date di consegna: il calendario lo rende per giorno, settimana, mese o anno", () => {
    const p = GRUPPI_OPERAZIONI.find((g) => g.chiave === "portafoglio")!;
    expect(p.valori).toEqual(["portafoglio"]);
    expect(p.campi.map((c) => c.chiave)).toEqual(expect.arrayContaining(["data_consegna_richiesta", "data_consegna_confermata"]));
  });

  it("l'anzianita' e' una misura dei preventivi; il backoffice conta il carico vero", () => {
    const pre = CARTELLE.flatMap((c) => c.voci).find((g) => g.chiave === "preventivi")!;
    expect(pre.misure).toEqual(expect.arrayContaining(["giorni_apertura", "eta_massima_apertura"]));
    const bo = GRUPPI_OPERAZIONI.find((g) => g.chiave === "personale_backoffice")!;
    expect(bo.valori).toEqual(expect.arrayContaining(["preventivi_creati", "documenti_vendita_creati", "righe_vendita_inserite"]));
  });

  it("la condizione di pagamento e' un campo di ordinato, fatturato, consegnato, portafoglio, preventivi e acquisti", () => {
    for (const chiave of ["ordinato", "fatturato", "consegnato", "portafoglio", "preventivi", "acquisti_ordinato", "acquisti_fatturato"]) {
      expect(GRUPPI_OPERAZIONI.find((g) => g.chiave === chiave)!.campi.map((c) => c.chiave), chiave).toContain("condizione_pagamento");
    }
  });
});
