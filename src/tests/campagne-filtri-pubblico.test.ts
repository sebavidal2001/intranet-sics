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

import { clientiPerCampagne, creaPubblico, elencoInvii, eliminaPubblico, leggiPubblico, salvaPubblico } from "@/lib/portali/campagne/dati";
import { CreaPubblicoBody, FiltroClientiCampagne, FiltroInvii, PubblicoBody } from "@/lib/portali/campagne/schemi";

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

  it("per cliente: nessun modo né numero minimo, solo campagne, ricerca e pagina", () => {
    const r = FiltroClientiCampagne.parse({ modo: "tutte", min: "3" });
    expect(r).toMatchObject({ limit: 50, offset: 0 });
    expect(r).not.toHaveProperty("modo");
    expect(r).not.toHaveProperty("min");
  });
});

describe("pubblico: regola e nome (schema)", () => {
  const base = { nome: "Standard", agenti: ["AIRFLUID"], categorie_commerciali: ["Attivo"], clienti_extra: [] };

  it("le categorie di attività sono obbligatorie: `[]` vuol dire «tutte», mai «non toccare»", () => {
    expect(PubblicoBody.safeParse(base).success).toBe(false);
    expect(PubblicoBody.parse({ ...base, categorie_attivita: [] }).categorie_attivita).toEqual([]);
  });

  it("accetta le categorie reali, con spazi e punti", () => {
    const r = PubblicoBody.parse({ ...base, categorie_attivita: ["  COSTR. macch.automatiche ", "UT.FIN. tornerie/off.mecc."] });
    expect(r.categorie_attivita).toEqual(["COSTR. macch.automatiche", "UT.FIN. tornerie/off.mecc."]);
  });

  it("rifiuta voci vuote e troppo lunghe", () => {
    expect(PubblicoBody.safeParse({ ...base, categorie_attivita: ["  "] }).success).toBe(false);
    expect(PubblicoBody.safeParse({ ...base, categorie_attivita: ["x".repeat(121)] }).success).toBe(false);
  });

  it("il nome è obbligatorio e ripulito", () => {
    expect(PubblicoBody.safeParse({ ...base, nome: "   ", categorie_attivita: [] }).success).toBe(false);
    expect(PubblicoBody.parse({ ...base, nome: "  Costruttori  ", categorie_attivita: [] }).nome).toBe("Costruttori");
  });

  it("creare un pubblico: nome obbligatorio, copia da un uuid", () => {
    expect(CreaPubblicoBody.safeParse({ nome: "" }).success).toBe(false);
    expect(CreaPubblicoBody.safeParse({ nome: "X", copia_da: "non-un-uuid" }).success).toBe(false);
    expect(CreaPubblicoBody.parse({ nome: "X", copia_da: A }).copia_da).toBe(A);
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

  it("passa al database le campagne scelte, sempre «almeno una»", async () => {
    risolvi = () => ({ data: [riga("1", 2), riga("2", 2)] });
    const r = await clientiPerCampagne({ campagna_id: ["a", "b"], limit: 20, offset: 40, q: "rossi" });
    expect(opsDi("rpc:clienti_per_campagne", "rpc")[0][0]).toEqual({
      p_campagne: ["a", "b"], p_modo: "almeno_una", p_min: 1, p_q: "rossi", p_limit: 20, p_offset: 40,
    });
    expect(r.totale).toBe(2);
    expect(r.clienti.map((c) => c.codice_cliente)).toEqual(["1", "2"]);
    // Il totale e' una colonna di servizio: non finisce nelle righe mostrate.
    expect(r.clienti[0]).not.toHaveProperty("totale");
  });

  it("nessuna campagna scelta = tutte (NULL), e una ricerca troppo corta non filtra", async () => {
    risolvi = () => ({ data: [] });
    await clientiPerCampagne({ limit: 50, offset: 0, q: "a" });
    expect(opsDi("rpc:clienti_per_campagne", "rpc")[0][0]).toMatchObject({ p_campagne: null, p_q: null });
  });

  it("senza risultati: totale zero e nessun cliente", async () => {
    risolvi = () => ({ data: [] });
    expect(await clientiPerCampagne({ limit: 50, offset: 0 })).toEqual({ clienti: [], totale: 0 });
  });

  it("un elenco di campagne nullo dal database diventa vuoto", async () => {
    risolvi = () => ({ data: [{ ...riga("1", 1), campagne: null }] });
    const r = await clientiPerCampagne({ limit: 50, offset: 0 });
    expect(r.clienti[0].campagne).toEqual([]);
  });

  it("converte il totale anche quando il database lo manda come testo (bigint)", async () => {
    risolvi = () => ({ data: [riga("1", "128")] });
    expect((await clientiPerCampagne({ limit: 50, offset: 0 })).totale).toBe(128);
  });
});

describe("pubblici: lettura, salvataggio, creazione, eliminazione", () => {
  const ID = "5b4d0e3a-7f6c-4a8d-9c9e-3f4a5b6c7d8e";
  const input = { nome: "Standard", agenti: ["AIRFLUID"], categorie_commerciali: ["Attivo"], categorie_attivita: [], clienti_extra: ["1", "1", "2"] };
  const config = { id: ID, nome: "Standard", descrizione: null as string | null, standard: true as boolean, agenti: ["AIRFLUID"] as string[], categorie_commerciali: ["Attivo"] as string[], categorie_attivita: [] as string[], clienti_extra: [] as string[], aggiornato_il: "x" };

  function scenario(over: Partial<typeof config> = {}, campagneUsano = 0) {
    risolvi = ({ tabella }) => {
      if (tabella === "pubblici") return { data: { ...config, ...over }, count: 0 };
      if (tabella === "rpc:pubblico_conteggio") return { data: 3 };
      if (tabella === "campagne") return { data: [], count: campagneUsano };
      if (tabella === "v_clienti") return { data: [{ codice_cliente: "1", ragione_sociale: "A", agente_nome: "AIRFLUID", cat_commerciale: "Attivo", cat_attivita: "IMP. impiantisti" }] };
      return { data: [] };
    };
  }

  it("salva sul pubblico giusto, toglie i doppioni e registra chi l'ha fatto", async () => {
    scenario();
    await salvaPubblico(ID, { ...input, categorie_attivita: ["IMP. impiantisti", "IMP. impiantisti"] }, "u1");
    const patch = opsDi("pubblici", "update")[0][0] as Record<string, unknown>;
    expect(patch).toMatchObject({ nome: "Standard", agenti: ["AIRFLUID"], aggiornato_da: "u1", clienti_extra: ["1", "2"], categorie_attivita: ["IMP. impiantisti"] });
    expect(opsDi("pubblici", "eq")).toContainEqual(["id", ID]);
  });

  it("con l'elenco vuoto azzera le categorie di proposito (tutte)", async () => {
    scenario();
    await salvaPubblico(ID, input, "u1");
    expect((opsDi("pubblici", "update")[0][0] as Record<string, unknown>).categorie_attivita).toEqual([]);
  });

  it("la lettura dà la regola, il conteggio del server, le campagne che lo usano e TUTTI i clienti non rivenditori", async () => {
    scenario();
    const r = await leggiPubblico(ID);
    expect(r.raggiunti).toBe(3);
    expect(r.clienti).toHaveLength(1);
    expect(opsDi("rpc:pubblico_conteggio", "rpc")[0][0]).toEqual({ p_pubblico: ID });
    expect(opsDi("campagne", "eq")).toContainEqual(["pubblico_id", ID]);
    expect(opsDi("v_clienti", "eq")).toContainEqual(["rivenditore", false]);
    expect(opsDi("v_clienti", "range")).toContainEqual([0, 999]);
  });

  it("un pubblico che non esiste è un 404, non un errore generico", async () => {
    risolvi = ({ tabella }) => (tabella === "pubblici" ? { data: null } : { data: [] });
    await expect(leggiPubblico(ID)).rejects.toMatchObject({ status: 404 });
  });

  it("crea un pubblico copiando la regola di un altro, ma non lo fa diventare standard", async () => {
    scenario({ agenti: ["AIRFLUID", "BONI"], clienti_extra: ["9"], categorie_attivita: ["IMP. impiantisti"] });
    await creaPubblico({ nome: "Mirata", copia_da: ID }, "u1");
    const riga = opsDi("pubblici", "insert")[0][0] as Record<string, unknown>;
    expect(riga).toMatchObject({ nome: "Mirata", standard: false, agenti: ["AIRFLUID", "BONI"], clienti_extra: ["9"], categorie_attivita: ["IMP. impiantisti"], created_by: "u1" });
  });

  it("crea un pubblico vuoto: nessun commerciale, solo gli attivi, nessun cliente a mano", async () => {
    scenario();
    await creaPubblico({ nome: "Da zero" }, "u1");
    expect(opsDi("pubblici", "insert")[0][0]).toMatchObject({ agenti: [], categorie_commerciali: ["Attivo"], categorie_attivita: [], clienti_extra: [], standard: false });
  });

  it("un nome già usato diventa un messaggio comprensibile", async () => {
    risolvi = ({ tabella }) => (tabella === "pubblici" ? { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "pubblici_nome_uq"' } } : { data: [] });
    await expect(creaPubblico({ nome: "Standard" }, "u1")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("già un pubblico") });
  });

  it("lo standard non si elimina", async () => {
    scenario();
    await expect(eliminaPubblico(ID)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("standard") });
    expect(opsDi("pubblici", "delete")).toHaveLength(0);
  });

  it("un pubblico usato da una campagna non si elimina", async () => {
    scenario({ standard: false }, 2);
    await expect(eliminaPubblico(ID)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("2 campagne") });
    expect(opsDi("pubblici", "delete")).toHaveLength(0);
  });

  it("un pubblico non standard e non usato si elimina", async () => {
    scenario({ standard: false }, 0);
    await eliminaPubblico(ID);
    expect(opsDi("pubblici", "delete")).toHaveLength(1);
  });
});
