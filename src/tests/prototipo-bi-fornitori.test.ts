import { describe, expect, it } from "vitest";
import { esegui, validaSpec, SpecNonValida, CATALOGO, preventivoInCorso } from "@/lib/prototipo-bi/semantico";
import { fatturaFornitoreComeFatto, pagamentoComeFatto, scadenzaComeFatto } from "@/lib/prototipo-bi/fornitori";
import { dimensioniPerMetrica } from "@/lib/prototipo-bi/tassonomia";
import { applicaPerimetro } from "@/lib/prototipo-bi/perimetro";
import { METRICHE_SOLO_IN_CORSO } from "@/lib/prototipo-bi/gruppi-campi";
import { GRUPPI_OPERAZIONI, avvisoNumeroDocumento } from "@/lib/prototipo-bi/albero-modello";
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
  data: "2026-03-10", importo: 0, bu: "COMPONENTI", categoria: "-", agente: "A", codiceAgente: "1",
  cliente: "ICA spa", codiceCliente: "C1", documento: "1", articolo: "", descrizioneArticolo: "", quantita: 1,
};

function preventivo(p: Partial<RigaFatto>): RigaFatto {
  return { ...base, ...p };
}

describe("preventivi aperti = preventivi in corso (PIC)", () => {
  const S = snapshot({
    preventivi_aperti: [
      preventivo({ documento: "10", importo: 1000, valoreTotale: 1000, causaleCodice: "PIC", causaleDescrizione: "PREVENTIVO IN CORSO", giorniAperto: 120 }),
      preventivo({ documento: "11", importo: 500, valoreTotale: 500, causaleCodice: "PIC", causaleDescrizione: "PREVENTIVO IN CORSO", giorniAperto: 20 }),
      preventivo({ documento: "12", importo: 4000, valoreTotale: 4000, causaleCodice: "PF4", causaleDescrizione: "CLIENTE NON PRENDE IL LAVORO", giorniAperto: 300 }),
      preventivo({ documento: "13", importo: 0, valoreTotale: 800, causaleCodice: "PIC", causaleDescrizione: "PREVENTIVO IN CORSO", giorniAperto: null }),
    ],
  });

  it("il preventivo chiuso con un motivo non e' aperto, anche se il gestionale lo lascia non evaso", () => {
    expect(esegui({ metrica: "preventivi_aperti" }, S).totale).toBe(1500);
    expect(esegui({ metrica: "n_preventivi" }, S).totale).toBe(2);
  });

  it("una riga PIC senza inevaso non e' aperta", () => {
    expect(preventivoInCorso(preventivo({ causaleCodice: "PIC", importo: 0 }))).toBe(false);
    expect(preventivoInCorso(preventivo({ causaleCodice: "PIC", importo: 10 }))).toBe(true);
  });

  it("l'inevaso di tutte le causali resta leggibile, per causale", () => {
    const r = esegui({ metrica: "preventivi_inevaso", raggruppa: ["causale_codice"] }, S);
    expect(r.totale).toBe(5500);
    expect(r.righe.find((x) => x.etichetta === "PF4")?.valore).toBe(4000);
    expect(r.righe.find((x) => x.etichetta === "PIC")?.valore).toBe(1500);
  });

  it("anzianita' e inevaso oltre 90 giorni contano solo i preventivi in corso", () => {
    expect(esegui({ metrica: "preventivi_aperti_oltre_90" }, S).totale).toBe(1000);
    expect(esegui({ metrica: "eta_massima_apertura" }, S).totale).toBe(120);
  });

  it("la causale e il suo codice si possono scegliere sui preventivi", () => {
    expect(dimensioniPerMetrica("preventivi_aperti")).toEqual(expect.arrayContaining(["causale", "causale_codice"]));
    expect(() => validaSpec({ metrica: "preventivi_aperti", raggruppa: ["causale_codice"] })).not.toThrow();
  });

  it("l'elenco dei documenti dietro il numero usa lo stesso filtro: la mappa sta allineata al catalogo", () => {
    const conFiltro = Object.values(CATALOGO).filter((m) => m.filtroImplicito === preventivoInCorso).map((m) => m.chiave).sort();
    expect(conFiltro).toEqual([...METRICHE_SOLO_IN_CORSO].sort());
  });
});

describe("fatture fornitore", () => {
  const fattura = (p: Record<string, unknown>) =>
    fatturaFornitoreComeFatto({
      id_riga: 1, profilo: "FF", numero_registrazione: 22, numero_fattura: "110/01", data_fattura: "2026-03-10",
      data_registrazione: "2026-03-31", codice_fornitore: "F1", fornitore: "I.L.C. srl", codice_articolo: "ab-1",
      descrizione: "VALVOLA", gruppo_articoli: "IMPIANTI", quantita_netta: 6, valore_netto: 370.21,
      profilo_ordine: "OF", condizione_descrizione: "RB 120 ggfm", condizione_codice: "04", ...p,
    });

  const S = snapshot({
    fatture_fornitore: [
      fattura({}),
      fattura({ numero_registrazione: 23, valore_netto: 100, fornitore: "A-Z GOMMA srl", condizione_descrizione: "RB 60 ggfm" }),
      fattura({ profilo: "NAF", numero_registrazione: 5, valore_netto: -30, quantita_netta: -1, profilo_ordine: "" }),
    ],
  });

  it("le note di credito tolgono, e i documenti si contano distinti", () => {
    expect(esegui({ metrica: "fatturato_fornitore" }, S).totale).toBe(440.21);
    expect(esegui({ metrica: "n_fatture_fornitore" }, S).totale).toBe(3);
  });

  it("per fornitore e per condizione di pagamento", () => {
    const f = esegui({ metrica: "fatturato_fornitore", raggruppa: ["fornitore"] }, S);
    expect(f.righe.find((x) => x.etichetta === "A-Z GOMMA srl")?.valore).toBe(100);
    const c = esegui({ metrica: "fatturato_fornitore", raggruppa: ["condizione_pagamento"] }, S);
    expect(c.righe.find((x) => x.etichetta === "RB 60 ggfm")?.valore).toBe(100);
  });

  it("una fattura senza legame all'ordine si vede come tale", () => {
    const r = esegui({ metrica: "fatturato_fornitore", raggruppa: ["profilo_ordine"] }, S);
    expect(r.righe.find((x) => x.etichetta === "(nessun ordine)")?.valore).toBe(-30);
  });

  it("il documento e' registrazione/anno con il profilo: due fornitori con lo stesso numero fattura non si fondono", () => {
    const due = snapshot({
      fatture_fornitore: [
        fattura({ numero_registrazione: 1, numero_fattura: "1", fornitore: "F1", valore_netto: 10 }),
        fattura({ numero_registrazione: 2, numero_fattura: "1", fornitore: "F2", valore_netto: 20 }),
      ],
    });
    expect(esegui({ metrica: "n_fatture_fornitore" }, due).totale).toBe(2);
    expect(avvisoNumeroDocumento({ raggruppa: ["documento"] }, "fatture_fornitore", undefined)).toBeNull();
  });

  it("le dimensioni sono quelle dei fornitori, non agente o cliente", () => {
    expect(() => validaSpec({ metrica: "fatturato_fornitore", raggruppa: ["agente"] })).toThrow(SpecNonValida);
    expect(() => validaSpec({ metrica: "fatturato", raggruppa: ["condizione_pagamento"] })).toThrow(SpecNonValida);
    expect(() => validaSpec({ metrica: "fatturato_fornitore", raggruppa: ["condizione_pagamento"] })).not.toThrow();
  });

  it("un perimetro per agente non vede le fatture fornitore", () => {
    const p = applicaPerimetro(S, { tipo: "agente", codici: ["AG000010"] });
    expect(p.dataset.fatture_fornitore).toEqual([]);
  });
});

describe("giorni medi di incasso e di pagamento", () => {
  const doc = (p: Record<string, unknown>) =>
    pagamentoComeFatto({
      id_documento: 1, profilo: "FC", numero_registrazione: 1, data_documento: "2026-03-10", data_registrazione: "2026-03-10",
      codice_soggetto: "C1", soggetto: "ICA spa", condizione_codice: "03", condizione_descrizione: "RB 90 ggfm",
      importo_documento: 1000, giorni_medi: 90, importo_scadenze: 1220, ...p,
    });
  const S = snapshot({
    pagamenti: [
      doc({}),
      doc({ numero_registrazione: 2, giorni_medi: 60 }),
      doc({ profilo: "FF", numero_registrazione: 3, giorni_medi: 45, soggetto: "I.L.C. srl", condizione_descrizione: "RB 30/60 ggfm" }),
      // un ordine senza scadenze non e' zero giorni: e' assente
      doc({ profilo: "OC", numero_registrazione: 4, giorni_medi: null, importo_scadenze: 0 }),
    ],
  });

  it("incasso dalle sole fatture cliente, pagamento dalle sole fatture fornitore", () => {
    expect(esegui({ metrica: "giorni_incasso" }, S).totale).toBe(75);
    expect(esegui({ metrica: "giorni_pagamento" }, S).totale).toBe(45);
  });

  it("per condizione di pagamento", () => {
    const r = esegui({ metrica: "giorni_incasso", raggruppa: ["condizione_pagamento"] }, S);
    expect(r.righe[0].valore).toBe(75);
  });

  it("il soggetto e' il cliente per le fatture di vendita e il fornitore per quelle di acquisto", () => {
    const r = esegui({ metrica: "imponibile_documenti", raggruppa: ["soggetto"] }, S);
    expect(r.righe.map((x) => x.etichetta).sort()).toEqual(["I.L.C. srl", "ICA spa"]);
  });
});

describe("scadenzario", () => {
  const scad = (p: Record<string, unknown>) =>
    scadenzaComeFatto({ id_scadenza: 1, tipo: "A", data_scadenza: "2026-11-30", importo: 1000, saldo: 1000, profilo: "FC", numero_documento: "204", soggetto: "ICA spa", codice_soggetto: "C1", condizione_codice: "03", ...p });
  const S = snapshot({
    scadenze: [
      scad({}),
      scad({ id_scadenza: 2, saldo: 500, data_scadenza: "2026-12-15" }),
      scad({ id_scadenza: 3, tipo: "P", saldo: -700, profilo: "FF", soggetto: "I.L.C. srl", data_scadenza: "2026-11-30" }),
    ],
  });

  it("incassi, pagamenti e saldo", () => {
    expect(esegui({ metrica: "incassi_attesi" }, S).totale).toBe(1500);
    expect(esegui({ metrica: "pagamenti_dovuti" }, S).totale).toBe(700);
    expect(esegui({ metrica: "saldo_cassa" }, S).totale).toBe(800);
  });

  it("il calendario di cassa: per mese di scadenza, il saldo cambia segno dove escono piu' soldi", () => {
    const r = esegui({ metrica: "saldo_cassa", granularita: "mese" }, S);
    expect(r.righe.find((x) => x.etichetta === "2026-11")?.valore).toBe(300);
    expect(r.righe.find((x) => x.etichetta === "2026-12")?.valore).toBe(500);
  });

  it("la data del grafico e' la data di scadenza: il periodo filtra le scadenze, non i documenti", () => {
    expect(esegui({ metrica: "incassi_attesi", periodo: { dal: "2026-12-01", al: "2026-12-31" } }, S).totale).toBe(500);
  });

  it("le tre operazioni nuove stanno nell'albero con i loro valori", () => {
    const chiavi = GRUPPI_OPERAZIONI.map((g) => g.chiave);
    expect(chiavi).toEqual(expect.arrayContaining(["fornitori", "pagamenti", "scadenzario"]));
    const sc = GRUPPI_OPERAZIONI.find((g) => g.chiave === "scadenzario");
    expect(sc?.valori).toEqual(["incassi_attesi", "pagamenti_dovuti", "saldo_cassa"]);
  });
});
