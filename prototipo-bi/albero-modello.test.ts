/**
 * IL MODELLO DELL'ALBERO.
 *
 * Il modello dice dove sta ogni campo; il test che conta e' che non ne resti
 * fuori nessuno. Una metrica che il motore sa calcolare e che l'albero non
 * mostra e' una funzione che esiste e che nessuno puo' usare, e non da' errore:
 * sparisce e basta.
 */

import { describe, expect, it } from "vitest";
import {
  ammetteProgressivo,
  alternativeDiCalcolo,
  avvisoNumeroDocumento,
  eDocumento,
  etichettaDocumento,
  calcoloDellaMetrica,
  eMisuraCalcolata,
  famigliaDellaMetrica,
  FAMIGLIE_CALCOLO,
  CARTELLE,
  GRUPPI_COMUNI,
  GRUPPI_MISURE,
  GRUPPI_OPERAZIONI,
  naturaDellaMetrica,
  naturaDellaVoce,
  testoPerPartireDa,
} from "@/lib/prototipo-bi/albero-modello";
import { CATALOGO, DIMENSIONI } from "@/lib/prototipo-bi/semantico";
import { dimensioniPerMetrica } from "@/lib/prototipo-bi/tassonomia";
import type { ChiaveMetrica } from "@/lib/prototipo-bi/tipi";

const TUTTE = Object.keys(CATALOGO) as ChiaveMetrica[];

describe("ogni metrica sta in un posto solo", () => {
  const nelleOperazioni = GRUPPI_OPERAZIONI.flatMap((g) => g.valori);
  const nelleMisure = GRUPPI_MISURE.flatMap((g) => g.misure.map((m) => m.chiave));

  it("nessuna metrica del motore resta fuori dall'albero, salvo quelle nascoste di proposito", () => {
    const presenti = new Set<ChiaveMetrica>([...nelleOperazioni, ...nelleMisure]);
    // `consegnato_futuro` e' il portafoglio sul mese di consegna: lo stesso dato, che il
    // Cruscotto usa ancora. Nell'albero c'e' una voce sola, «Portafoglio», che ha le date.
    const NASCOSTE: ChiaveMetrica[] = ["consegnato_futuro"];
    expect(TUTTE.filter((m) => !presenti.has(m) && !NASCOSTE.includes(m))).toEqual([]);
  });

  it("le misure calcolate di ogni voce sono tutte e sole quelle che hanno un calcolo scritto", () => {
    const nelleVoci = CARTELLE.flatMap((c) => c.voci.flatMap((v) => v.misure ?? []));
    expect([...nelleVoci].sort()).toEqual([...nelleMisure].sort());
  });

  it("nessuna metrica compare due volte, ne' fra le operazioni ne' fra le misure", () => {
    const tutte = [...nelleOperazioni, ...nelleMisure];
    expect(tutte.filter((m, i) => tutte.indexOf(m) !== i)).toEqual([]);
  });

  it("le operazioni hanno solo valori di base (somme e conteggi), le misure solo calcoli", () => {
    expect(nelleOperazioni.filter(eMisuraCalcolata)).toEqual([]);
    expect(nelleMisure.filter((m) => !eMisuraCalcolata(m))).toEqual([]);
  });

  it("ogni misura dichiara come si calcola", () => {
    for (const metrica of nelleMisure) expect(calcoloDellaMetrica(metrica)?.length ?? 0, metrica).toBeGreaterThan(25);
    expect(calcoloDellaMetrica("ordinato")).toBeNull();
  });

  it("le metriche del motore che sono medie o percentuali stanno tutte fra le misure", () => {
    const calcolate = TUTTE.filter(eMisuraCalcolata);
    expect([...calcolate].sort()).toEqual([...nelleMisure].sort());
  });
});

describe("ogni dimensione ha un posto", () => {
  it("quelle che una metrica ammette stanno nei campi comuni o in un'operazione", () => {
    const nellAlbero = new Set<string>([
      ...GRUPPI_COMUNI.flatMap((g) => g.dimensioni),
      ...GRUPPI_OPERAZIONI.flatMap((g) => g.campi.map((c) => c.chiave)),
    ]);
    const ammesse = new Set(TUTTE.flatMap((m) => dimensioniPerMetrica(m)));
    // bu_categoria serve solo ai filtri a matrioska: non si spunta.
    expect([...ammesse].filter((d) => d !== "bu_categoria" && !nellAlbero.has(d))).toEqual([]);
  });

  it("ogni campo dichiarato esiste davvero nel motore", () => {
    const dichiarate = [
      ...GRUPPI_COMUNI.flatMap((g) => g.dimensioni),
      ...GRUPPI_OPERAZIONI.flatMap((g) => g.campi.map((c) => c.chiave)),
    ];
    expect(dichiarate.filter((d) => !(d in DIMENSIONI))).toEqual([]);
  });

  it("la business unit sta fra i prodotti, non fra i campi di un'azienda a parte", () => {
    const prodotti = GRUPPI_COMUNI.find((g) => g.chiave === "prodotti");
    expect(prodotti?.dimensioni).toContain("bu");
    expect(GRUPPI_COMUNI.some((g) => g.chiave !== "prodotti" && g.dimensioni.includes("bu"))).toBe(false);
  });

  it("le visite stanno in un gruppo solo: il numero delle visite e i campi del territorio", () => {
    const visite = GRUPPI_OPERAZIONI.filter((g) => g.valori.includes("visite_numero"));
    expect(visite).toHaveLength(1);
    expect(visite[0].campi.map((c) => c.chiave)).toEqual(expect.arrayContaining(["cap", "provincia", "grado", "tipo_visita"]));
    expect(visite[0].valori).toEqual(["visite_numero"]);
  });

  it("il numero del documento sta dentro ogni operazione che ne ha uno, con il suo nome", () => {
    const conDocumento = GRUPPI_OPERAZIONI.filter((g) => g.campi.some((c) => eDocumento(c.chiave)));
    expect(conDocumento.map((g) => g.chiave)).toEqual(
      expect.arrayContaining(["ordinato", "fatturato", "consegnato", "preventivi", "acquisti_ordinato"])
    );
    // Nessun «Documento» generico fra i campi comuni.
    expect(GRUPPI_COMUNI.some((g) => g.dimensioni.includes("documento"))).toBe(false);
    const ordinato = GRUPPI_OPERAZIONI.find((g) => g.chiave === "ordinato")!;
    // Con l'anno nel numero: il numero nudo riparte ogni anno e fonderebbe documenti diversi.
    expect(ordinato.campi.find((c) => eDocumento(c.chiave))).toEqual({ chiave: "documento_anno", etichetta: "Numero ordine/anno" });
    // Gli ordini a fornitore portano gia' l'anno: tengono il numero com'e'.
    expect(GRUPPI_OPERAZIONI.find((g) => g.chiave === "acquisti_ordinato")!.campi.some((c) => c.chiave === "documento")).toBe(true);
  });

  it("il documento di un'operazione vale per le metriche di quell'operazione", () => {
    for (const gruppo of GRUPPI_OPERAZIONI) {
      if (!gruppo.campi.some((c) => c.chiave === "documento")) continue;
      expect(gruppo.famiglieDocumento, gruppo.chiave).toBeDefined();
      // I valori che non sono di questa famiglia (per esempio il budget, o il
      // portafoglio per mese) non ammettono il documento: e' voluto.
      const delGruppo = gruppo.valori.filter((m) => gruppo.famiglieDocumento!.includes(famigliaDellaMetrica(m)));
      expect(delGruppo.length, gruppo.chiave).toBeGreaterThan(0);
    }
  });
});

describe("articolo: il codice e la descrizione", () => {
  const riga = {
    articolo: "AB-1234",
    descrizioneArticolo: "Valvola 5/2 monostabile",
  } as Parameters<(typeof DIMENSIONI)["articolo"]["estrai"]>[0];

  it("c'e' una dimensione col codice e una con la descrizione", () => {
    expect(DIMENSIONI.codice_articolo.estrai(riga)).toBe("AB-1234");
    expect(DIMENSIONI.articolo.estrai(riga)).toBe("Valvola 5/2 monostabile");
    expect(DIMENSIONI.codice_articolo.etichetta).toBe("Codice articolo");
    expect(DIMENSIONI.articolo.etichetta).toBe("Descrizione articolo");
  });

  it("la chiave `articolo` resta la descrizione: i riquadri e i filtri gia' salvati non cambiano significato", () => {
    const senzaDescrizione = { ...riga, descrizioneArticolo: "" };
    expect(DIMENSIONI.articolo.estrai(senzaDescrizione)).toBe("AB-1234");
  });

  it("un articolo senza codice si vede, non sparisce in una riga vuota", () => {
    expect(DIMENSIONI.codice_articolo.estrai({ ...riga, articolo: "" })).toBe("(senza codice)");
  });

  it("tutte le operazioni lo ammettono, e sta nei prodotti", () => {
    expect(dimensioniPerMetrica("ordinato")).toContain("codice_articolo");
    expect(dimensioniPerMetrica("acquisti_valore")).toContain("codice_articolo");
    expect(GRUPPI_COMUNI.find((g) => g.chiave === "prodotti")?.dimensioni).toEqual(
      expect.arrayContaining(["codice_articolo", "articolo"])
    );
  });
});

describe("la natura di un valore", () => {
  it("somma, conteggio, media, rapporto: come in Power BI si sceglie l'aggregazione", () => {
    expect(naturaDellaMetrica("ordinato")).toBe("somma");
    expect(naturaDellaMetrica("n_ordini")).toBe("conteggio");
    expect(naturaDellaMetrica("visite_numero")).toBe("conteggio");
    expect(naturaDellaMetrica("ordine_medio")).toBe("media");
    expect(naturaDellaMetrica("tasso_conversione")).toBe("rapporto");
    expect(naturaDellaMetrica("eta_massima_apertura")).toBe("massimo");
  });

  it("una misura personalizzata e' un calcolo, salvo la metrica con filtri", () => {
    const rapporto = {
      nome: "x",
      espressione: {
        tipo: "rapporto",
        numeratore: { metrica: "margine" },
        denominatore: { metrica: "fatturato" },
      },
    } as const;
    const metrica = { nome: "y", espressione: { tipo: "metrica", metrica: "n_ordini" } } as const;
    expect(naturaDellaVoce("misura:a", { "misura:a": rapporto as never })).toBe("rapporto");
    expect(naturaDellaVoce("misura:b", { "misura:b": metrica as never })).toBe("conteggio");
  });

  it("il progressivo cumula: solo per somme e conteggi", () => {
    expect(ammetteProgressivo("ordinato")).toBe(true);
    expect(ammetteProgressivo("n_ordini")).toBe(true);
    expect(ammetteProgressivo("ordine_medio")).toBe(false);
    expect(ammetteProgressivo("tasso_conversione")).toBe(false);
    expect(ammetteProgressivo("misura:qualcuna")).toBe(false);
  });
});

describe("«Calcola come»", () => {
  it("ogni famiglia legge lo stesso documento in tre modi, nella stessa operazione", () => {
    for (const famiglia of FAMIGLIE_CALCOLO) {
      expect(famiglia).toHaveLength(3);
      expect(new Set(famiglia.map((v) => famigliaDellaMetrica(v.chiave))).size).toBe(1);
      expect(famiglia.map((v) => naturaDellaMetrica(v.chiave))).toEqual(["somma", "conteggio", "media"]);
    }
  });

  it("dall'ordinato si arriva al numero di ordini e al valore medio, e viceversa", () => {
    expect(alternativeDiCalcolo("ordinato").map((a) => a.chiave)).toEqual(["ordinato", "n_ordini", "ordine_medio"]);
    expect(alternativeDiCalcolo("ordine_medio").map((a) => a.chiave)).toContain("ordinato");
  });

  it("dove non c'e' un'alternativa non se ne inventa una", () => {
    expect(alternativeDiCalcolo("margine")).toEqual([]);
    expect(alternativeDiCalcolo("misura:x")).toEqual([]);
  });
});

describe("partire da una misura che c'e' gia'", () => {
  it("il testo cita la misura e il suo calcolo, e lascia da scrivere la variante", () => {
    const testo = testoPerPartireDa("Tasso di conversione", "Convertito ÷ valore dei preventivi × 100.");
    expect(testo).toBe("Come «Tasso di conversione» (Convertito ÷ valore dei preventivi × 100), ma ");
  });
});

describe("il numero del documento riparte ogni anno", () => {
  const perNumero = { raggruppa: ["documento" as const] };

  it("senza tempo e con piu' anni nel periodo si avvisa, e si dice come rimediare", () => {
    const avviso = avvisoNumeroDocumento(perNumero, "ordinato", undefined);
    expect(avviso).toMatch(/riparte ogni anno/);
    expect(avviso).toMatch(/Giorno o Anno/);
    expect(avvisoNumeroDocumento(perNumero, "fatturato", { anni: [2025, 2026] })).toMatch(/riparte ogni anno/);
    expect(avvisoNumeroDocumento(perNumero, "fatturato", { dal: "2025-06-01", al: "2026-05-31" })).toMatch(/riparte ogni anno/);
  });

  it("con un anno solo, o con il tempo fra i campi, non serve", () => {
    expect(avvisoNumeroDocumento(perNumero, "ordinato", { anno: 2026 })).toBeNull();
    expect(avvisoNumeroDocumento(perNumero, "ordinato", { anni: [2026] })).toBeNull();
    expect(avvisoNumeroDocumento(perNumero, "ordinato", { dal: "2026-01-01", al: "2026-06-30" })).toBeNull();
    expect(avvisoNumeroDocumento({ ...perNumero, granularita: "anno" }, "ordinato", undefined)).toBeNull();
    expect(avvisoNumeroDocumento({ ...perNumero, granularita: "giorno" }, "ordinato", { anni: [2025, 2026] })).toBeNull();
  });

  it("senza il numero del documento fra i campi non c'e' niente da dire", () => {
    expect(avvisoNumeroDocumento({ raggruppa: ["cliente"] }, "ordinato", undefined)).toBeNull();
    expect(avvisoNumeroDocumento({}, "ordinato", undefined)).toBeNull();
  });

  it("gli ordini a fornitore portano gia' l'anno nel numero, le visite non hanno un numero", () => {
    expect(avvisoNumeroDocumento(perNumero, "acquisti", undefined)).toBeNull();
    expect(avvisoNumeroDocumento(perNumero, "visite", undefined)).toBeNull();
  });

  it("nelle consegne lo stesso numero esiste per clienti diversi: serve anche il cliente", () => {
    const conAnno = { ...perNumero, granularita: "anno" as const };
    expect(avvisoNumeroDocumento(conAnno, "consegnato", undefined)).toMatch(/Cliente/);
    expect(avvisoNumeroDocumento({ ...conAnno, raggruppa: ["documento", "cliente"] }, "consegnato", undefined)).toBeNull();
  });

  it("il numero ha il nome della sua operazione", () => {
    expect(etichettaDocumento("ordinato")).toBe("Numero ordine/anno");
    expect(etichettaDocumento("fatturato")).toBe("Numero fattura/anno");
    expect(etichettaDocumento("preventivi_aperti")).toBe("Numero preventivo/anno");
    expect(etichettaDocumento("visite")).toBeUndefined();
  });
});

describe("il numero con l'anno e gli altri dati del gestionale", () => {
  const riga = (parziale: object) =>
    ({ data: "2026-03-31", documento: "997", profilo: "OC", codiceCliente: "05001624", codiceAgente: "AG000010", ...parziale }) as Parameters<(typeof DIMENSIONI)["documento"]["estrai"]>[0];

  it("documento_anno separa i documenti di anni diversi con lo stesso numero", () => {
    expect(DIMENSIONI.documento_anno.estrai(riga({}))).toBe("997/2026");
    expect(DIMENSIONI.documento_anno.estrai(riga({ data: "2025-03-31" }))).toBe("997/2025");
    // Il solo numero li fonderebbe.
    expect(DIMENSIONI.documento.estrai(riga({}))).toBe(DIMENSIONI.documento.estrai(riga({ data: "2025-03-31" })));
  });

  it("gli ordini a fornitore portano gia' l'anno: documento_anno non lo raddoppia", () => {
    expect(DIMENSIONI.documento_anno.estrai(riga({ fornitore: "X", documento: "OF 12/2026" }))).toBe("OF 12/2026");
  });

  it("con l'anno nel numero non serve l'avviso, e nelle consegne resta quello sul cliente", () => {
    expect(avvisoNumeroDocumento({ raggruppa: ["documento_anno"] }, "ordinato", undefined)).toBeNull();
    expect(avvisoNumeroDocumento({ raggruppa: ["documento_anno"] }, "consegnato", undefined)).toMatch(/Cliente/);
  });

  it("tipo documento, codici e date di consegna sono dimensioni", () => {
    expect(DIMENSIONI.profilo.estrai(riga({}))).toBe("OC");
    expect(DIMENSIONI.profilo.estrai(riga({ profilo: undefined }))).toBe("(non indicato)");
    expect(DIMENSIONI.codice_cliente.estrai(riga({}))).toBe("05001624");
    expect(DIMENSIONI.codice_agente.estrai(riga({}))).toBe("AG000010");
    expect(DIMENSIONI.data_consegna_richiesta.estrai(riga({ dataConsegnaRichiesta: "2026-04-17" }))).toBe("2026-04-17");
  });

  it("ogni quantita' e' una somma, con la sua operazione", () => {
    for (const [metrica, famiglia] of [
      ["quantita_ordinata", "ordinato"],
      ["quantita_fatturata", "fatturato"],
      ["quantita_consegnata", "consegnato"],
      ["acquisti_quantita", "acquisti"],
    ] as const) {
      expect(naturaDellaMetrica(metrica)).toBe("somma");
      expect(famigliaDellaMetrica(metrica)).toBe(famiglia);
    }
  });

  it("la quantita' fatturata ha il segno del documento: una nota di credito toglie pezzi", () => {
    const valore = CATALOGO.quantita_fatturata.valore!;
    expect(valore({ importo: 100, quantita: 3 } as never)).toBe(3);
    expect(valore({ importo: -100, quantita: 3 } as never)).toBe(-3);
  });
});
