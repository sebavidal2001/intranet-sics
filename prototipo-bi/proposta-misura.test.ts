/**
 * Proposta di misura a parole: il modello e' finto, si prova tutto cio' che sta
 * attorno — validazione, correzioni, escalation, cache per perimetro, rifiuto
 * dei valori inventati. Nessuna rete.
 */
import { describe, expect, it, vi } from "vitest";
import {
  PropostaFallita,
  istruzioniMisure,
  proponiMisura,
  type ChiamaModello,
} from "@/lib/prototipo-bi/proposta-misura";
import { MODELLI } from "@/lib/prototipo-bi/modelli";
import { SpecNonValida } from "@/lib/prototipo-bi/semantico";
import type { EsitoModello, MessaggioChat } from "@/lib/prototipo-bi/analista";
import type { RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

function riga(documento: string, importo: number, extra: Partial<RigaFatto> = {}): RigaFatto {
  return {
    data: "2025-06-10",
    importo,
    bu: "COMPONENTI",
    categoria: "",
    agente: "Anna",
    codiceAgente: "AA",
    cliente: "Alfa",
    codiceCliente: "alfa",
    documento,
    articolo: "A1",
    descrizioneArticolo: "Articolo",
    quantita: 1,
    costoUnitario: importo * 0.6,
    ...extra,
  };
}

const FATTURATO = [
  riga("F1", 1000),
  riga("F2", 3000, { bu: "IMPIANTI", cliente: "Beta", codiceCliente: "beta", agente: "Bruno", codiceAgente: "BB" }),
];

const SNAPSHOT: Snapshot = {
  generatoIl: "2026-01-05T08:00:00.000Z",
  runCorrente: "run-test",
  runRicevutoIl: "2026-01-05T07:00:00.000Z",
  dataMinima: "2025-01-01",
  dataMassima: "2025-12-31",
  dataset: {
    ordinato: [],
    fatturato: FATTURATO,
    consegnato: [],
    portafoglio: [],
    preventivi_aperti: [],
    controllo_banco: [],
    consegnato_futuro_per_mese: [],
  },
  conteggi: { fatturato: FATTURATO.length },
};

let contatore = 0;
const unico = (testo: string) => `${testo} #${(contatore += 1)}`;

function usa(nome: string, argomenti: unknown): EsitoModello {
  contatore += 1;
  return {
    testo: "",
    toolCalls: [{ id: `tc${contatore}`, type: "function", function: { name: nome, arguments: JSON.stringify(argomenti) } }],
    ingresso: 1000,
    uscita: 100,
    costo: null,
    cache: 0,
  };
}

function finto(...risposte: EsitoModello[]) {
  const coda = [...risposte];
  const chiama = vi.fn<ChiamaModello>(async () => {
    const r = coda.shift();
    if (!r) throw new Error("il modello finto ha finito le risposte");
    return r;
  });
  return chiama;
}

const MARGINE_COMPONENTI = {
  nome: "Margine componenti sul fatturato",
  espressione: {
    tipo: "rapporto",
    numeratore: { metrica: "margine", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
    denominatore: { metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
  },
};

describe("proposta di misura: percorso felice", () => {
  it("una proposta valida arriva con descrizione, prova e consumo, senza escalation", async () => {
    const chiama = finto(usa("proponi_misura", { ...MARGINE_COMPONENTI, nota: "Il confronto con l'anno scorso si aggiunge al riquadro." }));
    const e = await proponiMisura({ testo: unico("margine sul fatturato dei soli componenti"), snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama });

    expect(e.tipo).toBe("misura");
    expect(e.escalato).toBe(false);
    expect(e.modelli).toEqual([MODELLI.leggero.nome]);
    expect(e.dalCache).toBe(false);
    expect(e.descrizione).toContain("Margine (Business unit = COMPONENTI)");
    expect(e.nota).toContain("anno scorso");
    // Prova sull'ultimo anno completo (2025): margine 400 su fatturato 1000.
    expect(e.prova?.periodo).toEqual({ anno: 2025 });
    expect(e.prova?.risultato.totale).toBe(40);
    expect(e.prova?.foglie.map((f) => f.valore)).toEqual([400, 1000]);
    expect(e.consumo.tokenIngresso).toBe(1000);
    expect(e.consumo.costoUsd).toBeGreaterThan(0);
    expect(chiama).toHaveBeenCalledTimes(1);
    expect(chiama.mock.calls[0][0]).toBe(MODELLI.leggero.id);
  });

  it("riporta alla grafia del dato un valore scritto in minuscolo", async () => {
    const chiama = finto(
      usa("proponi_misura", {
        nome: "Fatturato componenti",
        espressione: { tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "componenti" }] },
      })
    );
    const e = await proponiMisura({ testo: unico("fatturato dei componenti"), snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama });
    expect(JSON.stringify(e.misura)).toContain('"valore":"COMPONENTI"');
    expect(e.prova?.risultato.totale).toBe(1000);
  });

  it("il modello puo' guardare i valori veri prima di filtrare", async () => {
    const chiama = finto(
      usa("elenca_valori", { dimensione: "cliente", contiene: "bet" }),
      usa("proponi_misura", {
        nome: "Fatturato Beta",
        espressione: { tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "cliente", op: "eq", valore: "Beta" }] },
      })
    );
    const e = await proponiMisura({ testo: unico("fatturato di beta"), snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama });
    expect(e.tipo).toBe("misura");
    const secondaChiamata = chiama.mock.calls[1][1] as MessaggioChat[];
    const risposta = secondaChiamata.find((m) => m.role === "tool");
    expect(risposta?.content).toContain("Beta");
    expect(risposta?.content).not.toContain("Alfa");
  });

  it("un'ambiguita' diventa una domanda, non una misura", async () => {
    const chiama = finto(usa("chiedi_chiarimento", { domanda: "Intendi il margine sulle sole righe con costo noto o sul fatturato intero?" }));
    const e = await proponiMisura({ testo: unico("margine dei componenti"), snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama });
    expect(e.tipo).toBe("chiarimento");
    expect(e.chiarimento).toContain("costo noto");
    expect(e.misura).toBeUndefined();
  });
});

describe("proposta di misura: correzione ed escalation", () => {
  it("un errore del validatore torna al modello con il motivo, e si corregge senza escalare", async () => {
    const chiama = finto(
      usa("proponi_misura", { nome: "Misura sbagliata", espressione: { tipo: "differenza", da: { metrica: "fatturato" }, sottrai: { metrica: "n_fatture" } } }),
      usa("proponi_misura", MARGINE_COMPONENTI)
    );
    const e = await proponiMisura({ testo: unico("differenza strana"), snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama });
    expect(e.tipo).toBe("misura");
    expect(e.escalato).toBe(false);
    const messaggi = chiama.mock.calls[1][1] as MessaggioChat[];
    const errore = messaggi.filter((m) => m.role === "tool").map((m) => m.content).join(" ");
    expect(errore).toContain("Non si sottraggono unità diverse");
  });

  it("dopo tre rifiuti il leggero lascia il posto allo standard, una volta sola", async () => {
    const sbagliata = () => usa("proponi_misura", { nome: "Misura sbagliata", espressione: { tipo: "formula", testo: "fatturato*2" } });
    const chiama = finto(sbagliata(), sbagliata(), sbagliata(), usa("proponi_misura", MARGINE_COMPONENTI));
    const e = await proponiMisura({ testo: unico("misura difficile"), snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama });
    expect(e.tipo).toBe("misura");
    expect(e.escalato).toBe(true);
    expect(e.modelli).toEqual([MODELLI.leggero.nome, MODELLI.standard.nome]);
    expect(chiama.mock.calls.map((c) => c[0])).toEqual([
      MODELLI.leggero.id,
      MODELLI.leggero.id,
      MODELLI.leggero.id,
      MODELLI.standard.id,
    ]);
    // Il modello standard sa perche' il primo tentativo e' fallito.
    const prompt = (chiama.mock.calls[3][1] as MessaggioChat[])[1].content;
    expect(prompt).toContain("Operatore");
    // Il consumo somma entrambi i tentativi.
    expect(e.consumo.tokenIngresso).toBe(4000);
  });

  it("se falliscono entrambi i modelli solleva PropostaFallita col consumo gia' speso", async () => {
    const sbagliata = () => usa("proponi_misura", { nome: "Misura sbagliata", espressione: { tipo: "formula" } });
    const chiama = finto(...Array.from({ length: 6 }, sbagliata));
    await expect(
      proponiMisura({ testo: unico("impossibile"), snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama })
    ).rejects.toSatisfy((e: unknown) => e instanceof PropostaFallita && e.consumo.tokenIngresso === 6000 && e.modelli.length === 2);
  });

  it("una risposta a parole, senza strumento, viene riportata sullo strumento", async () => {
    const aParole: EsitoModello = { testo: "Ecco la misura: margine / fatturato", toolCalls: [], ingresso: 500, uscita: 50, costo: null, cache: 0 };
    const chiama = finto(aParole, usa("proponi_misura", MARGINE_COMPONENTI));
    const e = await proponiMisura({ testo: unico("misura a parole"), snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama });
    expect(e.tipo).toBe("misura");
    expect(e.escalato).toBe(false);
  });

  it("argomenti non JSON non rompono il ciclo", async () => {
    const rotto: EsitoModello = {
      testo: "",
      toolCalls: [{ id: "x", type: "function", function: { name: "proponi_misura", arguments: "{non json" } }],
      ingresso: 100,
      uscita: 10,
      costo: null,
      cache: 0,
    };
    const chiama = finto(rotto, usa("proponi_misura", MARGINE_COMPONENTI));
    const e = await proponiMisura({ testo: unico("argomenti rotti"), snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama });
    expect(e.tipo).toBe("misura");
  });

  it("un valore di filtro inesistente e' un errore vero: il modello lo rivede", async () => {
    const chiama = finto(
      usa("proponi_misura", { nome: "Fatturato astronavi", espressione: { tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "ASTRONAVI" }] } }),
      usa("proponi_misura", MARGINE_COMPONENTI)
    );
    const e = await proponiMisura({ testo: unico("fatturato astronavi"), snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama });
    expect(e.tipo).toBe("misura");
    const errore = (chiama.mock.calls[1][1] as MessaggioChat[]).filter((m) => m.role === "tool").map((m) => m.content).join(" ");
    expect(errore).toContain("non esiste nella dimensione");
  });
});

describe("proposta di misura: cache e perimetro", () => {
  it("la stessa richiesta non richiama il modello, ma rifa' la prova sui dati", async () => {
    const testo = unico("margine dei componenti sul fatturato");
    const chiama = finto(usa("proponi_misura", MARGINE_COMPONENTI));
    const prima = await proponiMisura({ testo, snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama });
    const seconda = await proponiMisura({ testo: `  ${testo.toUpperCase()}  `, snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama });
    expect(prima.dalCache).toBe(false);
    expect(seconda.dalCache).toBe(true);
    expect(seconda.consumo.costoUsd).toBe(0);
    expect(seconda.prova?.risultato.totale).toBe(40);
    expect(chiama).toHaveBeenCalledTimes(1);
  });

  it("un perimetro diverso non condivide la proposta (i valori dei filtri vengono dai suoi dati)", async () => {
    const testo = unico("fatturato di beta");
    const proposta = usa("proponi_misura", {
      nome: "Fatturato Beta",
      espressione: { tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "cliente", op: "eq", valore: "Beta" }] },
    });
    const chiama = finto(proposta, usa("proponi_misura", MARGINE_COMPONENTI));
    await proponiMisura({ testo, snapshot: SNAPSHOT, chiavePerimetro: "direzione", chiama });
    const altro = await proponiMisura({ testo, snapshot: SNAPSHOT, chiavePerimetro: "agente:AA", chiama });
    expect(altro.dalCache).toBe(false);
    expect(chiama).toHaveBeenCalledTimes(2);
  });

  it("una richiesta troppo breve e' rifiutata senza chiamare il modello", async () => {
    const chiama = finto();
    await expect(proponiMisura({ testo: "margine", snapshot: SNAPSHOT, chiavePerimetro: "tutto", chiama })).rejects.toThrow(SpecNonValida);
    expect(chiama).not.toHaveBeenCalled();
  });
});

describe("istruzioni al modello", () => {
  it("elencano le metriche del catalogo ma non budget e BEP, e dicono di non ripiegare", () => {
    const testo = istruzioniMisure();
    expect(testo).toContain("- fatturato [euro, additiva]");
    expect(testo).toContain("- margine_pct [percentuale, percentuale]");
    expect(testo).toContain("- n_fatture [numero, additiva]");
    expect(testo).not.toContain("- budget [");
    expect(testo).not.toContain("- bep [");
    expect(testo).toContain("non ripiegare su una metrica vicina");
    expect(testo).toContain("COMPONENTI, COSTRUITO, IMPIANTI, STRUTTURE");
  });
});
