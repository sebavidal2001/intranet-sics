import { describe, expect, it } from "vitest";
import { comeFatti, daVista } from "@/lib/prototipo-bi/visite";
import { esegui, validaSpec, SpecNonValida } from "@/lib/prototipo-bi/semantico";
import { applicaPerimetro } from "@/lib/prototipo-bi/perimetro";
import { dimensioniPerMetrica } from "@/lib/prototipo-bi/tassonomia";
import { scegliGrafico, graficiPossibili } from "@/lib/prototipo-bi/scelta-grafico";
import { dashboardVisibile } from "@/lib/prototipo-bi/dashboard-accesso";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";

function vista(p: Record<string, unknown>) {
  return daVista({
    id_visita: 1, data_visita: "2026-09-10", codice_cliente: "0500", ragione_sociale: "ACME srl",
    agente_codice: "AG010035", agente: "DANIELE BONI", grado: "conoscitiva", tipo: "visita",
    cap: "40069", localita: "ZOLA PREDOSA", provincia: "bo", ...p,
  });
}

function snapshot(): Snapshot {
  const righe = [
    vista({ id_visita: 5262, data_visita: "2026-09-10", cap: "40069" }),
    vista({ id_visita: 5261, data_visita: "2026-09-10", cap: "40057", localita: "GRANAROLO" }),
    vista({ id_visita: 5270, data_visita: "2026-09-11", cap: "40069" }),
    vista({ id_visita: 5271, data_visita: "2026-09-11", cap: "10135", provincia: "TO", agente_codice: "AG000010", agente: "VALERIA BATTELANI" }),
  ];
  return {
    generatoIl: "", runCorrente: null, runRicevutoIl: null, dataMassima: "2026-09-11", dataMinima: "2026-01-01",
    conteggi: {},
    dataset: {
      ordinato: [], fatturato: [], consegnato: [], portafoglio: [], preventivi_aperti: [], controllo_banco: [],
      consegnato_futuro_per_mese: [], visite: comeFatti(righe),
    },
  };
}

describe("visite nel motore semantico", () => {
  it("conta le visite e le divide per CAP", () => {
    expect(esegui({ metrica: "visite_numero" }, snapshot()).totale).toBe(4);
    const r = esegui({ metrica: "visite_numero", raggruppa: ["cap"] }, snapshot());
    expect(r.righe.find((x) => x.etichetta === "40069")?.valore).toBe(2);
  });

  it("la provincia viene portata in maiuscolo", () => {
    expect(vista({ provincia: "bo" }).provincia).toBe("BO");
  });

  it("il perimetro per agente vede solo le proprie visite", () => {
    const s = applicaPerimetro(snapshot(), { tipo: "agente", codici: ["AG000010"] });
    expect(esegui({ metrica: "visite_numero" }, s).totale).toBe(1);
  });

  it("senza perimetro (nessuno) non vede nessuna visita", () => {
    const s = applicaPerimetro(snapshot(), { tipo: "nessuno" });
    expect(esegui({ metrica: "visite_numero" }, s).totale).toBe(0);
  });

  it("l'id della visita ordina come testo: e' l'unico ordine dentro la giornata", () => {
    const r = esegui({ metrica: "visite_numero", granularita: "giorno", raggruppa: ["cap", "documento"] }, snapshot());
    const giorno10 = r.righe.filter((x) => x.chiavi.periodo === "2026-09-10").map((x) => x.chiavi.documento);
    expect(giorno10.sort()).toEqual(["00005261", "00005262"]);
  });

  it("le dimensioni delle visite non si mescolano con quelle delle vendite", () => {
    expect(dimensioniPerMetrica("visite_numero")).toContain("cap");
    expect(() => validaSpec({ metrica: "ordinato", raggruppa: ["cap"] })).toThrow(SpecNonValida);
    expect(() => validaSpec({ metrica: "visite_numero", raggruppa: ["bu"] })).toThrow(SpecNonValida);
    expect(() => validaSpec({ metrica: "visite_numero", raggruppa: ["cap"] })).not.toThrow();
  });
});

describe("la mappa come grafico", () => {
  it("e' la proposta quando il dato e' diviso per CAP", () => {
    const r = esegui({ metrica: "visite_numero", raggruppa: ["cap"] }, snapshot());
    expect(scegliGrafico(r).tipo).toBe("mappa");
    expect(graficiPossibili(r)).toContain("mappa");
  });

  it("non compare su un dato senza dimensione geografica", () => {
    const r = esegui({ metrica: "visite_numero", raggruppa: ["agente"] }, snapshot());
    expect(graficiPossibili(r)).not.toContain("mappa");
  });
});

describe("chi puo' aprire una dashboard", () => {
  const altrui = { autore_id: "direzione", visibilita: "privata" };
  const condivisa = { autore_id: "direzione", visibilita: "condivisa" };
  const operativo = { userId: "mario", soloAssegnate: true };
  const responsabile = { userId: "anna", soloAssegnate: false };

  it("l'autore apre sempre la propria", () => {
    expect(dashboardVisibile({ userId: "direzione", soloAssegnate: false }, altrui, false)).toBe(true);
  });
  it("l'assegnazione apre anche una privata", () => {
    expect(dashboardVisibile(operativo, altrui, true)).toBe(true);
  });
  it("senza assegnazione una privata altrui resta chiusa", () => {
    expect(dashboardVisibile(operativo, altrui, false)).toBe(false);
    expect(dashboardVisibile(responsabile, altrui, false)).toBe(false);
  });
  it("la condivisa arriva a tutti tranne a chi riceve solo le assegnate", () => {
    expect(dashboardVisibile(responsabile, condivisa, false)).toBe(true);
    expect(dashboardVisibile(operativo, condivisa, false)).toBe(false);
  });
});
