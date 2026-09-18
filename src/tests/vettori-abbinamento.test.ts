import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  abbina,
  aNostroCarico,
  direzioneDi,
  nomiCompatibili,
  raggruppaInSpedizioni,
  riepilogoAbbinamento,
  siglaProvincia,
  viaggiaConVettore,
  type BollaGestionale,
} from "@/lib/portali/vettori/abbinamento";
import { leggiFattura } from "@/lib/portali/vettori/fatture";
import bolleJson from "./fixtures/vettori-bolle-giugno-luglio-2026.json";

/**
 * L'aggancio è provato sui dati veri di entrambe le parti: le bolle estratte dal
 * gestionale (giugno e luglio 2026, 1.267 documenti) e le fatture dei vettori
 * dello stesso periodo.
 *
 * È la verifica che conta più di tutte, perché è l'unica che dice se il modulo
 * fa il suo mestiere. Un parser che legge bene e un motore che calcola bene non
 * servono a niente se poi le due metà non si trovano.
 */

const BOLLE = bolleJson as unknown as BollaGestionale[];

function fattura(nome: string): string {
  return readFileSync(
    path.resolve(__dirname, "fixtures", "fatture", `${nome}.txt`),
    "utf8"
  );
}

describe("verso e porto del documento", () => {
  it("il tipo_registro decide il verso, il profilo conferma", () => {
    expect(direzioneDi({ tipo_registro: "DA", codice_profilo: "BF" } as BollaGestionale)).toBe("entrata");
    expect(direzioneDi({ tipo_registro: "DV", codice_profilo: "BC" } as BollaGestionale)).toBe("uscita");
    expect(direzioneDi({ tipo_registro: null, codice_profilo: "BF" } as BollaGestionale)).toBe("entrata");
    expect(direzioneDi({ tipo_registro: null, codice_profilo: "XX" } as BollaGestionale)).toBeNull();
  });

  it.each([
    ["RIPEF", "entrata"],
    ["RIPEC", "entrata"],
    ["RIPUF", "uscita"],
    ["RIPUC", "uscita"],
  ] as const)("il profilo di riparazione %s è in %s", (profilo, direzione) => {
    expect(
      direzioneDi({ tipo_registro: profilo.endsWith("F") ? "GA" : "GV", codice_profilo: profilo } as BollaGestionale)
    ).toBe(direzione);
  });

  /**
   * La regola che è facilissimo invertire, e che invertita non dà errore: fa
   * solo cercare in fattura le spedizioni sbagliate.
   */
  it("il porto si legge al contrario nei due versi", () => {
    // Uscite: paghiamo noi con franco e franco addebito fattura.
    expect(aNostroCarico("uscita", "01")).toBe(true);
    expect(aNostroCarico("uscita", "03")).toBe(true);
    expect(aNostroCarico("uscita", "02")).toBe(false);
    // Arrivi: paghiamo noi con il porto assegnato.
    expect(aNostroCarico("entrata", "02")).toBe(true);
    expect(aNostroCarico("entrata", "03")).toBe(false);
    expect(aNostroCarico("entrata", "01")).toBe(false);
    // Senza porto non si inventa un sì né un no.
    expect(aNostroCarico("entrata", null)).toBeNull();
  });
});

describe("confronto fra ragioni sociali troncate", () => {
  it.each([
    ["HTP HIGH TECH PROD", "H.T.P. High Tech Products sr"],
    ["Cosmotecnica srl (", "COSMOTECNICA srl"],
    ["AIGNEP SPA (BS ) B", "AIGNEP spa"],
    ["MEC FLUID 2 SRL (V", "MEC FLUID 2 srl"],
    ["ITALGOMMA SRL (E9)", "ITALGOMMA srl"],
  ])("«%s» e «%s» sono la stessa azienda", (fattura, gestionale) => {
    expect(nomiCompatibili(fattura, gestionale)).toBe(true);
  });

  it("non aggancia aziende diverse", () => {
    expect(nomiCompatibili("AIGNEP SPA", "AIREX SRL")).toBe(false);
    expect(nomiCompatibili("ATLAS FILTRI", "ATLANTA")).toBe(false);
  });

  it("i nomi troppo corti non bastano: meglio nessun aggancio che uno sbagliato", () => {
    expect(nomiCompatibili("AB", "ABCDEFGH")).toBe(false);
    expect(nomiCompatibili("", "QUALCOSA")).toBe(false);
    expect(nomiCompatibili(null, "QUALCOSA")).toBe(false);
  });
});

describe("raggruppamento in spedizioni logiche", () => {
  const spedizioni = raggruppaInSpedizioni(BOLLE);

  it("parte da 1.267 documenti veri", () => {
    expect(BOLLE.length).toBe(1267);
  });

  it("raggruppa: le spedizioni sono meno dei documenti", () => {
    expect(spedizioni.length).toBeGreaterThan(0);
    expect(spedizioni.length).toBeLessThan(BOLLE.length);
  });

  it("ogni documento finisce in una spedizione e in una sola", () => {
    const visti = spedizioni.flatMap((s) => s.idDocumenti);
    const conVerso = BOLLE.filter((b) => direzioneDi(b) !== null);
    expect(visti.length).toBe(conVerso.length);
    expect(new Set(visti).size).toBe(visti.length);
  });

  it("i documenti raggruppati sono quelli con stesso fornitore, numero e data", () => {
    const multiple = spedizioni.filter((s) => s.idDocumenti.length > 1);
    expect(multiple.length).toBeGreaterThan(0);
    for (const s of multiple) {
      expect(s.riferimentoNorm).toBeTruthy();
      expect(s.codiceControparte).toBeTruthy();
    }
  });

  it("i documenti senza numero restano individuali", () => {
    // Fonderli per controparte e data unirebbe spedizioni diverse dello stesso
    // fornitore nello stesso giorno: un errore peggiore del non raggrupparle.
    const senzaNumero = spedizioni.filter((s) => !s.riferimentoNorm);
    for (const s of senzaNumero) expect(s.idDocumenti).toHaveLength(1);
  });

  it("colli e pesi si sommano nel gruppo", () => {
    const conPiu = spedizioni.find(
      (s) => s.idDocumenti.length > 1 && s.peso != null && s.peso > 0
    );
    if (conPiu) expect(conPiu.peso).toBeGreaterThan(0);
  });

  it.each(["D", " d ", "M", " m "])("scarta il mezzo %j, che non usa un vettore", (mezzo) => {
    const bolla = {
      ...BOLLE[0],
      id_documento: 900_001,
      tras_mezzo: mezzo,
    };
    expect(viaggiaConVettore(bolla)).toBe(false);
    expect(raggruppaInSpedizioni([bolla])).toHaveLength(0);
  });

  it.each(["V", " v ", "", "   "])("conserva il mezzo %j", (mezzo) => {
    const bolla = {
      ...BOLLE[0],
      id_documento: 900_002,
      tras_mezzo: mezzo,
    };
    expect(viaggiaConVettore(bolla)).toBe(true);
    expect(raggruppaInSpedizioni([bolla])).toHaveLength(1);
  });
});

describe("aggancio della fattura GLS di luglio alle bolle vere", () => {
  const f = leggiFattura(fattura("ft-gls-07-26"));
  const spedizioni = raggruppaInSpedizioni(BOLLE);
  const esiti = abbina(f.righe, spedizioni);
  const r = riepilogoAbbinamento(esiti);

  it("copre tutte e 55 le righe della fattura", () => {
    expect(esiti).toHaveLength(55);
    expect(r.totale).toBe(55);
    expect(r.agganciate + r.daConfermare + r.senzaCandidati).toBe(55);
  });

  /**
   * Il numero che decide se il modulo serve a qualcosa: **40 spedizioni su 55
   * agganciate con certezza**, nessuna rimasta senza candidati. Le altre 15
   * finiscono in coda, e sono in buona parte le 11 righe che GLS manda senza
   * numero di bolla.
   */
  it("aggancia con certezza 40 spedizioni su 55, e non lascia nessuna riga orfana", () => {
    expect(r.agganciate).toBeGreaterThanOrEqual(38);
    expect(r.senzaCandidati).toBe(0);
  });

  it("nessuna riga resta senza esito", () => {
    for (const e of esiti) {
      expect(["numero", "assistito", "nessuno"]).toContain(e.qualita);
      expect(e.motivo.length).toBeGreaterThan(10);
    }
  });

  /**
   * Il filtro sul verso non è un dettaglio: lo stesso numero esiste sia su un
   * nostro DDT di vendita sia su un carico da fornitore, e senza il filtro una
   * riga in arrivo si agganciava a una partenza con un nome somigliante — con
   * la *certezza* dell'aggancio per numero, per giunta.
   */
  it("il verso dell'aggancio coincide sempre con quello della riga di fattura", () => {
    const discordi = esiti.filter((e) => {
      if (e.qualita !== "numero") return false;
      const riga = f.righe.find((x) => x.numero === e.rigaFattura)!;
      return riga.direzione !== null && riga.direzione !== e.spedizione!.direzione;
    });
    expect(discordi).toHaveLength(0);
  });

  it("la fattura GLS contiene anche due partenze, non solo arrivi", () => {
    // Le righe senza il prefisso «da » sono spedizioni in uscita: trattare la
    // fattura come se fosse tutta di arrivi le classificherebbe al contrario.
    expect(f.righe.filter((x) => x.direzione === "uscita")).toHaveLength(2);
  });

  /**
   * La regola del porto, verificata sui dati: sugli **arrivi** paghiamo noi
   * quando il porto è ASSEGNATO, sulle **partenze** col franco addebito
   * fattura. Se la regola fosse invertita, il controllo cercherebbe in fattura
   * le spedizioni sbagliate — e non darebbe nessun errore.
   */
  it("gli arrivi agganciati sono in porto assegnato", () => {
    const arrivi = esiti
      .filter((e) => e.qualita === "numero" && e.spedizione?.direzione === "entrata")
      .map((e) => e.spedizione!);
    const conPorto = arrivi.filter((s) => s.portoCodice);
    expect(conPorto.filter((s) => s.portoCodice === "02").length).toBe(conPorto.length);
    expect(conPorto.every((s) => s.aNostroCarico === true)).toBe(true);
  });

  it("le 11 righe senza riferimento non spariscono: vanno in coda", () => {
    const senzaRiferimento = f.righe.filter((x) => !x.riferimento);
    expect(senzaRiferimento).toHaveLength(11);
    for (const riga of senzaRiferimento) {
      const e = esiti.find((x) => x.rigaFattura === riga.numero)!;
      expect(e.qualita).not.toBe("numero");
      expect(e.motivo).toContain("numero di bolla");
    }
  });

  it("le spedizioni agganciate portano la zona tariffaria", () => {
    const agganciate = esiti.filter((e) => e.qualita === "numero");
    const conZona = agganciate.filter(
      (e) => e.spedizione!.zonaProvincia || e.spedizione!.zonaCap
    );
    expect(conZona.length).toBe(agganciate.length);
  });
});

describe("aggancio della fattura Trading Post di luglio", () => {
  const f = leggiFattura(fattura("tp1260-002218-07-26"));
  const spedizioni = raggruppaInSpedizioni(BOLLE);
  const esiti = abbina(f.righe, spedizioni);
  const r = riepilogoAbbinamento(esiti);

  it("copre tutte e 53 le righe", () => {
    expect(esiti).toHaveLength(53);
  });

  /**
   * Sulle partenze la fattura cita il NOSTRO numero di bolla, che c'è sempre:
   * qui l'aggancio è quasi totale — **47 righe su 53**, di cui 35 partenze.
   */
  it("aggancia con certezza 47 righe su 53", () => {
    expect(r.agganciate).toBeGreaterThanOrEqual(45);
    const uscite = esiti.filter(
      (e) => e.spedizione?.direzione === "uscita" && e.qualita === "numero"
    );
    expect(uscite.length).toBeGreaterThanOrEqual(33);
  });

  it("le partenze agganciate sono quasi tutte in franco addebito fattura", () => {
    const uscite = esiti
      .filter((e) => e.qualita === "numero" && e.spedizione?.direzione === "uscita")
      .map((e) => e.spedizione!);
    const conPorto = uscite.filter((s) => s.portoCodice);
    const addebito = conPorto.filter((s) => s.portoCodice === "03");
    expect(addebito.length / conPorto.length).toBeGreaterThan(0.9);
  });

  /**
   * Il caso che il confronto per prefisso sui primi sei caratteri sbagliava:
   * Trading Post tronca il nome e ci attacca città e provincia, e il gestionale
   * ci mette la forma societaria. `SAF srl` e `SAF CARBONAT CO` sono la stessa
   * azienda; `SAF srl` e `SAFE SAN GIOV BO`, che è sulla stessa fattura, no.
   */
  it("distingue SAF da SAFE, che compaiono entrambe su questa fattura", () => {
    expect(nomiCompatibili("SAF CARBONAT CO", "SAF srl")).toBe(true);
    expect(nomiCompatibili("SAFE SAN GIOV BO", "SAF srl")).toBe(false);
  });

  it("il riepilogo somma", () => {
    expect(r.agganciate + r.daConfermare + r.senzaCandidati).toBe(53);
  });
});

describe("quello che non si aggancia lo dice, con il motivo", () => {
  const spedizioni = raggruppaInSpedizioni(BOLLE);

  it("una riga con numero inesistente finisce senza candidati o in coda", () => {
    const esiti = abbina(
      [
        {
          numero: 1,
          data: "2026-07-15",
          numeroSpedizione: "X",
          riferimento: "999999999",
          controparte: "AZIENDA CHE NON ESISTE SPA",
          direzione: "entrata",
          colli: 1,
          peso: 10,
          pesoVolumetrico: null,
          pesoTassato: null,
          nolo: 10,
          supplementi: 0,
          carburante: 0,
          totale: 10,
          dettaglio: {},
        },
      ],
      spedizioni
    );
    expect(esiti[0].qualita).toBe("nessuno");
    expect(esiti[0].spedizione).toBeNull();
    expect(esiti[0].motivo).toContain("Nessuna bolla");
  });

  it("senza bolle da cercare non aggancia niente, e non esplode", () => {
    const f = leggiFattura(fattura("ft-tnt-07-26"));
    const esiti = abbina(f.righe, []);
    expect(esiti).toHaveLength(23);
    expect(esiti.every((e) => e.qualita === "nessuno")).toBe(true);
  });
});

/**
 * Il caso che ha fatto cadere la pagina Bolle in produzione il 12 settembre.
 *
 * `spedizioni.zona_provincia` e' `char(2)`; il gestionale ci mette anche sigle
 * di tre lettere per l'estero. Poiche' la sincronizzazione e' un ciclo unico,
 * un solo documento con `RSM` faceva fallire il caricamento dell'intera pagina.
 */
describe("sigle di provincia che non sono province", () => {
  it("scarta le sigle estere invece di troncarle", () => {
    expect(siglaProvincia("RSM")).toBeNull();
    expect(siglaProvincia("CHE")).toBeNull();
    expect(siglaProvincia("MI")).toBe("MI");
    expect(siglaProvincia("mi")).toBe("MI");
    expect(siglaProvincia(" bo ")).toBe("BO");
    expect(siglaProvincia("")).toBeNull();
    expect(siglaProvincia(null)).toBeNull();
  });

  it("una bolla per San Marino non porta con se una provincia inventata", () => {
    const bolla = {
      id_documento: 1,
      tipo_registro: "DV",
      codice_profilo: "BC",
      numero_documento: "BF-1",
      numero_progressivo: "1",
      data_documento: "2026-09-12",
      codice_soggetto: "C1",
      soggetto: "Cliente San Marino",
      zona_cap: "47896",
      zona_provincia: "RSM",
      tipo_trasporto_codice: "01",
      tipo_trasporto: "Franco",
      vettore_codice: "gls",
      num_colli: 1,
      peso_lordo: 10,
      peso_netto: 9,
      volume: null,
    } as unknown as BollaGestionale;

    const [spedizione] = raggruppaInSpedizioni([bolla]);
    expect(spedizione.zonaProvincia).toBeNull();
    // Il CAP resta: serve a capire dove stava andando, e non ha vincoli di lunghezza.
    expect(spedizione.zonaCap).toBe("47896");
  });
});
