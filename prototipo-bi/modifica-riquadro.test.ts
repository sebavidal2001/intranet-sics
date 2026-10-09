/**
 * Modificare un riquadro a parole: il nucleo puro. Le operazioni arrivano dal
 * modello e quindi non sono fidate: si prova che il vocabolario sia chiuso, che
 * ogni stato risultante passi dal validatore, che il perimetro valga anche per
 * i valori dei filtri e che nulla si applichi "a meta'".
 */
import { describe, expect, it } from "vitest";
import {
  applicaOperazioni,
  riallineaDifferenze,
  scorciatoiaDi,
  validaOperazioni,
  type ContestoModifica,
  type StatoRiquadro,
} from "@/lib/prototipo-bi/modifica-riquadro";
import { SpecNonValida } from "@/lib/prototipo-bi/semantico";
import { validaMisura } from "@/lib/prototipo-bi/misure";
import { chiaveMisura } from "@/lib/prototipo-bi/misure-vocabolario";
import { applicaPerimetro } from "@/lib/prototipo-bi/perimetro";
import type { AspettoGrafico, RigaFatto, SerieAnalisi, Snapshot } from "@/lib/prototipo-bi/tipi";

function riga(documento: string, cliente: string, agente: string, codiceAgente: string, bu = "COMPONENTI"): RigaFatto {
  return {
    data: "2026-02-10",
    importo: 1000,
    bu,
    categoria: "",
    agente,
    codiceAgente,
    cliente,
    codiceCliente: cliente.toLowerCase(),
    documento,
    articolo: "A1",
    descrizioneArticolo: "Articolo",
    quantita: 1,
    costoUnitario: 600,
  };
}

const RIGHE = [
  riga("F1", "Alfa", "Anna", "AA"),
  riga("F2", "Boni", "Bruno", "BB", "IMPIANTI"),
  riga("F3", "Boni", "Bruno", "BB"),
];

const SNAPSHOT: Snapshot = {
  generatoIl: "2026-10-09T08:00:00.000Z",
  runCorrente: "run-test",
  runRicevutoIl: "2026-10-09T07:00:00.000Z",
  dataMinima: "2025-01-01",
  dataMassima: "2026-09-30",
  dataset: {
    ordinato: RIGHE,
    fatturato: RIGHE,
    consegnato: [],
    portafoglio: [],
    preventivi_aperti: [],
    controllo_banco: [],
    consegnato_futuro_per_mese: [],
  },
  conteggi: { ordinato: RIGHE.length, fatturato: RIGHE.length },
};

const MARGINE_COMPONENTI = validaMisura({
  id: "11111111-1111-4111-8111-111111111111",
  versione: 1,
  nome: "Margine componenti sul fatturato",
  espressione: {
    tipo: "rapporto",
    numeratore: { metrica: "margine", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
    denominatore: { metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
  },
});

const CONTESTO: ContestoModifica = {
  snapshot: SNAPSHOT,
  definizioni: { [chiaveMisura(MARGINE_COMPONENTI)]: MARGINE_COMPONENTI },
};

/** Ordinato per business unit con il budget accanto: il riquadro tipico di una direzione. */
function statoIniziale(): StatoRiquadro {
  return {
    titolo: "Ordinato per business unit",
    serie: [
      { ruolo: "principale", nome: "Valore ordinato", spec: { metrica: "ordinato", raggruppa: ["bu"], periodo: { anno: 2026 } } },
      { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget", raggruppa: ["bu"], periodo: { anno: 2026 } } },
    ],
  };
}

function ops(...grezze: unknown[]) {
  return validaOperazioni(grezze);
}

describe("validaOperazioni: il vocabolario e' chiuso", () => {
  it("rifiuta elenchi vuoti, troppo lunghi e operazioni che non esistono, elencando quelle vere", () => {
    expect(() => validaOperazioni([])).toThrow(SpecNonValida);
    expect(() => validaOperazioni("togli il budget")).toThrow(SpecNonValida);
    expect(() => validaOperazioni(Array(9).fill({ op: "togli_filtro", campo: "bu" }))).toThrow(/massimo 8/);
    try {
      validaOperazioni([{ op: "esegui_sql", testo: "drop table utenti" }]);
      throw new Error("doveva rifiutare");
    } catch (e) {
      expect(e).toBeInstanceOf(SpecNonValida);
      expect((e as SpecNonValida).suggerimento).toContain("aggiungi_serie");
      expect((e as SpecNonValida).suggerimento).toContain("imposta_filtro");
    }
  });

  it("controlla i campi di ogni operazione", () => {
    expect(() => ops({ op: "imposta_filtro", campo: "pianeta", valore: "x" })).toThrow(/non esiste/);
    expect(() => ops({ op: "imposta_filtro", campo: "cliente", valore: "" })).toThrow(SpecNonValida);
    expect(() => ops({ op: "imposta_filtro", campo: "cliente", operatore: "esegui", valore: "x" })).toThrow(/Operatore/);
    expect(() => ops({ op: "imposta_filtro", campo: "cliente", operatore: "eq", valore: ["a", "b"] })).toThrow(/"in"/);
    expect(() => ops({ op: "imposta_suddivisione", dimensioni: ["bu", "agente", "cliente"] })).toThrow(/al massimo due/);
    expect(() => ops({ op: "imposta_suddivisione", dimensioni: ["bu", "bu"] })).toThrow(/diverse/);
    expect(() => ops({ op: "imposta_granularita", granularita: "lustro" })).toThrow(SpecNonValida);
    expect(() => ops({ op: "imposta_periodo" })).toThrow(/vuoto/);
    expect(() => ops({ op: "imposta_periodo", anno: 1850 })).toThrow(/Anno/);
    expect(() => ops({ op: "imposta_periodo", dal: "ieri" })).toThrow(/aaaa-mm-gg/);
    expect(() => ops({ op: "imposta_grafico", tipo: "cartoon" })).toThrow(/non esiste/);
    expect(() => ops({ op: "imposta_titolo", titolo: "x".repeat(200) })).toThrow(/troppo lungo/);
    expect(() => ops({ op: "togli_serie" })).toThrow(/nome o il ruolo/);
    expect(() => ops({ op: "aggiungi_confronto", tipo: "mese_scorso" })).toThrow(SpecNonValida);
    expect(() => ops({ op: "aggiungi_serie", metrica: "ordinato", ruolo: "principale" })).toThrow(/Ruolo/);
  });

  it("normalizza: operatore di default, elenco = in, periodo che eredita = null, grafico automatico = null", () => {
    expect(ops({ op: "imposta_filtro", campo: "cliente", valore: "Boni" })[0]).toMatchObject({ operatore: "eq", valore: "Boni" });
    expect(ops({ op: "imposta_filtro", campo: "cliente", valore: ["Boni", "Alfa"] })[0]).toMatchObject({ operatore: "in" });
    expect(ops({ op: "imposta_periodo", eredita: true })[0]).toEqual({ op: "imposta_periodo", periodo: null });
    expect(ops({ op: "imposta_periodo", anno: 2025 })[0]).toEqual({ op: "imposta_periodo", periodo: { anno: 2025 } });
    expect(ops({ op: "imposta_grafico", tipo: "automatico" })[0]).toEqual({ op: "imposta_grafico", tipo: null });
    expect(ops({ op: "imposta_grafico", tipo: "barre" })[0]).toEqual({ op: "imposta_grafico", tipo: "barre" });
  });
});

describe("la richiesta d'esempio: aggiungi il confronto con l'anno scorso, togli il budget, filtra su Boni", () => {
  const richiesta = () =>
    ops(
      { op: "aggiungi_confronto", tipo: "anno_precedente" },
      { op: "togli_serie", nome: "Budget" },
      { op: "imposta_filtro", campo: "cliente", valore: "boni" }
    );

  it("produce lo stato atteso, con il riepilogo in italiano", () => {
    const esito = applicaOperazioni(statoIniziale(), richiesta(), CONTESTO);
    expect(esito.stato.serie.map((s) => [s.ruolo, s.nome])).toEqual([
      ["principale", "Valore ordinato"],
      ["confronto", "Anno precedente"],
    ]);
    // Il confronto e' la stessa domanda spostata di un anno; il filtro vale per entrambe, con la grafia del dato.
    expect(esito.stato.serie[1].spec.modificatore).toBe("anno_precedente");
    for (const s of esito.stato.serie) {
      expect(s.spec.filtri).toEqual([{ campo: "cliente", op: "eq", valore: "Boni" }]);
      expect(s.spec.raggruppa).toEqual(["bu"]);
      expect(s.spec.periodo).toEqual({ anno: 2026 });
    }
    expect(esito.riepilogo).toEqual([
      "Aggiungo il confronto «Anno precedente»",
      "Tolgo la serie «Budget»",
      "Filtro: Cliente = Boni",
    ]);
    expect(esito.ignorati).toEqual([]);
    expect(esito.invariato).toBe(false);
  });

  it("l'ordine delle operazioni non conta", () => {
    const [a, b, c] = richiesta();
    const diretto = applicaOperazioni(statoIniziale(), [a, b, c], CONTESTO).stato;
    const rovesciato = applicaOperazioni(statoIniziale(), [c, b, a], CONTESTO).stato;
    expect(rovesciato.serie.map((s) => s.nome).sort()).toEqual(diretto.serie.map((s) => s.nome).sort());
    expect(rovesciato.serie.every((s) => s.spec.filtri?.[0]?.valore === "Boni")).toBe(true);
  });

  it("non tocca lo stato di partenza", () => {
    const iniziale = statoIniziale();
    const copia = JSON.parse(JSON.stringify(iniziale));
    applicaOperazioni(iniziale, richiesta(), CONTESTO);
    expect(iniziale).toEqual(copia);
  });
});

describe("togliere serie", () => {
  it("per ruolo, per chiave della metrica o per etichetta", () => {
    for (const o of [{ ruolo: "obiettivo" }, { nome: "budget" }, { nome: "BUDGET" }]) {
      const esito = applicaOperazioni(statoIniziale(), ops({ op: "togli_serie", ...o }), CONTESTO);
      expect(esito.stato.serie.map((s) => s.nome)).toEqual(["Valore ordinato"]);
    }
  });

  it("la principale non si toglie, e dice cosa fare", () => {
    expect(() => applicaOperazioni(statoIniziale(), ops({ op: "togli_serie", nome: "Valore ordinato" }), CONTESTO)).toThrow(/principale non si toglie/);
    expect(() => applicaOperazioni(statoIniziale(), ops({ op: "togli_serie", ruolo: "principale" }), CONTESTO)).toThrow(/principale non si toglie/);
  });

  it("una serie che non c'e' e' un errore con l'elenco di quelle che ci sono", () => {
    try {
      applicaOperazioni(statoIniziale(), ops({ op: "togli_serie", nome: "Fatturato" }), CONTESTO);
      throw new Error("doveva rifiutare");
    } catch (e) {
      expect((e as SpecNonValida).message).toContain('"Fatturato"');
      expect((e as SpecNonValida).suggerimento).toContain("«Budget» (obiettivo)");
    }
  });
});

describe("aggiungere serie", () => {
  it("una metrica con il suo ruolo naturale, sulla stessa domanda della principale", () => {
    const esito = applicaOperazioni(
      { ...statoIniziale(), serie: [statoIniziale().serie[0]] },
      ops({ op: "aggiungi_serie", metrica: "fatturato" }, { op: "aggiungi_serie", metrica: "bep" }),
      CONTESTO
    );
    expect(esito.stato.serie.map((s) => [s.ruolo, s.nome])).toEqual([
      ["principale", "Valore ordinato"],
      ["confronto", "Fatturato"],
      ["soglia", "BEP"],
    ]);
    expect(esito.stato.serie[1].spec).toMatchObject({ metrica: "fatturato", raggruppa: ["bu"], periodo: { anno: 2026 } });
  });

  it("una misura personalizzata, per chiave o per nome", () => {
    const base = { ...statoIniziale(), serie: [statoIniziale().serie[0]] };
    for (const metrica of [chiaveMisura(MARGINE_COMPONENTI), "margine componenti sul fatturato"]) {
      const esito = applicaOperazioni(base, ops({ op: "aggiungi_serie", metrica }), CONTESTO);
      expect(esito.stato.serie[1].nome).toBe("Margine componenti sul fatturato");
      expect(esito.stato.serie[1].spec.misura?.id).toBe(MARGINE_COMPONENTI.id);
      expect(esito.stato.serie[1].spec.metrica).toBe("margine");
    }
  });

  it("una metrica che non esiste e' un errore, con le vere", () => {
    expect(() => applicaOperazioni(statoIniziale(), ops({ op: "aggiungi_serie", metrica: "utile_netto" }), CONTESTO)).toThrow(/non esiste/);
  });

  it("la stessa serie due volte non si aggiunge: si dice, e il riquadro resta com'era", () => {
    const esito = applicaOperazioni(statoIniziale(), ops({ op: "aggiungi_serie", metrica: "budget" }), CONTESTO);
    expect(esito.invariato).toBe(true);
    expect(esito.ignorati.join(" ")).toContain("gia' nel riquadro");
    const confronto = applicaOperazioni(
      statoIniziale(),
      ops({ op: "aggiungi_confronto", tipo: "anno_precedente" }, { op: "aggiungi_confronto", tipo: "anno_precedente" }),
      CONTESTO
    );
    expect(confronto.stato.serie.filter((s) => s.nome === "Anno precedente")).toHaveLength(1);
    expect(confronto.ignorati.join(" ")).toContain("c'e' gia'");
  });

  it("un nome uguale a uno esistente nello stesso ruolo riceve un numero, per non sovrascriversi", () => {
    const esito = applicaOperazioni(
      statoIniziale(),
      ops({ op: "aggiungi_serie", metrica: "fatturato", nome: "Confronto" }, { op: "aggiungi_serie", metrica: "consegnato", nome: "Confronto" }),
      CONTESTO
    );
    expect(esito.stato.serie.map((s) => s.nome)).toContain("Confronto");
    expect(esito.stato.serie.map((s) => s.nome)).toContain("Confronto (2)");
  });

  it("troppe serie: errore", () => {
    const metriche = ["fatturato", "consegnato", "portafoglio", "n_ordini", "n_fatture", "n_consegne", "ordine_medio"];
    expect(() =>
      applicaOperazioni(statoIniziale(), ops(...metriche.map((metrica) => ({ op: "aggiungi_serie", metrica }))), CONTESTO)
    ).toThrow(/massimo 8/);
  });

  it("il progressivo non si aggiunge a una misura personalizzata", () => {
    const stato: StatoRiquadro = {
      titolo: "Margine",
      serie: [{ ruolo: "principale", nome: "Margine componenti sul fatturato", spec: { metrica: "margine", misura: MARGINE_COMPONENTI } }],
    };
    expect(() => applicaOperazioni(stato, ops({ op: "aggiungi_confronto", tipo: "progressivo" }), CONTESTO)).toThrow(/progressivo/);
    // L'anno scorso invece si'.
    expect(applicaOperazioni(stato, ops({ op: "aggiungi_confronto", tipo: "anno_precedente" }), CONTESTO).stato.serie).toHaveLength(2);
  });
});

describe("filtri", () => {
  it("un valore inesistente e' rifiutato, e il suggerimento elenca solo i valori del perimetro di chi chiede", () => {
    const ristretto = applicaPerimetro(SNAPSHOT, { tipo: "agente", codici: ["AA"] });
    try {
      applicaOperazioni(statoIniziale(), ops({ op: "imposta_filtro", campo: "cliente", valore: "Boni" }), { ...CONTESTO, snapshot: ristretto });
      throw new Error("doveva rifiutare");
    } catch (e) {
      expect(e).toBeInstanceOf(SpecNonValida);
      expect((e as SpecNonValida).message).toContain("non esiste");
      // Boni e' di un altro agente: non deve comparire nemmeno nell'elenco dei valori presenti.
      expect((e as SpecNonValida).suggerimento).toContain("Alfa");
      expect((e as SpecNonValida).suggerimento).not.toContain("Boni");
    }
  });

  it("un filtro sulla stessa dimensione sostituisce il precedente", () => {
    const primo = applicaOperazioni(statoIniziale(), ops({ op: "imposta_filtro", campo: "agente", valore: "Anna" }), CONTESTO).stato;
    const secondo = applicaOperazioni(primo, ops({ op: "imposta_filtro", campo: "agente", valore: "Bruno" }), CONTESTO).stato;
    expect(secondo.serie[0].spec.filtri).toEqual([{ campo: "agente", op: "eq", valore: "Bruno" }]);
  });

  it("piu' valori diventano «è fra»", () => {
    const esito = applicaOperazioni(statoIniziale(), ops({ op: "imposta_filtro", campo: "agente", valore: ["anna", "BRUNO"] }), CONTESTO);
    expect(esito.stato.serie[0].spec.filtri).toEqual([{ campo: "agente", op: "in", valore: ["Anna", "Bruno"] }]);
    expect(esito.riepilogo[0]).toBe("Filtro: Agente è fra Anna, Bruno");
  });

  it("budget e BEP restano fuori da un filtro che non conoscono: si dichiara, non si rompe", () => {
    const esito = applicaOperazioni(statoIniziale(), ops({ op: "imposta_filtro", campo: "cliente", valore: "Boni" }), CONTESTO);
    expect(esito.stato.serie[0].spec.filtri).toBeDefined();
    expect(esito.stato.serie[1].spec.filtri).toBeUndefined();
    expect(esito.ignorati.join(" ")).toContain("non si applica a «Budget»");
    // Ma sull'agente il budget esiste: il filtro vale anche per lui.
    const agente = applicaOperazioni(statoIniziale(), ops({ op: "imposta_filtro", campo: "agente", valore: "Bruno" }), CONTESTO);
    expect(agente.stato.serie[1].spec.filtri).toEqual([{ campo: "agente", op: "eq", valore: "Bruno" }]);
    expect(agente.ignorati).toEqual([]);
  });

  it("un filtro che la misura principale non ammette e' un errore, con le dimensioni che vanno bene", () => {
    expect(() => applicaOperazioni(statoIniziale(), ops({ op: "imposta_filtro", campo: "esito", valore: "Aperto" }), CONTESTO)).toThrow(/non si applica alla misura principale/);
  });

  it("una misura che ha gia' il suo filtro sulla business unit non lo cambia: si dichiara", () => {
    const stato: StatoRiquadro = {
      titolo: "Margine",
      serie: [
        { ruolo: "principale", nome: "Valore ordinato", spec: { metrica: "ordinato" } },
        { ruolo: "confronto", nome: "Margine componenti sul fatturato", spec: { metrica: "margine", misura: MARGINE_COMPONENTI } },
      ],
    };
    const esito = applicaOperazioni(stato, ops({ op: "imposta_filtro", campo: "bu", valore: "IMPIANTI" }), CONTESTO);
    expect(esito.stato.serie[0].spec.filtri).toEqual([{ campo: "bu", op: "eq", valore: "IMPIANTI" }]);
    expect(esito.stato.serie[1].spec.filtri).toBeUndefined();
    expect(esito.ignorati.join(" ")).toContain("ha gia' il suo filtro");
  });

  it("togliere un filtro vale per tutte le serie; se non c'era lo dice", () => {
    const con = applicaOperazioni(statoIniziale(), ops({ op: "imposta_filtro", campo: "agente", valore: "Bruno" }), CONTESTO).stato;
    const senza = applicaOperazioni(con, ops({ op: "togli_filtro", campo: "agente" }), CONTESTO);
    expect(senza.stato.serie.every((s) => s.spec.filtri === undefined)).toBe(true);
    expect(senza.riepilogo).toEqual(["Tolgo il filtro su Agente"]);

    const nulla = applicaOperazioni(statoIniziale(), ops({ op: "togli_filtro", campo: "agente" }), CONTESTO);
    expect(nulla.invariato).toBe(true);
    expect(nulla.ignorati[0]).toContain("Non c'era nessun filtro");
  });
});

describe("suddivisione, granularita', periodo, grafico, titolo", () => {
  it("la suddivisione vale per tutte le serie", () => {
    const esito = applicaOperazioni(statoIniziale(), ops({ op: "imposta_suddivisione", dimensioni: ["bu", "agente"] }), CONTESTO);
    for (const s of esito.stato.serie) expect(s.spec.raggruppa).toEqual(["bu", "agente"]);
    expect(esito.riepilogo[0]).toBe("Suddivido per Business unit e Agente");
    const totale = applicaOperazioni(statoIniziale(), ops({ op: "imposta_suddivisione", dimensioni: [] }), CONTESTO);
    for (const s of totale.stato.serie) expect(s.spec.raggruppa).toBeUndefined();
  });

  it("una suddivisione che il budget non conosce e' un errore, finche' il budget c'e'", () => {
    expect(() => applicaOperazioni(statoIniziale(), ops({ op: "imposta_suddivisione", dimensioni: ["cliente"] }), CONTESTO)).toThrow(/budget/i);
    // Togliendo il budget, nello stesso gruppo di operazioni, si puo': l'ordine non conta.
    for (const ordine of [
      [{ op: "togli_serie", nome: "Budget" }, { op: "imposta_suddivisione", dimensioni: ["cliente"] }],
      [{ op: "imposta_suddivisione", dimensioni: ["cliente"] }, { op: "togli_serie", nome: "Budget" }],
    ]) {
      const esito = applicaOperazioni(statoIniziale(), ops(...ordine), CONTESTO);
      expect(esito.stato.serie).toHaveLength(1);
      expect(esito.stato.serie[0].spec.raggruppa).toEqual(["cliente"]);
    }
  });

  it("una dimensione che una serie non ammette e' un errore del validatore, col motivo", () => {
    const stato: StatoRiquadro = { titolo: "Ordinato", serie: [{ ruolo: "principale", nome: "Valore ordinato", spec: { metrica: "ordinato" } }] };
    expect(() => applicaOperazioni(stato, ops({ op: "imposta_suddivisione", dimensioni: ["fornitore"] }), CONTESTO)).toThrow(/non si applica/);
  });

  it("granularita' e periodo valgono per tutte le serie, il confronto con l'anno scorso resta tale", () => {
    const base = applicaOperazioni(statoIniziale(), ops({ op: "aggiungi_confronto", tipo: "anno_precedente" }), CONTESTO).stato;
    const esito = applicaOperazioni(
      base,
      ops({ op: "imposta_granularita", granularita: "mese" }, { op: "imposta_periodo", anno: 2025 }),
      CONTESTO
    );
    for (const s of esito.stato.serie) {
      expect(s.spec.granularita).toBe("mese");
      expect(s.spec.periodo).toEqual({ anno: 2025 });
    }
    expect(esito.stato.serie[2].spec.modificatore).toBe("anno_precedente");
    expect(esito.riepilogo).toEqual(["Andamento per mese", "Periodo: 2025"]);
  });

  it("il periodo che eredita toglie quello fissato; la granularita' null toglie l'andamento", () => {
    const esito = applicaOperazioni(
      { ...statoIniziale(), serie: statoIniziale().serie.map((s) => ({ ...s, spec: { ...s.spec, granularita: "mese" as const } })) },
      ops({ op: "imposta_periodo", eredita: true }, { op: "imposta_granularita", granularita: null }),
      CONTESTO
    );
    for (const s of esito.stato.serie) {
      expect(s.spec.periodo).toBeUndefined();
      expect(s.spec.granularita).toBeUndefined();
    }
    expect(esito.riepilogo[0]).toBe("Periodo: segue la dashboard");
  });

  it("un periodo incoerente e' rifiutato prima ancora di applicarlo", () => {
    expect(() => ops({ op: "imposta_periodo", dal: "2026-06-01", al: "2026-01-01" })).toThrow(/incoerente/);
    expect(() => ops({ op: "imposta_periodo", dal: "2026-01-01", al: "2026-06-01" })).not.toThrow();
  });

  it("grafico e titolo", () => {
    const esito = applicaOperazioni(statoIniziale(), ops({ op: "imposta_grafico", tipo: "linee" }, { op: "imposta_titolo", titolo: "Ordinato 2026" }), CONTESTO);
    expect(esito.stato.grafico).toBe("linee");
    expect(esito.stato.titolo).toBe("Ordinato 2026");
    const automatico = applicaOperazioni(esito.stato, ops({ op: "imposta_grafico", tipo: "automatico" }), CONTESTO);
    expect(automatico.stato.grafico).toBeUndefined();
  });

  it("la stessa cosa detta due volte non cambia niente: invariato", () => {
    const esito = applicaOperazioni(statoIniziale(), ops({ op: "imposta_titolo", titolo: "Ordinato per business unit" }), CONTESTO);
    expect(esito.invariato).toBe(true);
  });
});

describe("misura principale", () => {
  it("cambia la metrica tenendo suddivisione e periodo, e il nome segue se era quello di default", () => {
    // Il nome di default e' l'etichetta della metrica nel catalogo.
    const stato = statoIniziale();
    stato.serie[0].nome = "Ordinato";
    const esito = applicaOperazioni(stato, ops({ op: "imposta_misura_principale", metrica: "fatturato" }), CONTESTO);
    expect(esito.stato.serie[0]).toMatchObject({ ruolo: "principale", nome: "Fatturato" });
    expect(esito.stato.serie[0].spec).toMatchObject({ metrica: "fatturato", raggruppa: ["bu"], periodo: { anno: 2026 } });
  });

  it("un nome scelto a mano si tiene", () => {
    const stato = statoIniziale();
    stato.serie[0].nome = "Il mio ordinato";
    const esito = applicaOperazioni(stato, ops({ op: "imposta_misura_principale", metrica: "fatturato" }), CONTESTO);
    expect(esito.stato.serie[0].nome).toBe("Il mio ordinato");
  });

  it("passando a una misura personalizzata la spec porta la definizione", () => {
    const esito = applicaOperazioni(
      { ...statoIniziale(), serie: [statoIniziale().serie[0]] },
      ops({ op: "imposta_misura_principale", metrica: chiaveMisura(MARGINE_COMPONENTI) }),
      CONTESTO
    );
    expect(esito.stato.serie[0].spec.misura?.nome).toBe("Margine componenti sul fatturato");
  });

  it("la stessa misura di prima e' un no-op dichiarato", () => {
    const esito = applicaOperazioni(statoIniziale(), ops({ op: "imposta_misura_principale", metrica: "ordinato" }), CONTESTO);
    expect(esito.invariato).toBe(true);
  });

  it("verso un altro dominio la suddivisione per bu non regge: errore, non un grafico vuoto", () => {
    expect(() =>
      applicaOperazioni({ ...statoIniziale(), serie: [statoIniziale().serie[0]] }, ops({ op: "imposta_misura_principale", metrica: "acquisti_valore" }), CONTESTO)
    ).toThrow(/non si applica/);
  });
});

describe("adottare il nuovo stato nell'editor", () => {
  const principale: SerieAnalisi = { ruolo: "principale", nome: "Valore ordinato", spec: { metrica: "ordinato" } };

  it("riconosce le scorciatoie che l'editor rigenera dalla principale", () => {
    expect(scorciatoiaDi({ ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget" } }, principale)).toBe("budget");
    expect(scorciatoiaDi({ ruolo: "soglia", nome: "BEP", spec: { metrica: "bep" } }, principale)).toBe("bep");
    expect(scorciatoiaDi({ ruolo: "confronto", nome: "Anno precedente", spec: { metrica: "ordinato", modificatore: "anno_precedente" } }, principale)).toBe("anno_precedente");
    expect(scorciatoiaDi({ ruolo: "confronto", nome: "Progressivo", spec: { metrica: "ordinato", modificatore: "progressivo" } }, principale)).toBe("progressivo");
  });

  it("una serie su un'altra metrica, o con il modificatore su un'altra metrica, non e' una scorciatoia", () => {
    expect(scorciatoiaDi({ ruolo: "confronto", nome: "Fatturato", spec: { metrica: "fatturato" } }, principale)).toBeUndefined();
    expect(scorciatoiaDi({ ruolo: "confronto", nome: "Fatturato AP", spec: { metrica: "fatturato", modificatore: "anno_precedente" } }, principale)).toBeUndefined();
  });

  it("per una misura, l'anno precedente della stessa misura e' una scorciatoia", () => {
    const p: SerieAnalisi = { ruolo: "principale", nome: "M", spec: { metrica: "margine", misura: MARGINE_COMPONENTI } };
    expect(scorciatoiaDi({ ruolo: "confronto", nome: "Anno precedente", spec: { metrica: "margine", misura: MARGINE_COMPONENTI, modificatore: "anno_precedente" } }, p)).toBe("anno_precedente");
  });

  const tre: SerieAnalisi[] = [
    principale,
    { ruolo: "confronto", nome: "Anno precedente", spec: { metrica: "ordinato" } },
    { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget" } },
  ];
  const aspetto = (differenze: Array<{ da: number; con: number }>): AspettoGrafico => ({ tabella: { differenze, totale: "somma" } });

  it("le differenze della tabella seguono le serie quando una sparisce", () => {
    const dopo = [tre[0], tre[2]]; // tolto «Anno precedente»
    const r = riallineaDifferenze(aspetto([{ da: 0, con: 1 }, { da: 0, con: 2 }]), tre, dopo);
    // La differenza verso la serie tolta va via; quella verso il budget si sposta da 2 a 1.
    expect(r?.tabella?.differenze).toEqual([{ da: 0, con: 1 }]);
    expect(r?.tabella?.totale).toBe("somma");
  });

  it("senza differenze scelte l'aspetto non si tocca", () => {
    const a: AspettoGrafico = { legenda: "sotto" };
    expect(riallineaDifferenze(a, tre, [tre[0]])).toBe(a);
    expect(riallineaDifferenze(null, tre, [tre[0]])).toBeNull();
  });

  it("differenze che puntano alla stessa serie dopo lo spostamento vengono tolte", () => {
    const r = riallineaDifferenze(aspetto([{ da: 1, con: 2 }]), tre, [tre[0], tre[1]]);
    expect(r?.tabella?.differenze).toEqual([]);
  });
});
