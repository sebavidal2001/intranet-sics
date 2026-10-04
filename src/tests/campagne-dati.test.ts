import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finto client Supabase: ogni catena di chiamate (`from("invii").insert(...).select()...`)
 * si registra e, quando la si attende, viene risolta da `risolvi`, che decide la
 * risposta in base alla tabella e alle operazioni. Cosi' si prova la LOGICA di
 * `dati.ts` — quali controlli fa, cosa scrive, come traduce gli errori — senza
 * un database. I vincoli veri del database li collauda la migration stessa.
 */
type Op = [string, unknown[]];
type Risposta = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };

let risolvi: (q: { tabella: string; ops: Op[] }) => Risposta = () => ({ data: null, error: null });
const chiamate: { tabella: string; ops: Op[] }[] = [];

function catena(tabella: string, ops: Op[] = []): unknown {
  return new Proxy(
    {},
    {
      get(_, prop: string) {
        if (prop === "then") {
          return (ok: (v: Risposta) => unknown, ko: (e: unknown) => unknown) => {
            chiamate.push({ tabella, ops });
            return Promise.resolve({ data: null, error: null, count: null, ...risolvi({ tabella, ops }) }).then(ok, ko);
          };
        }
        return (...args: unknown[]) => catena(tabella, [...ops, [prop, args]]);
      },
    }
  );
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // Tabelle dello schema public (qui solo `utenti`, per i nomi di chi segue gli invii).
    from: (t: string) => catena(`public.${t}`),
    schema: () => ({
      from: (t: string) => catena(t),
      rpc: (nome: string, args: unknown) => catena(`rpc:${nome}`, [["rpc", [args]]]),
    }),
  }),
}));

import {
  aggiornaCampagna,
  aggiornaInvio,
  creaCampagna,
  creaInvio,
  elencoInvii,
  ErroreCampagne,
  modificaDestinatari,
  pubblicoMancanti,
  pulisciRicerca,
  utentiInvii,
} from "@/lib/portali/campagne/dati";
import { oggiRoma } from "@/lib/portali/campagne/stati";

const CLIENTE = { codice_cliente: "05000002", ragione_sociale: "POLETTI srl", rivenditore: false };
const C1 = { id: "11111111-1111-4111-8111-111111111111", codice: "C_01_26", nome: "CP SICS", stato: "attiva" };
const C2 = { id: "22222222-2222-4222-8222-222222222222", codice: "C_02_26", nome: "ZECA ZETEK", stato: "attiva" };

const opsDi = (tabella: string, nome: string) =>
  chiamate.filter((c) => c.tabella === tabella).flatMap((c) => c.ops.filter(([n]) => n === nome).map(([, a]) => a));
const inserito = () => opsDi("invii", "insert")[0]?.[0] as Record<string, unknown> | undefined;
const aggiornato = () => opsDi("invii", "update")[0]?.[0] as Record<string, unknown> | undefined;

const assegna = {
  tipo: "ordine" as const,
  codice_cliente: "05000002",
  campagna_id: C1.id,
  referente: "Mario Rossi",
  ordine_numero: "1117",
  ordine_anno: 2026,
};

/** Risposte di base: un cliente, due campagne assegnabili, un insert che riesce. */
function scenario(over: Partial<Record<string, (ops: Op[]) => Risposta>> = {}) {
  risolvi = ({ tabella, ops }) => {
    if (over[tabella]) return over[tabella]!(ops);
    if (tabella === "v_clienti") return { data: CLIENTE };
    if (tabella === "rpc:campagne_assegnabili") return { data: [C1, C2] };
    if (tabella === "invii" && ops.some(([n]) => n === "insert")) return { data: { id: "nuovo", ...inserito() } };
    return { data: null };
  };
}

beforeEach(() => {
  chiamate.length = 0;
  scenario();
});

describe("creaInvio", () => {
  it("la busta nasce preparata, con referente, ordine e chi l'ha assegnata", async () => {
    await creaInvio(assegna, "utente-1");
    expect(inserito()).toMatchObject({
      campagna_id: C1.id,
      codice_cliente: "05000002",
      ragione_sociale: "POLETTI srl",
      stato: "preparata",
      referente: "Mario Rossi",
      ordine_numero: "1117",
      ordine_anno: 2026,
      assegnata_da: "utente-1",
    });
    // La data di consegna non si scrive: la registra il DDT (o la conferma a mano).
    expect(inserito()).not.toHaveProperty("data_consegna");
  });

  it("il banco nasce già consegnato, con la data di oggi a Roma e fonte «banco»", async () => {
    await creaInvio({ tipo: "banco", codice_cliente: "05000002", campagna_id: C1.id }, "utente-1");
    expect(inserito()).toMatchObject({
      stato: "consegnata_banco",
      data_consegna: oggiRoma(),
      fonte_consegna: "banco",
      consegna_registrata_da: "utente-1",
      referente: null,
    });
    expect(inserito()).not.toHaveProperty("ordine_numero");
  });

  it("una campagna che il cliente non può ricevere non arriva nemmeno all'insert", async () => {
    scenario({ "rpc:campagne_assegnabili": () => ({ data: [C2] }), campagne: () => ({ data: { codice: "C_01_26", stato: "sospesa" } }) });
    await expect(creaInvio(assegna, "u")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("sospesa") });
    expect(opsDi("invii", "insert")).toHaveLength(0);
  });

  it("spiega perché: non è tra i destinatari", async () => {
    scenario({
      "rpc:campagne_assegnabili": () => ({ data: [] }),
      campagne: () => ({ data: { codice: "C_01_26", stato: "attiva" } }),
      destinatari: () => ({ data: null }),
    });
    await expect(creaInvio(assegna, "u")).rejects.toMatchObject({ message: expect.stringContaining("non è tra i destinatari") });
  });

  it("spiega perché: l'ha già ricevuta", async () => {
    scenario({
      "rpc:campagne_assegnabili": () => ({ data: [] }),
      campagne: () => ({ data: { codice: "C_01_26", stato: "attiva" } }),
      destinatari: () => ({ data: { codice_cliente: "05000002" } }),
    });
    await expect(creaInvio(assegna, "u")).rejects.toMatchObject({ message: expect.stringContaining("ha già ricevuto") });
  });

  it("cliente inesistente: 404", async () => {
    scenario({ v_clienti: () => ({ data: null }) });
    await expect(creaInvio(assegna, "u")).rejects.toMatchObject({ status: 404 });
  });

  it("due persone sullo stesso ordine: vince una, all'altra un messaggio chiaro", async () => {
    scenario({
      invii: () => ({
        error: { code: "23505", message: 'duplicate key value violates unique constraint "invii_ordine_uq"' },
      }),
    });
    const e = await creaInvio(assegna, "u").catch((x) => x);
    expect(e).toBeInstanceOf(ErroreCampagne);
    expect(e).toMatchObject({ status: 409, message: expect.stringContaining("ogni ordine ne porta una sola") });
  });

  it("stessa campagna assegnata due volte in contemporanea: messaggio chiaro", async () => {
    scenario({
      invii: () => ({
        error: { code: "23505", message: 'duplicate key value violates unique constraint "invii_campagna_cliente_uq"' },
      }),
    });
    await expect(creaInvio(assegna, "u")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("già questa campagna") });
  });

  it("un errore imprevisto del database NON espone il suo testo come errore di dominio", async () => {
    scenario({ invii: () => ({ error: { code: "XX000", message: "connection reset" } }) });
    const e = await creaInvio(assegna, "u").catch((x) => x);
    expect(e).not.toBeInstanceOf(ErroreCampagne);
  });
});

describe("aggiornaInvio", () => {
  const invio = (over: Record<string, unknown> = {}) => ({
    id: "i1",
    stato: "preparata",
    fonte_consegna: null,
    campagna: { codice: "C_01_26", nome: "CP SICS" },
    ...over,
  });

  /** Lettura dell'invio, poi `update` che restituisce le righe toccate. */
  const conInvio = (corrente: Record<string, unknown>, aggiornate: unknown[] = [{ id: "i1" }]) =>
    scenario({
      invii: (ops) => (ops.some(([n]) => n === "update") ? { data: aggiornate } : { data: corrente }),
    });

  it("registra la consegna a mano con data, fonte e chi l'ha fatta", async () => {
    conInvio(invio());
    await aggiornaInvio("i1", { azione: "consegna", data_consegna: "2026-10-01" }, "u2");
    expect(aggiornato()).toMatchObject({
      stato: "consegnata",
      data_consegna: "2026-10-01",
      fonte_consegna: "manuale",
      consegna_registrata_da: "u2",
    });
  });

  it("non accetta una consegna nel futuro", async () => {
    conInvio(invio());
    await expect(aggiornaInvio("i1", { azione: "consegna", data_consegna: "2999-01-01" }, "u")).rejects.toMatchObject({ status: 400 });
    expect(opsDi("invii", "update")).toHaveLength(0);
  });

  it("una consegna rilevata dal DDT non si modifica né si annulla", async () => {
    conInvio(invio({ stato: "consegnata", fonte_consegna: "ddt" }));
    await expect(aggiornaInvio("i1", { azione: "annulla", motivo: "errore" }, "u")).rejects.toMatchObject({ status: 409 });
  });

  it("un invio annullato è chiuso", async () => {
    conInvio(invio({ stato: "annullata" }));
    await expect(aggiornaInvio("i1", { azione: "modifica", referente: "Anna" }, "u")).rejects.toMatchObject({ status: 409 });
  });

  it("l'annullamento scrive motivo, istante e autore", async () => {
    conInvio(invio());
    await aggiornaInvio("i1", { azione: "annulla", motivo: "Assegnata per errore" }, "u3");
    expect(aggiornato()).toMatchObject({ stato: "annullata", motivo_annullo: "Assegnata per errore", annullata_da: "u3" });
    expect(aggiornato()?.annullata_il).toEqual(expect.any(String));
  });

  it("«ritirata al banco» su una busta già preparata", async () => {
    conInvio(invio());
    await aggiornaInvio("i1", { azione: "banco" }, "u");
    expect(aggiornato()).toMatchObject({ stato: "consegnata_banco", data_consegna: oggiRoma(), fonte_consegna: "banco" });
  });

  it("la modifica scrive solo i campi inviati", async () => {
    conInvio(invio());
    await aggiornaInvio("i1", { azione: "modifica", referente: "Anna Bianchi" }, "u");
    expect(aggiornato()).toEqual({ referente: "Anna Bianchi" });
  });

  it("l'update è condizionato allo stato letto: se un collega l'ha cambiato, 409 e non si sovrascrive", async () => {
    conInvio(invio(), []);
    await expect(aggiornaInvio("i1", { azione: "annulla", motivo: "errore" }, "u")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("modificato da qualcun altro"),
    });
    const filtri = opsDi("invii", "eq").map((a) => a[0]);
    expect(filtri).toContain("stato");
  });

  it("invio inesistente: 404", async () => {
    scenario({ invii: () => ({ data: null }) });
    await expect(aggiornaInvio("i1", { azione: "banco" }, "u")).rejects.toMatchObject({ status: 404 });
  });
});

describe("pulisciRicerca", () => {
  it("toglie ciò che spezzerebbe i filtri PostgREST", () => {
    expect(pulisciRicerca("rossi,codice_cliente.eq.1")).toBe("rossi codice_cliente.eq.1");
    expect(pulisciRicerca('a(b)"c%d*e')).toBe("a b c d e");
  });
  it("limita la lunghezza e normalizza gli spazi", () => {
    expect(pulisciRicerca("  ab   cd ")).toBe("ab cd");
    expect(pulisciRicerca("x".repeat(200))).toHaveLength(60);
  });
});

describe("chi ha seguito gli invii", () => {
  const U1 = "aaaaaaaa-0000-4000-8000-000000000001";
  const U2 = "aaaaaaaa-0000-4000-8000-000000000002";
  const invio = (id: string, assegnata_da: string | null, consegna_registrata_da: string | null = null) => ({
    id, codice_cliente: "1", ragione_sociale: "A", stato: "consegnata", assegnata_da, consegna_registrata_da, campagna: { codice: "C_01_26", nome: "x" },
  });

  it("l'elenco porta nome e cognome intranet di chi ha assegnato l'invio e di chi ha segnato la consegna", async () => {
    risolvi = ({ tabella }) => {
      if (tabella === "invii") return { data: [invio("a", U1), invio("b", U1, U2), invio("c", null)], count: 3 };
      if (tabella === "public.utenti") return { data: [{ id: U1, nome: "Silvia", cognome: "Varas" }, { id: U2, nome: "Lucia", cognome: "Roda" }] };
      return { data: null };
    };
    const { invii } = await elencoInvii({ limit: 50, offset: 0 });
    expect(invii.map((i) => [i.assegnata_da_nome, i.consegna_registrata_da_nome])).toEqual([
      ["Silvia Varas", null],
      ["Silvia Varas", "Lucia Roda"],
      [null, null], // lo storico importato dall'Excel non ha utente
    ]);
    // Gli id non escono verso la schermata: solo i nomi.
    expect(invii[0]).not.toHaveProperty("assegnata_da");
    // Una lettura sola per tutti gli utenti, senza doppioni.
    const lettura = opsDi("public.utenti", "in")[0];
    expect(lettura[0]).toBe("id");
    expect([...(lettura[1] as string[])].sort()).toEqual([U1, U2]);
  });

  it("un utente non piu' presente resta null: non si inventa un nome", async () => {
    risolvi = ({ tabella }) => (tabella === "invii" ? { data: [invio("a", U1)], count: 1 } : { data: [] });
    expect((await elencoInvii({ limit: 50, offset: 0 })).invii[0].assegnata_da_nome).toBeNull();
  });

  it("senza invii assegnati da qualcuno non legge nemmeno gli utenti", async () => {
    risolvi = ({ tabella }) => (tabella === "invii" ? { data: [invio("a", null)], count: 1 } : { data: [] });
    await elencoInvii({ limit: 50, offset: 0 });
    expect(opsDi("public.utenti", "in")).toHaveLength(0);
  });

  it("filtra per l'utente che ha assegnato", async () => {
    risolvi = () => ({ data: [], count: 0 });
    await elencoInvii({ utente_id: U1, limit: 50, offset: 0 });
    expect(opsDi("invii", "eq")).toContainEqual(["assegnata_da", U1]);
  });

  it("l'elenco degli utenti per il filtro e' in ordine alfabetico, col nome intranet", async () => {
    risolvi = ({ tabella }) => {
      if (tabella === "rpc:utenti_invii") return { data: [U1, U2] };
      if (tabella === "public.utenti") return { data: [{ id: U1, nome: "Silvia", cognome: "Varas" }, { id: U2, nome: "Lucia", cognome: "Roda" }] };
      return { data: [] };
    };
    expect(await utentiInvii()).toEqual([{ id: U2, nome: "Lucia Roda" }, { id: U1, nome: "Silvia Varas" }]);
  });

  it("nessun utente: elenco vuoto, senza interrogare gli utenti", async () => {
    risolvi = () => ({ data: [] });
    expect(await utentiInvii()).toEqual([]);
    expect(opsDi("public.utenti", "in")).toHaveLength(0);
  });
});

describe("il pubblico di una campagna", () => {
  const PUB = "5b4d0e3a-7f6c-4a8d-9c9e-3f4a5b6c7d8e";
  const campagna = { id: C1.id, codice: "C_04_26", nome: "Quattro", stato: "attiva", pubblico_id: PUB, pubblico: { nome: "Standard", standard: true } };
  const nuova = { codice: "C_04_26", nome: "Quattro", articolo_codice: "ART-04", testo_riconoscimento: [], stato: "sospesa" as const, applica_pubblico: true };

  function scenarioCampagna() {
    risolvi = ({ tabella }) => {
      if (tabella === "campagne") return { data: campagna };
      if (tabella === "v_campagne_riepilogo") return { data: { id: C1.id, destinatari: 0, preparate: 0, da_spedire: 0, consegnate: 0, consegnate_banco: 0 } };
      if (tabella === "rpc:applica_pubblico") return { data: 5 };
      return { data: null };
    };
  }

  it("senza un pubblico indicato non lo scrive: ci pensa il database a mettere lo standard", async () => {
    scenarioCampagna();
    await creaCampagna(nuova, "u1");
    expect(opsDi("campagne", "insert")[0][0]).not.toHaveProperty("pubblico_id");
  });

  it("con un pubblico indicato lo assegna", async () => {
    scenarioCampagna();
    await creaCampagna({ ...nuova, pubblico_id: PUB }, "u1");
    expect(opsDi("campagne", "insert")[0][0]).toMatchObject({ pubblico_id: PUB });
  });

  it("alla creazione aggiunge subito i clienti del pubblico DELLA CAMPAGNA (non dello standard per forza)", async () => {
    scenarioCampagna();
    await creaCampagna({ ...nuova, pubblico_id: PUB }, "u1");
    expect(opsDi("rpc:applica_pubblico", "rpc")[0][0]).toEqual({ p_campagna: C1.id, p_pubblico: null, p_utente: "u1" });
  });

  it("senza «aggiungi subito» la campagna nasce senza destinatari", async () => {
    scenarioCampagna();
    await creaCampagna({ ...nuova, applica_pubblico: false }, "u1");
    expect(opsDi("rpc:applica_pubblico", "rpc")).toHaveLength(0);
  });

  it("cambiare il pubblico di una campagna aggiorna solo quel campo e non tocca i destinatari", async () => {
    scenarioCampagna();
    await aggiornaCampagna(C1.id, { pubblico_id: PUB }, "u1");
    expect(opsDi("campagne", "update")[0][0]).toEqual({ pubblico_id: PUB });
    expect(opsDi("destinatari", "delete")).toHaveLength(0);
    expect(opsDi("rpc:applica_pubblico", "rpc")).toHaveLength(0);
  });

  it("un pubblico inesistente e' un errore chiaro, non un 500", async () => {
    risolvi = ({ tabella, ops }) => {
      if (tabella === "campagne" && ops.some(([n]) => n === "update")) return { data: null, error: { code: "23503", message: 'insert or update on table "campagne" violates foreign key constraint "campagne_pubblico_id_fkey"' } };
      if (tabella === "campagne") return { data: campagna };
      return { data: null };
    };
    await expect(aggiornaCampagna(C1.id, { pubblico_id: PUB }, "u1")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("pubblico") });
  });

  it("«aggiungi i clienti che rientrano» usa il pubblico della campagna e riporta quanti ne ha aggiunti", async () => {
    scenarioCampagna();
    const r = await modificaDestinatari(C1.id, { azione: "applica_pubblico" }, "u1");
    expect(r.esito.aggiunti).toBe(5);
    expect(opsDi("rpc:applica_pubblico", "rpc")[0][0]).toEqual({ p_campagna: C1.id, p_pubblico: null, p_utente: "u1" });
  });

  it("una campagna terminata non riceve altri destinatari", async () => {
    risolvi = ({ tabella }) => (tabella === "campagne" ? { data: { ...campagna, stato: "terminata" } } : { data: null });
    await expect(modificaDestinatari(C1.id, { azione: "applica_pubblico" }, "u1")).rejects.toMatchObject({ status: 409 });
    expect(opsDi("rpc:applica_pubblico", "rpc")).toHaveLength(0);
  });

  it("quanti clienti mancano: il numero arriva dal database", async () => {
    risolvi = ({ tabella }) => (tabella === "rpc:pubblico_mancanti" ? { data: 42 } : { data: null });
    expect(await pubblicoMancanti(C1.id)).toBe(42);
    expect(opsDi("rpc:pubblico_mancanti", "rpc")[0][0]).toEqual({ p_campagna: C1.id });
  });
});
