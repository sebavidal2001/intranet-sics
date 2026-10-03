import { beforeEach, describe, expect, it, vi } from "vitest";

/** Finto client Supabase: stesso schema degli altri test della Fase 1 e 2. */
type Op = [string, unknown[]];
type Risposta = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
let risolvi: (q: { tabella: string; ops: Op[] }) => Risposta = () => ({ data: null });
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
    schema: () => ({
      from: (t: string) => catena(t),
      rpc: (nome: string, args: unknown) => catena(`rpc:${nome}`, [["rpc", [args]]]),
    }),
  }),
}));

import { clientiPerCampagne, elencoInvii, leggiPubblicoStandard, salvaPubblicoStandard } from "@/lib/portali/campagne/dati";
import { FiltroClientiCampagne, FiltroInvii, PubblicoStandardBody } from "@/lib/portali/campagne/schemi";

const opsDi = (tabella: string, nome: string) =>
  chiamate.filter((c) => c.tabella === tabella).flatMap((c) => c.ops.filter(([n]) => n === nome).map(([, a]) => a));

beforeEach(() => {
  chiamate.length = 0;
  risolvi = () => ({ data: null });
});

const A = "3f2b8c1e-5d4a-4e6b-9a7c-1d2e3f4a5b6c";
const B = "4a3c9d2f-6e5b-4f7c-8b8d-2e3f4a5b6c7d";

describe("filtri a più campagne (schemi)", () => {
  it("una o più campagne nell'indirizzo diventano sempre un elenco", () => {
    expect(FiltroInvii.parse({ campagna_id: A }).campagna_id).toEqual([A]);
    expect(FiltroInvii.parse({ campagna_id: [A, B] }).campagna_id).toEqual([A, B]);
    expect(FiltroInvii.parse({}).campagna_id).toBeUndefined();
    expect(FiltroInvii.parse({ campagna_id: "" }).campagna_id).toBeUndefined();
  });

  it("una campagna che non è un uuid ferma il filtro prima della query", () => {
    expect(FiltroInvii.safeParse({ campagna_id: ["C_01_26"] }).success).toBe(false);
    expect(FiltroInvii.safeParse({ campagna_id: [A, "x"] }).success).toBe(false);
  });

  it("non si possono chiedere centinaia di campagne", () => {
    expect(FiltroInvii.safeParse({ campagna_id: Array.from({ length: 51 }, () => A) }).success).toBe(false);
  });

  it("per cliente: default «almeno una», almeno 1, e le tre modalità", () => {
    expect(FiltroClientiCampagne.parse({})).toMatchObject({ modo: "almeno_una", min: 1, limit: 50, offset: 0 });
    for (const modo of ["almeno_una", "tutte", "nessuna"]) expect(FiltroClientiCampagne.safeParse({ modo }).success).toBe(true);
    expect(FiltroClientiCampagne.safeParse({ modo: "alcune" }).success).toBe(false);
  });

  it("il numero minimo è un intero fra 1 e 50, anche se arriva come testo dall'indirizzo", () => {
    expect(FiltroClientiCampagne.parse({ min: "3" }).min).toBe(3);
    expect(FiltroClientiCampagne.safeParse({ min: "0" }).success).toBe(false);
    expect(FiltroClientiCampagne.safeParse({ min: "2.5" }).success).toBe(false);
    expect(FiltroClientiCampagne.safeParse({ min: "51" }).success).toBe(false);
  });
});

describe("pubblico standard con categorie di attività (schema)", () => {
  const base = { agenti: ["AIRFLUID"], categorie_commerciali: ["Attivo"], clienti_extra: [] };

  it("la categoria di attività è facoltativa: un client vecchio che non la manda non la azzera", () => {
    expect(PubblicoStandardBody.parse(base)).not.toHaveProperty("categorie_attivita");
  });

  it("l'elenco vuoto è una scelta esplicita: tutte le categorie", () => {
    expect(PubblicoStandardBody.parse({ ...base, categorie_attivita: [] }).categorie_attivita).toEqual([]);
  });

  it("accetta le categorie reali, con spazi e punti", () => {
    const r = PubblicoStandardBody.parse({ ...base, categorie_attivita: ["  COSTR. macch.automatiche ", "UT.FIN. tornerie/off.mecc."] });
    expect(r.categorie_attivita).toEqual(["COSTR. macch.automatiche", "UT.FIN. tornerie/off.mecc."]);
  });

  it("rifiuta voci vuote e troppo lunghe", () => {
    expect(PubblicoStandardBody.safeParse({ ...base, categorie_attivita: ["  "] }).success).toBe(false);
    expect(PubblicoStandardBody.safeParse({ ...base, categorie_attivita: ["x".repeat(121)] }).success).toBe(false);
  });
});

describe("elencoInvii con più campagne", () => {
  it("filtra per l'insieme delle campagne scelte, non per una sola", async () => {
    risolvi = () => ({ data: [], count: 0 });
    await elencoInvii({ campagna_id: ["a", "b"], limit: 50, offset: 0 });
    expect(opsDi("invii", "in")).toContainEqual(["campagna_id", ["a", "b"]]);
    expect(opsDi("invii", "eq").map((x) => x[0])).not.toContain("campagna_id");
  });

  it("senza campagne scelte non filtra per campagna, e nasconde gli annullati", async () => {
    risolvi = () => ({ data: [], count: 0 });
    await elencoInvii({ limit: 50, offset: 0 });
    expect(opsDi("invii", "in").map((x) => x[0])).not.toContain("campagna_id");
    expect(opsDi("invii", "neq")).toContainEqual(["stato", "annullata"]);
  });
});

describe("clientiPerCampagne", () => {
  const riga = (n: string, tot: number | string) => ({
    codice_cliente: n, ragione_sociale: `Cliente ${n}`, agente_nome: "AIRFLUID", cat_attivita: null, n_ricevute: 2, campagne: [{ codice: "C_01_26" }], totale: tot,
  });

  it("passa al database le campagne, la modalità e il numero minimo", async () => {
    risolvi = () => ({ data: [riga("1", 2), riga("2", 2)] });
    const r = await clientiPerCampagne({ campagna_id: ["a", "b"], modo: "tutte", min: 2, limit: 20, offset: 40, q: "rossi" });
    expect(opsDi("rpc:clienti_per_campagne", "rpc")[0][0]).toEqual({
      p_campagne: ["a", "b"], p_modo: "tutte", p_min: 2, p_q: "rossi", p_limit: 20, p_offset: 40,
    });
    expect(r.totale).toBe(2);
    expect(r.clienti.map((c) => c.codice_cliente)).toEqual(["1", "2"]);
    // Il totale e' una colonna di servizio: non finisce nelle righe mostrate.
    expect(r.clienti[0]).not.toHaveProperty("totale");
  });

  it("nessuna campagna scelta = tutte (NULL), e una ricerca troppo corta non filtra", async () => {
    risolvi = () => ({ data: [] });
    await clientiPerCampagne({ modo: "almeno_una", min: 1, limit: 50, offset: 0, q: "a" });
    expect(opsDi("rpc:clienti_per_campagne", "rpc")[0][0]).toMatchObject({ p_campagne: null, p_q: null });
  });

  it("senza risultati: totale zero e nessun cliente", async () => {
    risolvi = () => ({ data: [] });
    expect(await clientiPerCampagne({ modo: "nessuna", min: 1, limit: 50, offset: 0 })).toEqual({ clienti: [], totale: 0 });
  });

  it("un elenco di campagne nullo dal database diventa vuoto", async () => {
    risolvi = () => ({ data: [{ ...riga("1", 1), campagne: null }] });
    const r = await clientiPerCampagne({ modo: "nessuna", min: 1, limit: 50, offset: 0 });
    expect(r.clienti[0].campagne).toEqual([]);
  });

  it("converte il totale anche quando il database lo manda come testo (bigint)", async () => {
    risolvi = () => ({ data: [riga("1", "128")] });
    expect((await clientiPerCampagne({ modo: "nessuna", min: 1, limit: 50, offset: 0 })).totale).toBe(128);
  });
});

describe("pubblico standard: lettura e salvataggio", () => {
  const input = { agenti: ["AIRFLUID"], categorie_commerciali: ["Attivo"], clienti_extra: ["1", "1", "2"] };

  function scenarioPubblico() {
    risolvi = ({ tabella }) => {
      if (tabella === "pubblico_standard") return { data: { agenti: ["AIRFLUID"], categorie_commerciali: ["Attivo"], categorie_attivita: [], clienti_extra: [] } };
      if (tabella === "rpc:pubblico_standard_conteggio") return { data: 3 };
      if (tabella === "v_clienti") return { data: [{ codice_cliente: "1", ragione_sociale: "A", agente_nome: "AIRFLUID", cat_commerciale: "Attivo", cat_attivita: "IMP. impiantisti" }] };
      return { data: [] };
    };
  }

  it("senza categorie di attività nella richiesta non tocca quelle salvate", async () => {
    scenarioPubblico();
    await salvaPubblicoStandard(input, "u1");
    const patch = opsDi("pubblico_standard", "update")[0][0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("categorie_attivita");
    expect(patch).toMatchObject({ agenti: ["AIRFLUID"], aggiornato_da: "u1", clienti_extra: ["1", "2"] });
  });

  it("con l'elenco vuoto lo azzera di proposito (tutte le categorie)", async () => {
    scenarioPubblico();
    await salvaPubblicoStandard({ ...input, categorie_attivita: [] }, "u1");
    expect((opsDi("pubblico_standard", "update")[0][0] as Record<string, unknown>).categorie_attivita).toEqual([]);
  });

  it("toglie i doppioni dalle categorie", async () => {
    scenarioPubblico();
    await salvaPubblicoStandard({ ...input, categorie_attivita: ["IMP. impiantisti", "IMP. impiantisti"] }, "u1");
    expect((opsDi("pubblico_standard", "update")[0][0] as Record<string, unknown>).categorie_attivita).toEqual(["IMP. impiantisti"]);
  });

  it("la lettura dà la regola, il conteggio del server e TUTTI i clienti non rivenditori", async () => {
    scenarioPubblico();
    const r = await leggiPubblicoStandard();
    expect(r.raggiunti).toBe(3);
    expect(r.clienti).toHaveLength(1);
    expect(r.config.categorie_attivita).toEqual([]);
    // Si leggono solo i non rivenditori, e a pagine.
    expect(opsDi("v_clienti", "eq")).toContainEqual(["rivenditore", false]);
    expect(opsDi("v_clienti", "range")).toContainEqual([0, 999]);
  });
});
