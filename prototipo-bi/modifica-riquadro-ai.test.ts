/**
 * L'assistente che modifica un riquadro: il modello e' finto, si prova il
 * contorno — il vocabolario chiuso, le correzioni col motivo, l'escalation, i
 * tre esiti oltre alla modifica, e che lo stato di partenza non si tocchi.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ModificaFallita,
  descriviStatoPerModello,
  istruzioniModifica,
  proponiModifica,
} from "@/lib/prototipo-bi/modifica-riquadro-ai";
import type { ChiamaModello } from "@/lib/prototipo-bi/assistente-comune";
import type { StatoRiquadro } from "@/lib/prototipo-bi/modifica-riquadro";
import { MODELLI } from "@/lib/prototipo-bi/modelli";
import { validaMisura } from "@/lib/prototipo-bi/misure";
import { chiaveMisura } from "@/lib/prototipo-bi/misure-vocabolario";
import { SpecNonValida } from "@/lib/prototipo-bi/semantico";
import type { EsitoModello, MessaggioChat } from "@/lib/prototipo-bi/analista";
import type { RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

function riga(documento: string, cliente: string, agente: string, codiceAgente: string): RigaFatto {
  return {
    data: "2026-02-10",
    importo: 1000,
    bu: "COMPONENTI",
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

const RIGHE = [riga("F1", "Alfa", "Anna", "AA"), riga("F2", "Boni", "Bruno", "BB")];

const SNAPSHOT: Snapshot = {
  generatoIl: "2026-10-09T08:00:00.000Z",
  runCorrente: "run-test",
  runRicevutoIl: "2026-10-09T07:00:00.000Z",
  dataMinima: "2025-01-01",
  dataMassima: "2026-09-30",
  dataset: { ordinato: RIGHE, fatturato: RIGHE, consegnato: [], portafoglio: [], preventivi_aperti: [], controllo_banco: [], consegnato_futuro_per_mese: [] },
  conteggi: { ordinato: 2, fatturato: 2 },
};

const MARGINE = validaMisura({
  id: "11111111-1111-4111-8111-111111111111",
  nome: "Margine componenti sul fatturato",
  espressione: { tipo: "metrica", metrica: "margine", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
});
const DEFINIZIONI = { [chiaveMisura(MARGINE)]: MARGINE };

function stato(): StatoRiquadro {
  return {
    titolo: "Ordinato per business unit",
    serie: [
      { ruolo: "principale", nome: "Ordinato", spec: { metrica: "ordinato", raggruppa: ["bu"], periodo: { anno: 2026 } } },
      { ruolo: "obiettivo", nome: "Budget", spec: { metrica: "budget", raggruppa: ["bu"], periodo: { anno: 2026 } } },
    ],
  };
}

let n = 0;
function usa(nome: string, argomenti: unknown): EsitoModello {
  n += 1;
  return {
    testo: "",
    toolCalls: [{ id: `tc${n}`, type: "function", function: { name: nome, arguments: JSON.stringify(argomenti) } }],
    ingresso: 1000,
    uscita: 100,
    costo: null,
    cache: 0,
  };
}

function finto(...risposte: EsitoModello[]) {
  const coda = [...risposte];
  return vi.fn<ChiamaModello>(async () => {
    const r = coda.shift();
    if (!r) throw new Error("il modello finto ha finito le risposte");
    return r;
  });
}

const RICHIESTA_ESEMPIO = [
  { op: "aggiungi_confronto", tipo: "anno_precedente" },
  { op: "togli_serie", nome: "Budget" },
  { op: "imposta_filtro", campo: "cliente", valore: "boni" },
];

const esegui = (chiama: ChiamaModello, testo = "aggiungi il confronto con l'anno scorso, togli il budget, filtra su Boni", s = stato()) =>
  proponiModifica({ testo, stato: s, snapshot: SNAPSHOT, definizioni: DEFINIZIONI, chiama });

describe("proposta di modifica: percorso felice", () => {
  it("la richiesta d'esempio diventa tre operazioni, con riepilogo, nuovo stato e consumo", async () => {
    const chiama = finto(usa("modifica_riquadro", { operazioni: RICHIESTA_ESEMPIO, spiegazione: "Confronto, senza budget, solo Boni." }));
    const e = await esegui(chiama);

    expect(e.tipo).toBe("modifica");
    expect(e.escalato).toBe(false);
    expect(e.modelli).toEqual([MODELLI.leggero.nome]);
    expect(e.riepilogo).toEqual(["Aggiungo il confronto «Anno precedente»", "Tolgo la serie «Budget»", "Filtro: Cliente = Boni"]);
    expect(e.stato?.serie.map((s) => s.nome)).toEqual(["Ordinato", "Anno precedente"]);
    expect(e.stato?.serie[0].spec.filtri).toEqual([{ campo: "cliente", op: "eq", valore: "Boni" }]);
    expect(e.operazioni).toHaveLength(3);
    expect(e.spiegazione).toBe("Confronto, senza budget, solo Boni.");
    expect(e.consumo.tokenIngresso).toBe(1000);
    expect(e.consumo.costoUsd).toBeGreaterThan(0);
    expect(chiama).toHaveBeenCalledTimes(1);
    expect(chiama.mock.calls[0][0]).toBe(MODELLI.leggero.id);
  });

  it("al modello arrivano la richiesta, lo stato attuale e le date dei dati", async () => {
    const chiama = finto(usa("modifica_riquadro", { operazioni: [{ op: "imposta_titolo", titolo: "Nuovo" }] }));
    await esegui(chiama);
    const messaggi = chiama.mock.calls[0][1] as MessaggioChat[];
    const utente = String(messaggi.find((m) => m.role === "user")?.content);
    expect(utente).toContain("aggiungi il confronto con l'anno scorso");
    expect(utente).toContain('"titolo":"Ordinato per business unit"');
    expect(utente).toContain('"nome":"Budget"');
    expect(utente).toContain("I dati vanno dal 2025-01-01 al 2026-09-30");
  });

  it("non modifica lo stato che gli viene dato", async () => {
    const s = stato();
    const copia = JSON.parse(JSON.stringify(s));
    await esegui(finto(usa("modifica_riquadro", { operazioni: RICHIESTA_ESEMPIO })), undefined, s);
    expect(s).toEqual(copia);
  });

  it("il modello puo' guardare i valori veri prima di filtrare, e vede solo quelli giusti", async () => {
    const chiama = finto(
      usa("elenca_valori", { dimensione: "cliente", contiene: "bon" }),
      usa("modifica_riquadro", { operazioni: [{ op: "imposta_filtro", campo: "cliente", valore: "Boni" }] })
    );
    const e = await esegui(chiama, "filtra su Boni");
    expect(e.tipo).toBe("modifica");
    const tool = (chiama.mock.calls[1][1] as MessaggioChat[]).find((m) => m.role === "tool");
    expect(tool?.content).toContain("Boni");
    expect(tool?.content).not.toContain("Alfa");
  });
});

describe("gli altri esiti", () => {
  it("una domanda, quando la richiesta e' ambigua", async () => {
    const e = await esegui(finto(usa("chiedi_chiarimento", { domanda: "Boni e' un cliente o un agente?" })), "filtra su Boni");
    expect(e.tipo).toBe("chiarimento");
    expect(e.chiarimento).toContain("cliente o un agente");
    expect(e.stato).toBeUndefined();
  });

  it("un rifiuto motivato per cio' che le operazioni non sanno fare", async () => {
    const e = await esegui(finto(usa("rifiuta_richiesta", { motivo: "I colori non si cambiano a parole: si scelgono dal pannello Aspetto." })), "metti le barre in rosso");
    expect(e.tipo).toBe("non_possibile");
    expect(e.motivo).toContain("Aspetto");
  });

  it("se il riquadro e' gia' cosi', lo dice invece di proporre un cambiamento vuoto", async () => {
    const e = await esegui(finto(usa("modifica_riquadro", { operazioni: [{ op: "imposta_titolo", titolo: "Ordinato per business unit" }] })), "chiamalo Ordinato per business unit");
    expect(e.tipo).toBe("invariato");
    expect(e.stato).toBeUndefined();
  });

  it("invariato porta con se' le cose ignorate, per spiegare perche'", async () => {
    const e = await esegui(finto(usa("modifica_riquadro", { operazioni: [{ op: "aggiungi_serie", metrica: "budget" }] })), "aggiungi il budget");
    expect(e.tipo).toBe("invariato");
    expect(e.ignorati?.join(" ")).toContain("gia' nel riquadro");
  });
});

describe("correzione ed escalation", () => {
  it("un'operazione che non esiste torna al modello col motivo, e si corregge senza escalare", async () => {
    const chiama = finto(
      usa("modifica_riquadro", { operazioni: [{ op: "esegui_sql", testo: "drop table utenti" }] }),
      usa("modifica_riquadro", { operazioni: RICHIESTA_ESEMPIO })
    );
    const e = await esegui(chiama);
    expect(e.tipo).toBe("modifica");
    expect(e.escalato).toBe(false);
    const errore = (chiama.mock.calls[1][1] as MessaggioChat[]).filter((m) => m.role === "tool").map((m) => m.content).join(" ");
    expect(errore).toContain('Operazione "esegui_sql" non esiste');
    expect(errore).toContain("aggiungi_serie");
  });

  it("uno stato che non regge (budget per cliente) torna al modello col motivo del validatore", async () => {
    const chiama = finto(
      usa("modifica_riquadro", { operazioni: [{ op: "imposta_suddivisione", dimensioni: ["cliente"] }] }),
      usa("modifica_riquadro", { operazioni: [{ op: "togli_serie", nome: "Budget" }, { op: "imposta_suddivisione", dimensioni: ["cliente"] }] })
    );
    const e = await esegui(chiama, "suddividi per cliente");
    expect(e.tipo).toBe("modifica");
    const errore = (chiama.mock.calls[1][1] as MessaggioChat[]).filter((m) => m.role === "tool").map((m) => m.content).join(" ");
    expect(errore).toMatch(/budget/i);
    expect(errore).toContain("togli_serie");
    expect(e.stato?.serie).toHaveLength(1);
  });

  it("dopo tre rifiuti si passa al modello standard, una volta sola, col motivo", async () => {
    const sbagliata = () => usa("modifica_riquadro", { operazioni: [{ op: "togli_serie", nome: "Fatturato" }] });
    const chiama = finto(sbagliata(), sbagliata(), sbagliata(), usa("modifica_riquadro", { operazioni: RICHIESTA_ESEMPIO }));
    const e = await esegui(chiama);
    expect(e.tipo).toBe("modifica");
    expect(e.escalato).toBe(true);
    expect(e.modelli).toEqual([MODELLI.leggero.nome, MODELLI.standard.nome]);
    expect(chiama.mock.calls.map((c) => c[0])).toEqual([MODELLI.leggero.id, MODELLI.leggero.id, MODELLI.leggero.id, MODELLI.standard.id]);
    expect(String((chiama.mock.calls[3][1] as MessaggioChat[])[1].content)).toContain('Nessuna serie corrisponde a "Fatturato"');
    expect(e.consumo.tokenIngresso).toBe(4000);
  });

  it("se falliscono entrambi: ModificaFallita col consumo gia' speso", async () => {
    const sbagliata = () => usa("modifica_riquadro", { operazioni: [{ op: "formula" }] });
    const chiama = finto(...Array.from({ length: 6 }, sbagliata));
    await expect(esegui(chiama)).rejects.toSatisfy(
      (e: unknown) => e instanceof ModificaFallita && e.consumo.tokenIngresso === 6000 && e.modelli.length === 2
    );
  });

  it("una risposta a parole, senza strumento, viene riportata sullo strumento", async () => {
    const aParole: EsitoModello = { testo: "Certo, aggiungo il confronto.", toolCalls: [], ingresso: 500, uscita: 50, costo: null, cache: 0 };
    const e = await esegui(finto(aParole, usa("modifica_riquadro", { operazioni: RICHIESTA_ESEMPIO })));
    expect(e.tipo).toBe("modifica");
    expect(e.escalato).toBe(false);
  });

  it("una richiesta troppo breve e' rifiutata senza chiamare il modello", async () => {
    const chiama = finto();
    await expect(esegui(chiama, "ok")).rejects.toThrow(SpecNonValida);
    expect(chiama).not.toHaveBeenCalled();
  });
});

describe("istruzioni e stato per il modello", () => {
  it("le istruzioni elencano le operazioni, budget e BEP, la regola sul budget e le business unit", () => {
    const testo = istruzioniModifica({});
    for (const op of ["aggiungi_confronto", "togli_serie", "imposta_filtro", "imposta_suddivisione", "imposta_periodo", "imposta_grafico"]) {
      expect(testo).toContain(`"op":"${op}"`);
    }
    expect(testo).toContain("- budget [euro]");
    expect(testo).toContain("- bep [euro]");
    expect(testo).toContain("Budget e BEP esistono solo per business unit e agente");
    expect(testo).toContain("COMPONENTI, COSTRUITO, IMPIANTI, STRUTTURE");
    expect(testo).toContain("NON un cambio di periodo");
    expect(testo).not.toContain("MISURE PERSONALIZZATE");
  });

  it("con misure personalizzate disponibili, le elenca con chiave, nome e definizione", () => {
    const testo = istruzioniModifica(DEFINIZIONI);
    expect(testo).toContain("MISURE PERSONALIZZATE");
    expect(testo).toContain(`${chiaveMisura(MARGINE)}: «Margine componenti sul fatturato»`);
  });

  it("lo stato per il modello e' compatto, e dice «eredita dalla dashboard» quando manca il periodo", () => {
    const s = stato();
    delete s.serie[1].spec.periodo;
    s.serie.push({ ruolo: "confronto", nome: "Margine", spec: { metrica: "margine", misura: MARGINE } });
    const letto = JSON.parse(descriviStatoPerModello(s));
    expect(letto.grafico).toBe("automatico");
    expect(letto.serie[0]).toMatchObject({ nome: "Ordinato", ruolo: "principale", metrica: "ordinato", modificatore: "corrente", suddivisione: ["bu"], granularita: null, periodo: { anno: 2026 }, filtri: [] });
    expect(letto.serie[1].periodo).toBe("eredita dalla dashboard");
    expect(letto.serie[2]).toMatchObject({ metrica: chiaveMisura(MARGINE), misura: "Margine componenti sul fatturato" });
  });
});
