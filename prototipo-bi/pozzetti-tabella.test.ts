/**
 * LE TABELLE, I PERIODI E IL NUMERO DEL DOCUMENTO.
 *
 * Tre cose che l'albero e i pozzetti devono garantire insieme:
 *
 * 1. in una tabella i campi sono quanti se ne vogliono (nei grafici due);
 * 2. un valore ha un suo periodo («ordinato» e «ordinato dell'anno scorso» sono
 *    due colonne) e un suo calcolo (somma, conteggio, media);
 * 3. il numero del documento vale per una sola operazione alla volta: ordine
 *    4521 e fattura 4521 non hanno niente a che fare.
 */

import { describe, expect, it } from "vitest";
import {
  SELEZIONE_VUOTA,
  dimensioniAmmesse,
  famiglieDelleMisure,
  motivoDimensioneNonSelezionabile,
  motivoMisuraNonSelezionabile,
  nomeConPeriodo,
  riconciliaMisure,
  selezioneConMisura,
  specDaSelezione,
  type SelezioneCampi,
} from "@/components/prototipo-bi/albero-campi";
import {
  aggiungiPeriodoAlValore,
  cambiaCalcoloValore,
  cambiaPeriodoValore,
  contenutoTabella,
  deponi,
  motivoPeriodoNonAmmesso,
  spostaCampo,
  togliVoce,
  vociDisponibili,
  type ContestoPozzetti,
} from "@/components/prototipo-bi/pozzetti-regole";
import {
  chiaveBase,
  componiValore,
  scomponiValore,
  specPerChiave,
  valoreDellaSpec,
} from "@/lib/prototipo-bi/misure-vocabolario";
import { dimensioniPerMetrica } from "@/lib/prototipo-bi/tassonomia";
import { CATALOGO } from "@/lib/prototipo-bi/semantico";
import type { ChiaveMetrica, Dimensione } from "@/lib/prototipo-bi/tipi";

/** Le dimensioni vere, come le ammette il motore: cosi' il test non si allontana dalla realta'. */
const PER_METRICA = Object.fromEntries(
  (Object.keys(CATALOGO) as ChiaveMetrica[]).map((m) => [m, dimensioniPerMetrica(m)])
) as Record<string, Dimensione[]>;

const CONTESTO: ContestoPozzetti = {
  perMetrica: PER_METRICA,
  etichetta: (voce) => String(voce.chiave),
};

const sel = (parziale: Partial<SelezioneCampi>): SelezioneCampi => ({ ...SELEZIONE_VUOTA, ...parziale });

function ok(esito: ReturnType<typeof deponi>): SelezioneCampi {
  if (!esito.ok) throw new Error(`rifiutato: ${esito.motivo}`);
  return esito.selezione;
}

describe("il valore e il suo periodo", () => {
  it("si compone e si scompone senza perdere niente", () => {
    expect(componiValore("ordinato")).toBe("ordinato");
    expect(componiValore("ordinato", "anno_precedente")).toBe("ordinato@anno_precedente");
    expect(scomponiValore("ordinato@anno_precedente")).toEqual({ chiave: "ordinato", variante: "anno_precedente" });
    expect(scomponiValore("ordinato")).toEqual({ chiave: "ordinato" });
    expect(scomponiValore("misura:abc@progressivo")).toEqual({ chiave: "misura:abc", variante: "progressivo" });
    // Una chiocciola che non e' un periodo non si taglia.
    expect(scomponiValore("misura:a@b")).toEqual({ chiave: "misura:a@b" });
    expect(chiaveBase("fatturato@progressivo_ap")).toBe("fatturato");
  });

  it("il periodo diventa il modificatore del motore", () => {
    const spec = specPerChiave({ metrica: "ordinato", modificatore: "corrente" }, "ordinato@anno_precedente", {});
    expect(spec).toMatchObject({ metrica: "ordinato", modificatore: "anno_precedente" });
    expect(valoreDellaSpec(spec!)).toBe("ordinato@anno_precedente");
    expect(valoreDellaSpec({ metrica: "ordinato" })).toBe("ordinato");
    expect(valoreDellaSpec({ metrica: "ordinato", modificatore: "corrente" })).toBe("ordinato");
  });

  it("due colonne della stessa misura: anno corrente e anno precedente, sulla stessa suddivisione", () => {
    const esito = specDaSelezione(sel({ misure: ["ordinato", "ordinato@anno_precedente"], suddivisioni: ["cliente"] }));
    expect(esito?.spec).toMatchObject({ metrica: "ordinato", raggruppa: ["cliente"] });
    expect(esito?.spec.modificatore).toBeUndefined();
    expect(esito?.serie).toHaveLength(2);
    expect(esito?.serie?.[1].spec).toMatchObject({ metrica: "ordinato", modificatore: "anno_precedente", raggruppa: ["cliente"] });
    // Il nome dice di che periodo e': due colonne «Ordinato» uguali non si distinguerebbero.
    expect(esito?.serie?.[1].nome).toBe("ordinato · anno precedente");
  });

  it("il nome di un valore con periodo", () => {
    expect(nomeConPeriodo("Ordinato", "ordinato")).toBe("Ordinato");
    expect(nomeConPeriodo("Ordinato", "ordinato@anno_precedente")).toBe("Ordinato · anno precedente");
    expect(nomeConPeriodo("Ordinato", "ordinato@progressivo_ap")).toBe("Ordinato · progressivo anno prec.");
  });

  it("aggiungere l'anno precedente mette il valore accanto all'originale, una volta sola", () => {
    const partenza = sel({ misure: ["ordinato", "fatturato"] });
    const dopo = ok(aggiungiPeriodoAlValore(partenza, 0, "anno_precedente", CONTESTO) as never);
    expect(dopo.misure).toEqual(["ordinato", "ordinato@anno_precedente", "fatturato"]);

    const doppio = aggiungiPeriodoAlValore(dopo, 0, "anno_precedente", CONTESTO);
    expect(doppio.ok).toBe(false);
    expect(!doppio.ok && doppio.motivo).toMatch(/già nei valori/);
  });

  it("cambiare il periodo sostituisce il valore, e rifiuta un doppione", () => {
    const partenza = sel({ misure: ["ordinato", "fatturato"] });
    expect(ok(cambiaPeriodoValore(partenza, 1, "anno_precedente", CONTESTO)).misure).toEqual(["ordinato", "fatturato@anno_precedente"]);
    const conDoppione = sel({ misure: ["ordinato", "ordinato@anno_precedente"] });
    expect(cambiaPeriodoValore(conDoppione, 0, "anno_precedente", CONTESTO).ok).toBe(false);
    // Tornare al periodo scelto senza suffisso.
    expect(ok(cambiaPeriodoValore(sel({ misure: ["ordinato@anno_precedente"] }), 0, undefined, CONTESTO)).misure).toEqual(["ordinato"]);
  });

  it("il progressivo cumula: non si offre a una media, a una percentuale, a una misura personalizzata", () => {
    expect(motivoPeriodoNonAmmesso("ordinato", "progressivo")).toBeNull();
    expect(motivoPeriodoNonAmmesso("n_ordini", "progressivo_ap")).toBeNull();
    expect(motivoPeriodoNonAmmesso("ordine_medio", "progressivo")).toMatch(/cumula/);
    expect(motivoPeriodoNonAmmesso("tasso_conversione", "progressivo")).toMatch(/cumula/);
    expect(motivoPeriodoNonAmmesso("misura:x", "progressivo")).toMatch(/cumula/);
    // L'anno precedente vale per tutto.
    expect(motivoPeriodoNonAmmesso("ordine_medio", "anno_precedente")).toBeNull();
    expect(cambiaPeriodoValore(sel({ misure: ["ordine_medio"] }), 0, "progressivo", CONTESTO).ok).toBe(false);
  });
});

describe("«Calcola come»: somma, conteggio, media dello stesso campo", () => {
  it("cambia la lettura tenendo posto e periodo", () => {
    const partenza = sel({ misure: ["fatturato", "ordinato@anno_precedente"] });
    const dopo = ok(cambiaCalcoloValore(partenza, 1, "n_ordini", CONTESTO));
    expect(dopo.misure).toEqual(["fatturato", "n_ordini@anno_precedente"]);
  });

  it("passando a una media il progressivo si perde, e lo dice", () => {
    const esito = cambiaCalcoloValore(sel({ misure: ["ordinato@progressivo"] }), 0, "ordine_medio", CONTESTO);
    expect(esito.ok && esito.selezione.misure).toEqual(["ordine_medio"]);
    expect(esito.ok && esito.avviso).toMatch(/progressivo non si applica a una media/);
  });

  it("non si arriva a un valore che c'e' gia', ne' a uno di un'altra famiglia", () => {
    expect(cambiaCalcoloValore(sel({ misure: ["ordinato", "n_ordini"] }), 0, "n_ordini", CONTESTO).ok).toBe(false);
    expect(cambiaCalcoloValore(sel({ misure: ["ordinato"] }), 0, "n_fatture", CONTESTO).ok).toBe(false);
  });
});

describe("tabella: i campi sono quanti se ne vogliono", () => {
  const base = sel({ misure: ["ordinato"] });

  it("quattro campi, piu' del limite dei grafici", () => {
    let s = base;
    for (const d of ["cliente", "agente", "codice_articolo", "articolo"] as Dimensione[]) {
      s = ok(deponi(s, "campi", { tipo: "dimensione", chiave: d }, CONTESTO));
    }
    expect(s.suddivisioni).toEqual(["cliente", "agente", "codice_articolo", "articolo"]);
  });

  it("negli stessi gesti, un grafico si ferma a due", () => {
    let s = ok(deponi(base, "asse", { tipo: "dimensione", chiave: "cliente" }, CONTESTO));
    s = ok(deponi(s, "legenda", { tipo: "dimensione", chiave: "agente" }, CONTESTO));
    s = ok(deponi(s, "legenda", { tipo: "dimensione", chiave: "bu" }, CONTESTO));
    expect(s.suddivisioni).toHaveLength(2);
  });

  it("il tempo e' una colonna come le altre, e va per primo", () => {
    let s = ok(deponi(base, "campi", { tipo: "dimensione", chiave: "cliente" }, CONTESTO));
    s = ok(deponi(s, "campi", { tipo: "calendario", chiave: "mese" }, CONTESTO));
    expect(contenutoTabella(s).campi).toEqual([
      { tipo: "calendario", chiave: "mese" },
      { tipo: "dimensione", chiave: "cliente" },
    ]);
    // Un altro tempo prende il posto del primo: e' una scala sola.
    s = ok(deponi(s, "campi", { tipo: "calendario", chiave: "anno" }, CONTESTO));
    expect(s.granularita).toBe("anno");
  });

  it("senza una misura non c'e' niente da suddividere, e una misura non e' un campo", () => {
    const vuota = deponi(SELEZIONE_VUOTA, "campi", { tipo: "dimensione", chiave: "cliente" }, CONTESTO);
    expect(vuota.ok).toBe(false);
    const misura = deponi(base, "campi", { tipo: "misura", chiave: "fatturato" }, CONTESTO);
    expect(!misura.ok && misura.motivo).toMatch(/valori/);
  });

  it("lo stesso campo due volte e' rifiutato col suo perche'", () => {
    const una = ok(deponi(base, "campi", { tipo: "dimensione", chiave: "cliente" }, CONTESTO));
    const due = deponi(una, "campi", { tipo: "dimensione", chiave: "cliente" }, CONTESTO);
    expect(!due.ok && due.motivo).toMatch(/già nelle colonne/);
  });

  it("i campi si riordinano: l'ordine e' quello delle colonne", () => {
    const s = sel({ misure: ["ordinato"], suddivisioni: ["cliente", "agente", "bu"] });
    expect(spostaCampo(s, 2, 0).suddivisioni).toEqual(["bu", "cliente", "agente"]);
    expect(spostaCampo(s, 0, 9)).toBe(s);
  });

  it("togliere un campo da una tabella non annuncia una legenda che scala sull'asse", () => {
    const s = sel({ misure: ["ordinato"], suddivisioni: ["cliente", "agente", "bu"] });
    const esito = togliVoce(s, { tipo: "dimensione", chiave: "cliente" }, CONTESTO, true);
    expect(esito.ok && esito.selezione.suddivisioni).toEqual(["agente", "bu"]);
    expect(esito.ok && esito.avviso).toBeUndefined();
    const inGrafico = togliVoce(s, { tipo: "dimensione", chiave: "cliente" }, CONTESTO);
    expect(inGrafico.ok && inGrafico.avviso).toMatch(/dalla legenda all'asse/);
  });

  it("il menu «Aggiungi» dei campi offre il tempo e le dimensioni, non le misure", () => {
    const campi = { misure: ["ordinato"] as never[], dimensioni: ["cliente", "agente"] as Dimensione[] };
    const voci = vociDisponibili("campi", base, CONTESTO, campi);
    expect(voci.some((v) => v.tipo === "calendario")).toBe(true);
    expect(voci.filter((v) => v.tipo === "dimensione").map((v) => v.chiave)).toEqual(["cliente", "agente"]);
    expect(voci.some((v) => v.tipo === "misura")).toBe(false);
  });
});

describe("il numero del documento vale per una sola operazione", () => {
  it("con un solo tipo di documento si puo' suddividere per numero", () => {
    expect(dimensioniAmmesse(["ordinato", "n_ordini"], PER_METRICA)).toContain("documento");
    expect(dimensioniAmmesse(["ordinato@anno_precedente"], PER_METRICA)).toContain("documento");
  });

  it("ordinato e fatturato non si accostano per numero: sono numerazioni diverse", () => {
    expect(famiglieDelleMisure(["ordinato", "fatturato"])).toEqual(["ordinato", "fatturato"]);
    expect(dimensioniAmmesse(["ordinato", "fatturato"], PER_METRICA)).not.toContain("documento");
    // Le altre dimensioni restano.
    expect(dimensioniAmmesse(["ordinato", "fatturato"], PER_METRICA)).toContain("cliente");
  });

  it("con un numero di documento gia' scelto non si aggiunge un valore di un'altra operazione", () => {
    const s = sel({ misure: ["ordinato"], suddivisioni: ["documento"] });
    expect(motivoMisuraNonSelezionabile("fatturato", s, PER_METRICA)).toMatch(/una sola operazione/);
    expect(motivoMisuraNonSelezionabile("n_ordini", s, PER_METRICA)).toBeNull();
    expect(deponi(s, "valori", { tipo: "misura", chiave: "fatturato" }, CONTESTO).ok).toBe(false);
  });

  it("con due operazioni scelte il numero e' spento, e il motivo e' quello vero", () => {
    const s = sel({ misure: ["ordinato", "fatturato"], suddivisioni: [] });
    expect(motivoDimensioneNonSelezionabile("documento", s, PER_METRICA)).toMatch(/una sola operazione/);
    expect(motivoDimensioneNonSelezionabile("cliente", s, PER_METRICA)).toBeNull();
    const rifiuto = deponi(s, "campi", { tipo: "dimensione", chiave: "documento" }, CONTESTO);
    expect(!rifiuto.ok && rifiuto.motivo).toMatch(/una sola operazione/);
  });

  it("aggiungendo il numero a una selezione mista, le misure di un'altra operazione escono, e lo si dice", () => {
    const s = sel({ misure: ["ordinato", "n_ordini", "fatturato"], suddivisioni: ["cliente"] });
    const { misure, tolte } = riconciliaMisure(s, ["cliente", "documento"], PER_METRICA);
    expect(misure).toEqual(["ordinato", "n_ordini"]);
    expect(tolte).toEqual(["fatturato"]);
    const esito = deponi(s, "campi", { tipo: "dimensione", chiave: "documento" }, CONTESTO);
    // Il numero non si puo' aggiungere a una selezione che mescola operazioni.
    expect(esito.ok).toBe(false);
  });

  it("togliendo l'ultima misura di un'altra operazione il numero torna disponibile", () => {
    const s = sel({ misure: ["ordinato", "fatturato"] });
    const dopo = selezioneConMisura(s, "fatturato", false, PER_METRICA);
    expect(dimensioniAmmesse(dopo.misure, PER_METRICA)).toContain("documento");
  });

  it("le misure personalizzate dichiarano le loro operazioni", () => {
    const famiglie = { "misura:margine-componenti": ["fatturato"] };
    expect(famiglieDelleMisure(["misura:margine-componenti", "ordinato"], famiglie)).toEqual(["fatturato", "ordinato"]);
    expect(dimensioniAmmesse(["ordinato"], { ...PER_METRICA, "misura:margine-componenti": ["cliente", "documento"] }, famiglie)).toContain("documento");
  });
});
