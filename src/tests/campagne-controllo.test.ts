import { describe, expect, it } from "vitest";
import {
  abbinaDdt,
  attribuzioneRiga,
  chiaveOrdine,
  eseguiControllo,
  normNumero,
  normTesto,
  testoRigaCampagna,
  type CampagnaCtrl,
  type DdtImpresa,
  type InputControllo,
  type InvioCtrl,
  type RigaImpresa,
} from "@/lib/portali/campagne/controllo";

const ADESSO = "2026-10-03T03:30:00Z";
const DATI_DEL = "2026-10-02T23:31:00Z"; // estrazione notturna
const PRIMA = "2026-10-02T10:00:00Z"; // invio assegnato PRIMA dell'estrazione
const DOPO = "2026-10-03T08:00:00Z"; // invio assegnato DOPO: i dati non lo contengono ancora

const C1: CampagnaCtrl = { id: "c1", codice: "C_01_26", nome: "CP SICS", articolo_codice: "DOCUMENTAZIONE", testo_riconoscimento: ["SICS"], ordine: 1 };
const C2: CampagnaCtrl = { id: "c2", codice: "C_02_26", nome: "ZECA ZETEK", articolo_codice: "DOCUMENTAZIONE", testo_riconoscimento: ["ZECA", "ZETEK"], ordine: 2 };
const C4: CampagnaCtrl = { id: "c4", codice: "C_04_26", nome: "Nuova", articolo_codice: "ART-C4", testo_riconoscimento: [], ordine: 4 };
const CAMPAGNE = [C1, C2, C4];

const invio = (over: Partial<InvioCtrl> = {}): InvioCtrl => ({
  id: "i1",
  campagna_id: "c1",
  codice_cliente: "K1",
  ragione_sociale: "Cliente 1",
  stato: "preparata",
  ordine_numero: "100",
  ordine_anno: 2026,
  ordine_profilo: null,
  assegnata_il: PRIMA,
  riga_vista_il: null,
  ...over,
});

const riga = (over: Partial<RigaImpresa> = {}): RigaImpresa => ({
  profilo: "OC",
  numero: "100",
  anno: 2026,
  cliente: "K1",
  nome_cliente: "Cliente 1",
  data_doc: "2026-09-20",
  richiesta: "2026-10-10",
  confermata: "2026-10-15",
  articolo: "DOCUMENTAZIONE",
  descrizione: "INVIO DOCUMENTAZIONE C_01_26-CP_SICS",
  aperta: true,
  ...over,
});

const ddt = (over: Partial<DdtImpresa> = {}): DdtImpresa => ({
  numero: "500",
  cliente: "K1",
  data_doc: "2026-10-01",
  articolo: "DOCUMENTAZIONE",
  descrizione: "INVIO DOCUMENTAZIONE C_01_26-CP_SICS",
  ...over,
});

/** Input di base: gli invii, le loro righe, i DDT. Le testate si ricavano dalle righe. */
function input(over: Partial<InputControllo> & { invii?: InvioCtrl[]; righe?: RigaImpresa[] } = {}): InputControllo {
  const invii = over.invii ?? [invio()];
  const righe = over.righe ?? [];
  return {
    adesso: ADESSO,
    datiDel: DATI_DEL,
    campagne: CAMPAGNE,
    invii,
    ordini: [
      ...new Map(
        righe.map((r) => [
          chiaveOrdine(r.cliente, r.anno, r.numero),
          { profilo: r.profilo, numero: r.numero, anno: r.anno, cliente: r.cliente, data_doc: r.data_doc, consegna_prevista: r.confermata, aperto: r.aperta },
        ])
      ).values(),
    ],
    righe,
    righeAperte: righe.filter((r) => r.aperta),
    ddt: [],
    ordiniCollegati: invii
      .filter((i) => i.ordine_numero)
      .map((i) => ({ codice_cliente: i.codice_cliente, ordine_anno: i.ordine_anno, ordine_numero: i.ordine_numero })),
    ...over,
  };
}

const esito = (r: ReturnType<typeof eseguiControllo>, id = "i1") => r.aggiornamenti.find((a) => a.id === id)!;
const tipi = (r: ReturnType<typeof eseguiControllo>) => r.anomalie.map((a) => a.tipo).sort();

describe("normalizzazioni", () => {
  it("il numero d'ordine si confronta senza zeri iniziali", () => {
    expect(normNumero("01117")).toBe("1117");
    expect(normNumero(" 1117 ")).toBe("1117");
    expect(normNumero("000")).toBe("0");
    expect(normNumero(null)).toBe("");
    expect(chiaveOrdine("K1", 2026, "0100")).toBe(chiaveOrdine("K1", 2026, "100"));
  });

  it("il testo ignora maiuscole, spazi e il carattere di controllo spurio delle righe reali", () => {
    expect(normTesto("INVIO DOCUMENTAZIONE C\x1f_02_-ZECA/ZETEK")).toBe("INVIO DOCUMENTAZIONE C _02_-ZECA/ZETEK");
    expect(normTesto("  a   b ")).toBe("A B");
  });

  it("testoRigaCampagna è il testo da incollare in Impresa", () => {
    expect(testoRigaCampagna(C1)).toBe("INVIO DOCUMENTAZIONE C_01_26 CP SICS");
  });
});

describe("attribuzioneRiga", () => {
  it("riconosce la campagna dalle parole, anche con il carattere spurio", () => {
    expect(attribuzioneRiga({ articolo: "DOCUMENTAZIONE", descrizione: "INVIO DOCUMENTAZIONE C\x1f_02_-ZECA/ZETEK" }, C2, CAMPAGNE)).toBe("si");
    expect(attribuzioneRiga({ articolo: "DOCUMENTAZIONE", descrizione: "INVIO DOCUMENTAZIONE C_02_ ZECA ZETEK" }, C1, CAMPAGNE)).toBe("altra");
    expect(attribuzioneRiga({ articolo: "DOCUMENTAZIONE", descrizione: "INVIO DOCUMENTAZIONE" }, C1, CAMPAGNE)).toBe("neutra");
  });

  it("un articolo diverso non c'entra", () => {
    expect(attribuzioneRiga({ articolo: "ALTRO", descrizione: "SICS" }, C1, CAMPAGNE)).toBe("no");
  });

  it("con un articolo dedicato basta l'articolo, senza parole", () => {
    expect(attribuzioneRiga({ articolo: "ART-C4", descrizione: "qualsiasi cosa" }, C4, CAMPAGNE)).toBe("si");
  });
});

describe("una busta preparata contro i dati di Impresa", () => {
  it("riga trovata e ancora aperta: da spedire, con ordine, data di consegna e istante di visione", () => {
    const r = eseguiControllo(input({ righe: [riga()] }));
    const a = esito(r);
    expect(a.patch).toMatchObject({
      stato: "da_spedire",
      controllo_esito: "riga_trovata",
      ordine_profilo: "OC",
      ordine_data: "2026-09-20",
      ordine_data_consegna: "2026-10-15", // la confermata, non la richiesta
      riga_vista_il: ADESSO,
    });
    expect(a.cambiaStato).toBe(true);
    expect(r.anomalie).toEqual([]);
  });

  it("senza data confermata si usa quella richiesta", () => {
    const r = eseguiControllo(input({ righe: [riga({ confermata: null })] }));
    expect(esito(r).patch.ordine_data_consegna).toBe("2026-10-10");
  });

  it("riga evasa con il suo DDT: consegnata, con la data del DDT e il metodo", () => {
    const r = eseguiControllo(input({ righe: [riga({ aperta: false })], ddt: [ddt()] }));
    expect(esito(r).patch).toMatchObject({
      stato: "consegnata",
      data_consegna: "2026-10-01",
      fonte_consegna: "ddt",
      ddt_numero: "500",
      ddt_metodo: "euristico",
      consegna_registrata_il: ADESSO,
      controllo_esito: "consegnata",
    });
    expect(r.anomalie).toEqual([]);
  });

  it("riga evasa senza DDT: resta da spedire e segnala", () => {
    const r = eseguiControllo(input({ righe: [riga({ aperta: false })], ddt: [] }));
    expect(esito(r).patch.stato).toBe("da_spedire");
    expect(esito(r).patch.controllo_esito).toBe("evasa_senza_ddt");
    expect(tipi(r)).toEqual(["evasa_senza_ddt"]);
  });

  it("l'ordine con zeri iniziali digitati si trova lo stesso", () => {
    const r = eseguiControllo(input({ invii: [invio({ ordine_numero: "0100" })], righe: [riga()] }));
    expect(esito(r).patch.stato).toBe("da_spedire");
  });

  it("una riga che non c'è più riporta la busta a «preparata» e segnala", () => {
    // L'ordine esiste ma la riga DOCUMENTAZIONE è stata tolta.
    const r = eseguiControllo(
      input({
        invii: [invio({ stato: "da_spedire", riga_vista_il: PRIMA })],
        righe: [],
        ordini: [{ profilo: "OC", numero: "100", anno: 2026, cliente: "K1", data_doc: "2026-09-20", consegna_prevista: null, aperto: true }],
      })
    );
    expect(esito(r).patch.stato).toBe("preparata");
    expect(tipi(r)).toEqual(["riga_mancante"]);
  });
});

describe("anomalie: ordine non trovato e riga mancante", () => {
  it("ordine inesistente con dati più recenti dell'invio: numero sbagliato, anomalia", () => {
    const r = eseguiControllo(input({ righe: [], ordini: [] }));
    expect(esito(r).patch.controllo_esito).toBe("ordine_non_trovato");
    expect(tipi(r)).toEqual(["ordine_non_trovato"]);
  });

  it("ordine inesistente MA invio più recente dei dati: si aspetta, niente anomalia", () => {
    const r = eseguiControllo(input({ invii: [invio({ assegnata_il: DOPO })], righe: [], ordini: [] }));
    expect(esito(r).patch.controllo_esito).toBe("attesa_dati");
    expect(r.anomalie).toEqual([]);
  });

  it("senza sapere quando sono stati estratti i dati non si accusa nessuno", () => {
    const r = eseguiControllo(input({ datiDel: null, righe: [], ordini: [] }));
    expect(r.anomalie).toEqual([]);
  });

  it("l'ordine c'è ma manca la riga: il popup riceve articolo, testo, ordine, data e cliente", () => {
    const altra = riga({ articolo: "ART-X", descrizione: "Un altro articolo" });
    const r = eseguiControllo(input({ righe: [], ordini: [{ profilo: "OC", numero: "100", anno: 2026, cliente: "K1", data_doc: "2026-09-20", consegna_prevista: null, aperto: true }] }));
    void altra;
    const a = r.anomalie[0];
    expect(a.tipo).toBe("riga_mancante");
    expect(a).toMatchObject({ codice_cliente: "K1", ragione_sociale: "Cliente 1", ordine_numero: "100", ordine_anno: 2026, invio_id: "i1" });
    expect(a.dettaglio).toMatchObject({
      articolo: "DOCUMENTAZIONE",
      testo_riga: "INVIO DOCUMENTAZIONE C_01_26 CP SICS",
      data_ordine: "2026-09-20",
      campagna_codice: "C_01_26",
    });
  });

  it("l'ordine c'è già nei dati, manca la riga, anche se l'invio è più recente dei dati: anomalia subito", () => {
    // I dati sono di venerdì, la busta è del sabato: ma l'ordine era già in Impresa, quindi doveva esserci.
    const r = eseguiControllo(
      input({ invii: [invio({ assegnata_il: DOPO })], righe: [], ordini: [{ profilo: "OC", numero: "100", anno: 2026, cliente: "K1", data_doc: "2026-09-20", consegna_prevista: null, aperto: true }] })
    );
    expect(tipi(r)).toEqual(["riga_mancante"]);
    expect(esito(r).patch.controllo_esito).toBe("riga_mancante");
  });

  it("la riga nomina un'altra campagna: incoerente, e la busta non avanza", () => {
    const r = eseguiControllo(input({ righe: [riga({ descrizione: "INVIO DOCUMENTAZIONE C_02_ ZECA ZETEK" })] }));
    expect(tipi(r)).toEqual(["campagna_incoerente"]);
    expect(esito(r).patch.stato).toBeUndefined();
    expect(r.anomalie[0].dettaglio).toMatchObject({ campagne_nella_riga: ["C_02_26"] });
  });

  it("la riga non nomina nessuna campagna: si procede, ed è un'anomalia (non una busta «da spedire» pulita)", () => {
    const r = eseguiControllo(input({ righe: [riga({ descrizione: "INVIO DOCUMENTAZIONE" })] }));
    expect(esito(r).patch.stato).toBe("da_spedire");
    expect(r.anomalie.map((a) => [a.tipo, a.gravita])).toEqual([["riga_senza_campagna", "errore"]]);
  });
});

describe("busta importata dall'Excel senza numero d'ordine: adozione", () => {
  const x = (over: Partial<InvioCtrl> = {}) => invio({ ordine_numero: null, ordine_anno: null, ...over });

  it("se in Impresa c'è UNA riga aperta di quella campagna per il cliente, è la sua", () => {
    const r = eseguiControllo(input({ invii: [x()], righe: [riga({ numero: "777" })] }));
    expect(esito(r)).toMatchObject({ adottato: true });
    expect(esito(r).patch).toMatchObject({ ordine_numero: "777", ordine_anno: 2026, ordine_profilo: "OC", stato: "da_spedire" });
    expect(r.anomalie).toEqual([]);
  });

  it("con due righe candidate non si indovina", () => {
    const r = eseguiControllo(input({ invii: [x()], righe: [riga({ numero: "777" }), riga({ numero: "778" })] }));
    expect(esito(r).adottato).toBe(false);
    expect(esito(r).patch.ordine_numero).toBeUndefined();
    // Con più candidate non si può dire che la riga manchi.
    expect(tipi(r)).not.toContain("riga_mancante");
  });

  it("nessuna riga aperta per quel cliente e dati più recenti della busta: riga mancante, senza numero d'ordine", () => {
    const r = eseguiControllo(input({ invii: [x({ stato: "preparata" })], righe: [] }));
    expect(tipi(r)).toEqual(["riga_mancante"]);
    expect(r.anomalie[0]).toMatchObject({ invio_id: "i1", ordine_numero: null, ordine_anno: null, gravita: "errore" });
    expect(r.anomalie[0].dettaglio).toMatchObject({ senza_ordine: true, campagna_codice: "C_01_26" });
    expect(esito(r).patch.controllo_esito).toBe("riga_mancante");
  });

  it("la stessa busta, ma più recente dei dati: si aspetta", () => {
    const r = eseguiControllo(input({ invii: [x({ stato: "preparata", assegnata_il: DOPO })], righe: [] }));
    expect(r.anomalie).toEqual([]);
  });

  it("una riga di un'altra campagna non si adotta", () => {
    const r = eseguiControllo(input({ invii: [x()], righe: [riga({ numero: "777", descrizione: "INVIO DOCUMENTAZIONE ZECA ZETEK" })] }));
    expect(esito(r).adottato).toBe(false);
  });

  it("una riga già legata a un altro invio non si adotta", () => {
    const r = eseguiControllo(
      input({
        invii: [x(), invio({ id: "i2", campagna_id: "c1", ordine_numero: "777" })],
        righe: [riga({ numero: "777" })],
      })
    );
    expect(esito(r, "i1").adottato).toBe(false);
  });

  it("riga già evasa con il suo DDT (busta partita prima che il programma la conoscesse): adottata e consegnata", () => {
    const r = eseguiControllo(
      input({ invii: [x()], righe: [riga({ numero: "2698", aperta: false })], ddt: [ddt({ numero: "2728" })] })
    );
    expect(esito(r)).toMatchObject({ adottato: true });
    expect(esito(r).patch).toMatchObject({ ordine_numero: "2698", stato: "consegnata", ddt_numero: "2728", controllo_esito: "consegnata" });
    expect(r.anomalie).toEqual([]);
  });

  it("unica riga evasa ma senza DDT: si adotta e si segnala «evasa senza DDT», non «riga mancante»", () => {
    const r = eseguiControllo(
      input({ invii: [x()], righe: [riga({ numero: "2698", aperta: false, data_doc: "2026-07-31" })], ddt: [] })
    );
    expect(esito(r)).toMatchObject({ adottato: true });
    expect(esito(r).patch.ordine_numero).toBe("2698");
    expect(tipi(r)).toEqual(["evasa_senza_ddt"]);
  });

  it("fra una riga evasa con DDT e una senza, si adotta quella con il DDT", () => {
    const r = eseguiControllo(
      input({
        invii: [x()],
        righe: [riga({ numero: "10", aperta: false, data_doc: "2026-02-01" }), riga({ numero: "20", aperta: false })],
        ddt: [ddt({ numero: "2" })],
      })
    );
    // La riga 20 ha il DDT (data 2026-10-01 >= 2026-09-20); la 10 avrebbe preso lo stesso DDT: si guarda l'abbinamento.
    expect(esito(r).adottato).toBe(true);
    expect(r.anomalie.map((a) => a.tipo)).not.toContain("riga_mancante");
  });

  it("due righe evase della stessa campagna con DDT: non si indovina", () => {
    const r = eseguiControllo(
      input({
        invii: [x()],
        righe: [riga({ numero: "10", aperta: false, data_doc: "2026-02-01" }), riga({ numero: "20", aperta: false })],
        ddt: [ddt({ numero: "1", data_doc: "2026-02-05" }), ddt({ numero: "2" })],
      })
    );
    expect(esito(r).adottato).toBe(false);
    expect(tipi(r)).not.toContain("riga_mancante");
  });

  it("una riga evasa già legata a un altro invio (storico) non si adotta", () => {
    const r = eseguiControllo(
      input({
        invii: [x(), invio({ id: "i2", stato: "consegnata" as never, ordine_numero: "2698" })],
        righe: [riga({ numero: "2698", aperta: false })],
        ddt: [ddt()],
      })
    );
    expect(esito(r, "i1").adottato).toBe(false);
  });
});

describe("riga evasa senza DDT: tolleranza per i dati notturni", () => {
  it("ordine di ieri (non ancora in portafoglio né nei DDT): da spedire, niente anomalia", () => {
    const r = eseguiControllo(input({ righe: [riga({ aperta: false, data_doc: "2026-10-02" })], ddt: [] }));
    expect(esito(r).patch.stato).toBe("da_spedire");
    expect(esito(r).patch.controllo_esito).toBe("riga_trovata");
    expect(r.anomalie).toEqual([]);
  });

  it("oltre la tolleranza torna anomalia", () => {
    const r = eseguiControllo(input({ righe: [riga({ aperta: false, data_doc: "2026-09-28" })], ddt: [] }));
    expect(tipi(r)).toEqual(["evasa_senza_ddt"]);
  });
});

describe("documentazione senza busta", () => {
  it("una riga aperta che nessun invio spiega è un'anomalia, con la campagna riconosciuta", () => {
    const r = eseguiControllo(input({ invii: [], righe: [riga({ cliente: "K9", nome_cliente: "Cliente 9", numero: "55" })] }));
    expect(r.anomalie).toHaveLength(1);
    expect(r.anomalie[0]).toMatchObject({
      tipo: "documentazione_senza_busta",
      codice_cliente: "K9",
      ragione_sociale: "Cliente 9",
      ordine_numero: "55",
      campagna_id: "c1",
      chiave: "documentazione_senza_busta|K9|2026|55",
    });
  });

  it("una riga che un invio già spiega non è un'anomalia", () => {
    const r = eseguiControllo(input({ righe: [riga()] }));
    expect(r.anomalie).toEqual([]);
  });

  it("anche se l'invio che la spiega è già chiuso", () => {
    const r = eseguiControllo(
      input({ invii: [], righe: [riga()], ordiniCollegati: [{ codice_cliente: "K1", ordine_anno: 2026, ordine_numero: "100" }] })
    );
    expect(r.anomalie).toEqual([]);
  });

  it("senza parole riconoscibili la campagna resta ignota ma l'anomalia c'è", () => {
    const r = eseguiControllo(input({ invii: [], righe: [riga({ descrizione: "INVIO DOCUMENTAZIONE" })] }));
    expect(r.anomalie[0].campagna_id).toBeNull();
  });
});

describe("inversione degli ordini", () => {
  // C1 sull'ordine che parte il 31/12, C2 su quello che parte l'01/11.
  const inv = (id: string, campagna: string, numero: string) => invio({ id, campagna_id: campagna, ordine_numero: numero, stato: "da_spedire" });
  const righeDue = (dataA: string, dataB: string) => [
    riga({ numero: "100", confermata: dataA, descrizione: "INVIO DOCUMENTAZIONE C_01_26-CP_SICS" }),
    riga({ numero: "200", confermata: dataB, descrizione: "INVIO DOCUMENTAZIONE C_02_ ZECA ZETEK" }),
  ];

  it("la campagna più vecchia sull'ordine che parte dopo: anomalia con lo scambio proposto", () => {
    const r = eseguiControllo(input({ invii: [inv("i1", "c1", "100"), inv("i2", "c2", "200")], righe: righeDue("2026-12-31", "2026-11-01") }));
    const a = r.anomalie.find((x) => x.tipo === "ordine_invertito")!;
    expect(a.chiave).toBe("ordine_invertito|K1");
    const mosse = a.dettaglio.mosse as { invio_id: string; campagna_codice: string; da: { ordine_numero: string }; a: { ordine_numero: string } }[];
    expect(mosse).toHaveLength(2);
    // C1 passa dall'ordine 100 (31/12) al 200 (01/11); C2 il contrario.
    expect(mosse.find((m) => m.invio_id === "i1")).toMatchObject({ campagna_codice: "C_01_26", da: { ordine_numero: "100" }, a: { ordine_numero: "200" } });
    expect(mosse.find((m) => m.invio_id === "i2")).toMatchObject({ campagna_codice: "C_02_26", da: { ordine_numero: "200" }, a: { ordine_numero: "100" } });
  });

  it("nell'ordine giusto non c'è anomalia", () => {
    const r = eseguiControllo(input({ invii: [inv("i1", "c1", "100"), inv("i2", "c2", "200")], righe: righeDue("2026-11-01", "2026-12-31") }));
    expect(r.anomalie).toEqual([]);
  });

  it("due ordini che partono lo stesso giorno non sono invertiti", () => {
    const r = eseguiControllo(input({ invii: [inv("i1", "c1", "100"), inv("i2", "c2", "200")], righe: righeDue("2026-11-01", "2026-11-01") }));
    expect(r.anomalie).toEqual([]);
  });

  it("stesso giorno ma numeri d'ordine «incrociati»: si confrontano le date, non i numeri", () => {
    // C1 sull'ordine 200 e C2 sul 100, entrambi in partenza l'01/11: nessuna inversione.
    const righe = [
      riga({ numero: "200", confermata: "2026-11-01", descrizione: "INVIO DOCUMENTAZIONE C_01_26-CP_SICS" }),
      riga({ numero: "100", confermata: "2026-11-01", descrizione: "INVIO DOCUMENTAZIONE C_02_ ZECA ZETEK" }),
    ];
    const r = eseguiControllo(input({ invii: [inv("i1", "c1", "200"), inv("i2", "c2", "100")], righe }));
    expect(r.anomalie).toEqual([]);
  });

  it("un invio già consegnato non entra nel confronto", () => {
    const r = eseguiControllo(
      input({
        invii: [inv("i1", "c1", "100"), inv("i2", "c2", "200")],
        righe: [
          riga({ numero: "100", confermata: "2026-12-31", aperta: false }),
          riga({ numero: "200", confermata: "2026-11-01", descrizione: "INVIO DOCUMENTAZIONE C_02_ ZECA ZETEK" }),
        ],
        ddt: [ddt({ data_doc: "2026-12-30" })],
      })
    );
    expect(r.anomalie.some((a) => a.tipo === "ordine_invertito")).toBe(false);
  });

  it("clienti diversi non si confrontano fra loro", () => {
    const r = eseguiControllo(
      input({
        invii: [inv("i1", "c1", "100"), invio({ id: "i2", codice_cliente: "K2", campagna_id: "c2", ordine_numero: "200", stato: "da_spedire" })],
        righe: [riga({ numero: "100", confermata: "2026-12-31" }), riga({ numero: "200", cliente: "K2", confermata: "2026-11-01", descrizione: "ZECA" })],
      })
    );
    expect(r.anomalie.some((a) => a.tipo === "ordine_invertito")).toBe(false);
  });
});

describe("abbinaDdt", () => {
  const evasa = (numero: string, data_doc: string, conf: string | null) =>
    riga({ numero, data_doc, confermata: conf, richiesta: null, aperta: false });

  it("per data di consegna confermata, non per data d'ordine: il caso dell'inversione", () => {
    // L'ordine 1128 (14/04) parte il 18/05; l'ordine 1319 (27/04) parte prima, il 27/04.
    const righe = [evasa("1128", "2026-04-14", "2026-05-13"), evasa("1319", "2026-04-27", "2026-04-27")];
    const d = [ddt({ numero: "1135", data_doc: "2026-04-27" }), ddt({ numero: "1371", data_doc: "2026-05-18" })];
    const m = abbinaDdt(righe, d, CAMPAGNE);
    const per = (n: string) => [...m.entries()].find(([k]) => k.includes(`|${n}|`))![1].numero;
    expect(per("1319")).toBe("1135");
    expect(per("1128")).toBe("1371");
  });

  it("un DDT non precede mai il suo ordine", () => {
    const m = abbinaDdt([evasa("10", "2026-05-01", "2026-05-10")], [ddt({ data_doc: "2026-04-01" })], CAMPAGNE);
    expect(m.size).toBe(0);
  });

  it("ogni DDT si usa una volta sola", () => {
    const m = abbinaDdt([evasa("10", "2026-05-01", "2026-05-10"), evasa("11", "2026-05-02", "2026-05-11")], [ddt({ numero: "A", data_doc: "2026-05-12" })], CAMPAGNE);
    expect(m.size).toBe(1);
  });

  it("a parità, preferisce il DDT che nomina la stessa campagna", () => {
    const righe = [evasa("10", "2026-05-01", "2026-05-10")];
    const d = [
      ddt({ numero: "ZECA", data_doc: "2026-05-11", descrizione: "INVIO DOCUMENTAZIONE ZECA ZETEK" }),
      ddt({ numero: "SICS", data_doc: "2026-05-12", descrizione: "INVIO DOCUMENTAZIONE C_01_26-CP_SICS" }),
    ];
    expect([...abbinaDdt(righe, d, CAMPAGNE).values()][0].numero).toBe("SICS");
  });

  it("…ma è una preferenza: se è l'unico DDT disponibile si prende lo stesso", () => {
    const righe = [evasa("10", "2026-05-01", "2026-05-10")];
    const d = [ddt({ numero: "ZECA", data_doc: "2026-05-11", descrizione: "INVIO DOCUMENTAZIONE ZECA ZETEK" })];
    expect([...abbinaDdt(righe, d, CAMPAGNE).values()][0].numero).toBe("ZECA");
  });

  it("un articolo diverso non si abbina", () => {
    const m = abbinaDdt([evasa("10", "2026-05-01", "2026-05-10")], [ddt({ articolo: "ALTRO", data_doc: "2026-05-11" })], CAMPAGNE);
    expect(m.size).toBe(0);
  });
});

describe("campagna con articolo dedicato", () => {
  it("la busta di C_04 si controlla solo dall'articolo", () => {
    const r = eseguiControllo(
      input({ invii: [invio({ campagna_id: "c4" })], righe: [riga({ articolo: "ART-C4", descrizione: "testo libero" })] })
    );
    expect(esito(r).patch.stato).toBe("da_spedire");
    expect(r.anomalie).toEqual([]);
  });
});

describe("idempotenza", () => {
  it("rieseguire il controllo sugli stessi dati non cambia lo stato né crea anomalie diverse", () => {
    const i = input({ righe: [riga({ aperta: false })], ddt: [ddt()] });
    const a = eseguiControllo(i);
    // Seconda esecuzione: l'invio ora è consegnato, quindi non è più in lavorazione.
    const dopo = eseguiControllo({ ...i, invii: [] });
    expect(a.aggiornamenti[0].patch.stato).toBe("consegnata");
    expect(dopo.aggiornamenti).toEqual([]);
  });

  it("le anomalie hanno chiavi stabili", () => {
    const i = input({ righe: [], ordini: [] });
    expect(eseguiControllo(i).anomalie.map((a) => a.chiave)).toEqual(eseguiControllo(i).anomalie.map((a) => a.chiave));
  });
});


describe("storico importato dall'Excel: ricostruzione del numero d'ordine", () => {
  const storico = (over: Record<string, unknown> = {}) => ({
    id: "s1",
    campagna_id: "c1",
    codice_cliente: "K1",
    stato: "consegnata" as const,
    data_consegna: "2026-10-01",
    ...over,
  });
  const evasa = (over: Partial<RigaImpresa> = {}) => riga({ aperta: false, ...over });
  const base = (over: Partial<InputControllo> = {}) => input({ invii: [], righe: [evasa()], ddt: [ddt()], ...over });

  it("trova l'ordine dalla riga evasa il cui DDT porta la data del foglio", () => {
    const r = eseguiControllo(base({ storici: [storico()] }));
    expect(r.storico).toHaveLength(1);
    expect(r.storico[0].patch).toMatchObject({
      ordine_numero: "100",
      ordine_anno: 2026,
      ordine_profilo: "OC",
      ordine_data: "2026-09-20",
      ordine_data_consegna: "2026-10-15",
      ddt_numero: "500",
      ddt_metodo: "euristico",
    });
    expect(r.storicoSenzaOrdine).toEqual([]);
  });

  it("non cambia mai lo stato né la data di consegna dell'invio storico", () => {
    const p = eseguiControllo(base({ storici: [storico()] })).storico[0].patch as unknown as Record<string, unknown>;
    expect(p).not.toHaveProperty("stato");
    expect(p).not.toHaveProperty("data_consegna");
  });

  it("funziona anche per la consegna al banco", () => {
    const r = eseguiControllo(base({ storici: [storico({ stato: "consegnata_banco" })], righe: [evasa({ profilo: "OCB" })] }));
    expect(r.storico[0].patch.ordine_profilo).toBe("OCB");
  });

  it("se la data del DDT non è quella del foglio non si inventa un ordine", () => {
    const r = eseguiControllo(base({ storici: [storico({ data_consegna: "2026-09-30" })] }));
    expect(r.storico).toEqual([]);
    expect(r.storicoSenzaOrdine).toEqual([{ id: "s1", motivo: "nessuna_riga" }]);
  });

  it("un cliente senza nessuna riga in Impresa resta senza ordine", () => {
    const r = eseguiControllo(base({ righe: [], ddt: [], storici: [storico()] }));
    expect(r.storicoSenzaOrdine).toEqual([{ id: "s1", motivo: "nessuna_riga" }]);
  });

  it("con due righe candidate non sceglie", () => {
    const r = eseguiControllo(
      base({
        righe: [evasa({ numero: "100" }), evasa({ numero: "101", descrizione: "INVIO DOCUMENTAZIONE C_01_26-CP_SICS bis" })],
        ddt: [ddt({ numero: "500" }), ddt({ numero: "501" })],
        storici: [storico()],
      })
    );
    expect(r.storico).toEqual([]);
    expect(r.storicoSenzaOrdine[0].motivo).toBe("ambiguo");
  });

  it("la riga deve essere della campagna dell'invio: un'altra campagna non vale", () => {
    const r = eseguiControllo(
      base({ righe: [evasa({ descrizione: "INVIO DOCUMENTAZIONE C_02_ ZECA ZETEK" })], ddt: [ddt({ descrizione: "INVIO DOCUMENTAZIONE C_02_ ZECA ZETEK" })], storici: [storico()] })
    );
    expect(r.storico).toEqual([]);
  });

  it("un ordine già legato a un altro invio non si riassegna", () => {
    const r = eseguiControllo(
      base({ storici: [storico()], ordiniCollegati: [{ codice_cliente: "K1", ordine_anno: 2026, ordine_numero: "100" }] })
    );
    expect(r.storico).toEqual([]);
  });

  it("due invii storici dello stesso cliente prendono due ordini diversi, non lo stesso", () => {
    const r = eseguiControllo(
      base({
        righe: [
          evasa({ numero: "100", confermata: "2026-02-01", data_doc: "2026-01-10" }),
          evasa({ numero: "200", confermata: "2026-06-01", data_doc: "2026-05-10" }),
        ],
        ddt: [ddt({ numero: "A", data_doc: "2026-02-03" }), ddt({ numero: "B", data_doc: "2026-06-04" })],
        storici: [storico({ id: "s1", data_consegna: "2026-02-03" }), storico({ id: "s2", data_consegna: "2026-06-04" })],
      })
    );
    expect(Object.fromEntries(r.storico.map((x) => [x.id, x.patch.ordine_numero]))).toEqual({ s1: "100", s2: "200" });
  });

  it("senza invii storici in ingresso non produce niente", () => {
    const r = eseguiControllo(base());
    expect(r.storico).toEqual([]);
    expect(r.storicoSenzaOrdine).toEqual([]);
  });
});
