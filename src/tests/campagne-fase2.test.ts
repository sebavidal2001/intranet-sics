import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finto client Supabase (stesso schema di campagne-dati.test.ts): ogni catena si
 * registra e `risolvi` decide la risposta in base a tabella e operazioni.
 */
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
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { applicaScambio, eseguiControlloCompleto } from "@/lib/portali/campagne/controllo-dati";
import { ErroreCampagne } from "@/lib/portali/campagne/dati";
import { ignoraAnomalia, schedaClienteCompleta, ordiniApertiCliente, elencoDaPreparare } from "@/lib/portali/campagne/impresa";
import { descriviAnomalia, ORDINE_TIPI, TITOLO_TIPO } from "@/lib/portali/campagne/anomalie-testi";
import { LUNGHEZZA_MINIMA_TOKEN, tokenValido } from "@/lib/portali/campagne/token";
import type { Anomalia, TipoAnomalia } from "@/lib/portali/campagne/tipi";

const opsDi = (tabella: string, nome: string) =>
  chiamate.filter((c) => c.tabella === tabella).flatMap((c) => c.ops.filter(([n]) => n === nome).map(([, a]) => a));

beforeEach(() => {
  chiamate.length = 0;
  risolvi = () => ({ data: null });
});

// ─── token ─────────────────────────────────────────────────────────────────
describe("tokenValido", () => {
  const segreto = "s".repeat(LUNGHEZZA_MINIMA_TOKEN) + "-segreto";

  it("accetta il Bearer giusto", () => {
    expect(tokenValido(`Bearer ${segreto}`, segreto)).toBe(true);
  });
  it("rifiuta un token sbagliato, di lunghezza diversa, o senza «Bearer»", () => {
    expect(tokenValido(`Bearer ${segreto}x`, segreto)).toBe(false);
    expect(tokenValido("Bearer corto", segreto)).toBe(false);
    expect(tokenValido(segreto, segreto)).toBe(false);
    expect(tokenValido(null, segreto)).toBe(false);
    expect(tokenValido("", segreto)).toBe(false);
  });
  it("un segreto assente o troppo corto non autorizza nessuno, nemmeno chi lo conosce", () => {
    expect(tokenValido("Bearer abc", "abc")).toBe(false);
    expect(tokenValido("Bearer ", "")).toBe(false);
    expect(tokenValido("Bearer undefined", undefined)).toBe(false);
  });
});

// ─── testi delle anomalie ──────────────────────────────────────────────────
const anomalia = (tipo: TipoAnomalia, over: Partial<Anomalia> = {}, dettaglio: Record<string, unknown> = {}): Anomalia => ({
  id: "a1",
  tipo,
  gravita: "errore",
  codice_cliente: "K1",
  ragione_sociale: "POLETTI srl",
  invio_id: "i1",
  campagna_id: "c1",
  ordine_numero: "1117",
  ordine_anno: 2026,
  dettaglio,
  stato: "aperta",
  aperta_il: "2026-10-03T03:30:00Z",
  ultima_vista_il: "2026-10-03T03:30:00Z",
  risolta_il: null,
  risolta_con: null,
  nota: null,
  ...over,
});

describe("descriviAnomalia", () => {
  it("riga mancante: dice cosa inserire, dove, di che data, per chi, con i valori da copiare", () => {
    const d = descriviAnomalia(
      anomalia("riga_mancante", {}, { articolo: "DOCUMENTAZIONE", testo_riga: "INVIO DOCUMENTAZIONE C_01_26 CP SICS", campagna_codice: "C_01_26", data_ordine: "2026-09-20" })
    );
    expect(d.cosa).toContain("1117/2026");
    expect(d.cosa).toContain("20/09/2026");
    expect(d.cosa).toContain("POLETTI srl");
    expect(d.cosa).toContain("C_01_26");
    expect(d.da_copiare).toEqual([
      { etichetta: "Articolo", valore: "DOCUMENTAZIONE" },
      { etichetta: "Descrizione", valore: "INVIO DOCUMENTAZIONE C_01_26 CP SICS" },
      { etichetta: "N° ordine", valore: "1117" },
    ]);
  });

  it("inversione: nomina le campagne, i numeri d'ordine e le date, e ricorda lo scambio fisico", () => {
    const d = descriviAnomalia(
      anomalia(
        "ordine_invertito",
        { ordine_numero: null },
        {
          mosse: [
            { invio_id: "i1", campagna_codice: "C_01_26", campagna_nome: "CP SICS", da: { ordine_numero: "100", ordine_data_consegna: "2026-12-31" }, a: { ordine_numero: "200", ordine_data_consegna: "2026-11-01" } },
            { invio_id: "i2", campagna_codice: "C_02_26", campagna_nome: "ZECA", da: { ordine_numero: "200", ordine_data_consegna: "2026-11-01" }, a: { ordine_numero: "100", ordine_data_consegna: "2026-12-31" } },
          ],
        }
      )
    );
    expect(d.cosa).toContain("C_01_26 è sull'ordine 100 (parte il 31/12/2026) e andrebbe sul 200 (01/11/2026)");
    expect(d.azione).toContain("Scambia le buste fisiche");
  });

  it("ogni tipo ha titolo, testo e un posto nell'elenco", () => {
    const tutti = Object.keys(TITOLO_TIPO) as TipoAnomalia[];
    expect([...ORDINE_TIPI].sort()).toEqual([...tutti].sort());
    for (const t of tutti) {
      const d = descriviAnomalia(anomalia(t, {}, { mosse: [], campagne_nella_riga: ["C_02_26"] }));
      expect(d.titolo).toBe(TITOLO_TIPO[t]);
      expect(d.cosa.length).toBeGreaterThan(10);
      expect(d.azione.length).toBeGreaterThan(5);
      // Ogni anomalia dice perché sta lì e non fra le buste preparate o da spedire.
      expect(d.perche.length).toBeGreaterThan(40);
    }
  });

  it("senza ragione sociale usa il codice cliente", () => {
    expect(descriviAnomalia(anomalia("ordine_non_trovato", { ragione_sociale: null })).cosa).toContain("K1");
  });
});

// ─── il controllo: orchestrazione ──────────────────────────────────────────
const CAMPAGNA = { id: "c1", codice: "C_01_26", nome: "CP SICS", articolo_codice: "DOCUMENTAZIONE", testo_riconoscimento: ["SICS"], ordine: 1 };

function scenarioControllo(over: Partial<Record<string, (ops: Op[]) => Risposta>> = {}) {
  risolvi = ({ tabella, ops }) => {
    if (over[tabella]) return over[tabella]!(ops);
    if (tabella === "controlli" && ops.some(([n]) => n === "insert")) return { data: { id: "ctl1" } };
    if (tabella === "controlli") return { count: 0 };
    if (tabella === "campagne") return { data: [CAMPAGNA] };
    if (tabella === "rpc:impresa_aggiornato_il") return { data: "2026-10-02T23:31:00Z" };
    return { data: [] };
  };
}

describe("eseguiControlloCompleto", () => {
  it("scrive il risultato e chiude il log con i conteggi", async () => {
    scenarioControllo({
      invii: (ops) =>
        ops.some(([n]) => n === "update")
          ? { data: [{ id: "i1" }] }
          : ops.some(([n, a]) => n === "select" && String(a[0]).startsWith("id, campagna_id"))
            ? { data: [{ id: "i1", campagna_id: "c1", codice_cliente: "K1", ragione_sociale: "K", stato: "preparata", ordine_numero: "100", ordine_anno: 2026, ordine_profilo: null, assegnata_il: "2026-10-02T10:00:00Z", riga_vista_il: null }] }
            : { data: [{ codice_cliente: "K1", ordine_anno: 2026, ordine_numero: "100" }] },
      "rpc:impresa_ordini": () => ({ data: [{ profilo: "OC", numero: "100", anno: 2026, cliente: "K1", data_doc: "2026-09-20", consegna_prevista: "2026-10-15", aperto: true }] }),
      "rpc:impresa_righe": () => ({ data: [{ profilo: "OC", numero: "100", anno: 2026, cliente: "K1", nome_cliente: "K", data_doc: "2026-09-20", richiesta: null, confermata: "2026-10-15", articolo: "DOCUMENTAZIONE", descrizione: "INVIO DOCUMENTAZIONE C_01_26-CP_SICS", aperta: true }] }),
      "rpc:impresa_ddt": () => ({ data: [] }),
    });
    const r = await eseguiControlloCompleto({ origine: "notturno", utenteId: null });
    expect(r).toMatchObject({ controllo_id: "ctl1", invii_controllati: 1, invii_aggiornati: 1, anomalie_aperte: 0 });

    const update = opsDi("invii", "update")[0][0] as Record<string, unknown>;
    expect(update).toMatchObject({ stato: "da_spedire", controllo_esito: "riga_trovata", ordine_data_consegna: "2026-10-15" });
    // Condizionato allo stato: non si sovrascrive una busta annullata nel frattempo.
    expect(opsDi("invii", "in").some((a) => a[0] === "stato")).toBe(true);

    const chiusura = opsDi("controlli", "update").map((a) => a[0] as Record<string, unknown>).find((u) => u.esito === "ok");
    expect(chiusura).toMatchObject({ invii_controllati: 1, invii_aggiornati: 1, anomalie_aperte: 0 });
  });

  it("un controllo già in corso blocca il successivo con 409", async () => {
    scenarioControllo({ controlli: (ops) => (ops.some(([n]) => n === "insert") ? { data: { id: "x" } } : { count: 1 }) });
    await expect(eseguiControlloCompleto({ origine: "manuale", utenteId: "u" })).rejects.toMatchObject({ status: 409 });
    expect(opsDi("controlli", "insert")).toHaveLength(0);
  });

  it("chiude i controlli rimasti «in corso» da oltre un quarto d'ora (processo ucciso)", async () => {
    scenarioControllo();
    await eseguiControlloCompleto({ origine: "notturno", utenteId: null });
    const pulizia = chiamate.find((c) => c.tabella === "controlli" && c.ops.some(([n, a]) => n === "update" && (a[0] as Record<string, unknown>).errore === "Interrotto"));
    expect(pulizia).toBeTruthy();
    expect(pulizia!.ops.some(([n]) => n === "lt")).toBe(true);
  });

  it("se la lettura fallisce lo scrive nel log e rilancia l'errore", async () => {
    scenarioControllo({ "rpc:impresa_aggiornato_il": () => ({ error: { message: "relation bi_runs does not exist" } }) });
    await expect(eseguiControlloCompleto({ origine: "notturno", utenteId: null })).rejects.toThrow(/bi_runs/);
    const errore = opsDi("controlli", "update")
      .map((a) => a[0] as Record<string, unknown>)
      // L'update di pulizia dei controlli morti ha lo stesso esito ma un altro messaggio.
      .find((u) => u.esito === "errore" && u.errore !== "Interrotto");
    expect(errore?.errore).toContain("bi_runs");
  });

  it("sincronizza le anomalie: inserisce le nuove e chiude da sole quelle sparite", async () => {
    scenarioControllo({
      invii: (ops) =>
        ops.some(([n]) => n === "update")
          ? { data: [{ id: "i1" }] }
          : ops.some(([n, a]) => n === "select" && String(a[0]).startsWith("id, campagna_id"))
            ? { data: [{ id: "i1", campagna_id: "c1", codice_cliente: "K1", ragione_sociale: "K", stato: "preparata", ordine_numero: "100", ordine_anno: 2026, ordine_profilo: null, assegnata_il: "2026-10-02T10:00:00Z", riga_vista_il: null }] }
            : { data: [] },
      // L'ordine non esiste e l'invio e' piu' vecchio dei dati: anomalia "ordine_non_trovato".
      anomalie: (ops) =>
        ops.some(([n]) => n === "select")
          ? { data: [{ id: "vecchia", chiave: "riga_mancante|i9", stato: "aperta", codice_cliente: "K9" }] }
          : { data: [] },
    });
    const r = await eseguiControlloCompleto({ origine: "notturno", utenteId: null });
    expect(r.anomalie_aperte).toBe(1);
    expect(r.anomalie_risolte).toBe(1);

    const inserite = opsDi("anomalie", "insert")[0][0] as Record<string, unknown>[];
    expect(inserite[0]).toMatchObject({ tipo: "ordine_non_trovato", chiave: "ordine_non_trovato|i1", invio_id: "i1" });
    const chiusa = opsDi("anomalie", "update").map((a) => a[0] as Record<string, unknown>).find((u) => u.stato === "risolta");
    expect(chiusa).toMatchObject({ stato: "risolta", risolta_con: "automatica" });
  });

  it("ricostruisce il numero d'ordine dello storico dell'Excel e lo scrive SOLO dove è ancora vuoto", async () => {
    scenarioControllo({
      invii: (ops) => {
        const colonne = String(ops.find(([n]) => n === "select")?.[1][0] ?? "");
        if (ops.some(([n]) => n === "update")) return { data: [{ id: "s1" }] };
        // Gli invii storici: importati, consegnati, senza ordine.
        if (colonne.startsWith("id, campagna_id, codice_cliente, stato, data_consegna")) {
          return { data: [{ id: "s1", campagna_id: "c1", codice_cliente: "K1", stato: "consegnata", data_consegna: "2026-10-01" }] };
        }
        return { data: [] };
      },
      "rpc:impresa_righe": (ops) => {
        const args = ops.find(([n]) => n === "rpc")![1][0] as { p_solo_aperte: boolean };
        return args.p_solo_aperte
          ? { data: [] }
          : { data: [{ profilo: "OC", numero: "100", anno: 2026, cliente: "K1", nome_cliente: "K", data_doc: "2026-09-20", richiesta: null, confermata: "2026-10-15", articolo: "DOCUMENTAZIONE", descrizione: "INVIO DOCUMENTAZIONE C_01_26-CP_SICS", aperta: false }] };
      },
      "rpc:impresa_ddt": () => ({ data: [{ numero: "500", cliente: "K1", data_doc: "2026-10-01", articolo: "DOCUMENTAZIONE", descrizione: "INVIO DOCUMENTAZIONE C_01_26-CP_SICS" }] }),
    });
    const r = await eseguiControlloCompleto({ origine: "notturno", utenteId: null });
    expect(r).toMatchObject({ storico_ritrovati: 1, storico_senza_ordine: 0 });

    const patch = opsDi("invii", "update").map((a) => a[0] as Record<string, unknown>).find((p) => "ddt_numero" in p)!;
    expect(patch).toMatchObject({ ordine_numero: "100", ordine_anno: 2026, ordine_profilo: "OC", ddt_numero: "500", ddt_metodo: "euristico" });
    // Un ordine già stabilito (a mano o da un controllo precedente) non si riscrive mai.
    expect(opsDi("invii", "is")).toContainEqual(["ordine_numero", null]);
    // E lo stato dell'invio storico non cambia.
    expect(patch).not.toHaveProperty("stato");
  });

  it("un invio storico per cui Impresa non ha una riga resta com'è e viene contato come lacuna", async () => {
    scenarioControllo({
      invii: (ops) => {
        const colonne = String(ops.find(([n]) => n === "select")?.[1][0] ?? "");
        return colonne.startsWith("id, campagna_id, codice_cliente, stato, data_consegna")
          ? { data: [{ id: "s1", campagna_id: "c1", codice_cliente: "K1", stato: "consegnata_banco", data_consegna: "2026-01-28" }] }
          : { data: [] };
      },
    });
    const r = await eseguiControlloCompleto({ origine: "notturno", utenteId: null });
    expect(r).toMatchObject({ storico_ritrovati: 0, storico_senza_ordine: 1 });
    expect(opsDi("invii", "update").some((a) => "ddt_numero" in (a[0] as Record<string, unknown>))).toBe(false);
  });

  it("un controllo parziale tocca solo le anomalie dei clienti indicati", async () => {
    scenarioControllo();
    await eseguiControlloCompleto({ origine: "manuale", utenteId: "u", clienti: ["K1"] });
    const filtri = chiamate
      .filter((c) => c.tabella === "anomalie")
      .flatMap((c) => c.ops.filter(([n, a]) => n === "in" && a[0] === "codice_cliente"));
    expect(filtri.length).toBeGreaterThan(0);
  });
});

// ─── scambio di ordini ─────────────────────────────────────────────────────
describe("applicaScambio", () => {
  const mosse = [
    { invio_id: "i1", campagna_codice: "C_01_26", campagna_nome: "CP SICS", da: { ordine_numero: "100", ordine_anno: 2026, ordine_profilo: "OC", ordine_data: "2026-09-01", ordine_data_consegna: "2026-12-31" }, a: { ordine_numero: "200", ordine_anno: 2026, ordine_profilo: "OC", ordine_data: "2026-10-01", ordine_data_consegna: "2026-11-01" } },
    { invio_id: "i2", campagna_codice: "C_02_26", campagna_nome: "ZECA", da: { ordine_numero: "200", ordine_anno: 2026, ordine_profilo: "OC", ordine_data: "2026-10-01", ordine_data_consegna: "2026-11-01" }, a: { ordine_numero: "100", ordine_anno: 2026, ordine_profilo: "OC", ordine_data: "2026-09-01", ordine_data_consegna: "2026-12-31" } },
  ];
  const inversione = anomalia("ordine_invertito", { ordine_numero: null }, { mosse });

  const scenario = (correnti: unknown[], anomaliaLetta: Anomalia | null = inversione) =>
    (risolvi = ({ tabella, ops }) => {
      if (tabella === "anomalie") {
        if (ops.some(([n]) => n === "update")) return { data: { ...inversione, stato: "risolta", risolta_con: "scambio" } };
        return { data: anomaliaLetta };
      }
      if (tabella === "invii") return { data: correnti };
      if (tabella === "rpc:riassegna_ordini") return { data: 2 };
      if (tabella === "controlli") return ops.some(([n]) => n === "insert") ? { data: { id: "ctl" } } : { count: 0 };
      if (tabella === "campagne") return { data: [CAMPAGNA] };
      return { data: [] };
    });

  const correntiOk = [
    { id: "i1", stato: "da_spedire", ordine_numero: "100", ordine_anno: 2026 },
    { id: "i2", stato: "preparata", ordine_numero: "0200", ordine_anno: 2026 },
  ];

  it("scambia gli ordini con una sola chiamata atomica e chiude l'anomalia", async () => {
    scenario(correntiOk);
    const chiusa = await applicaScambio("a1", "utente-1");
    expect(chiusa.risolta_con).toBe("scambio");

    const args = opsDi("rpc:riassegna_ordini", "rpc")[0][0] as { p_mosse: Record<string, unknown>[] };
    expect(args.p_mosse).toHaveLength(2);
    expect(args.p_mosse.find((m) => m.invio_id === "i1")).toMatchObject({ ordine_numero: "200", ordine_data_consegna: "2026-11-01" });
    expect(args.p_mosse.find((m) => m.invio_id === "i2")).toMatchObject({ ordine_numero: "100", ordine_data_consegna: "2026-12-31" });
    // Si scambiano i riferimenti all'ordine, non il referente.
    expect(Object.keys(args.p_mosse[0])).not.toContain("referente");
  });

  it("ricontrolla il solo cliente dopo lo scambio", async () => {
    scenario(correntiOk);
    await applicaScambio("a1", "u");
    const ricontrollo = chiamate.find((c) => c.tabella === "invii" && c.ops.some(([n, a]) => n === "in" && a[0] === "codice_cliente"));
    expect(ricontrollo).toBeTruthy();
  });

  it("se un invio è cambiato dopo il controllo non scambia niente", async () => {
    scenario([{ id: "i1", stato: "da_spedire", ordine_numero: "999", ordine_anno: 2026 }, correntiOk[1]]);
    await expect(applicaScambio("a1", "u")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("sono cambiati") });
    expect(opsDi("rpc:riassegna_ordini", "rpc")).toHaveLength(0);
  });

  it("se un invio è già stato consegnato non scambia", async () => {
    scenario([{ ...correntiOk[0], stato: "consegnata" }, correntiOk[1]]);
    await expect(applicaScambio("a1", "u")).rejects.toMatchObject({ status: 409 });
  });

  it("solo le anomalie di inversione si scambiano, e solo se aperte", async () => {
    scenario(correntiOk, anomalia("riga_mancante"));
    await expect(applicaScambio("a1", "u")).rejects.toMatchObject({ status: 400 });
    scenario(correntiOk, { ...inversione, stato: "risolta" });
    await expect(applicaScambio("a1", "u")).rejects.toMatchObject({ status: 409 });
    scenario(correntiOk, null);
    await expect(applicaScambio("a1", "u")).rejects.toMatchObject({ status: 404 });
  });
});

describe("ignoraAnomalia", () => {
  it("la lascia così con il motivo e chi l'ha deciso, solo se è ancora aperta", async () => {
    risolvi = () => ({ data: [anomalia("riga_mancante", { stato: "ignorata", nota: "Cliente ritira da solo" })] });
    const a = await ignoraAnomalia("a1", "Cliente ritira da solo", "u1");
    expect(a.stato).toBe("ignorata");
    expect(opsDi("anomalie", "update")[0][0]).toMatchObject({ stato: "ignorata", nota: "Cliente ritira da solo", risolta_da: "u1" });
    expect(opsDi("anomalie", "eq").map((x) => x[1])).toContain("aperta");
  });

  it("se nel frattempo è cambiata: 409", async () => {
    risolvi = () => ({ data: [] });
    await expect(ignoraAnomalia("a1", "motivo", "u")).rejects.toBeInstanceOf(ErroreCampagne);
  });
});

// ─── la Fase 2 non deve rompere la Fase 1 ──────────────────────────────────
describe("tolleranza all'assenza della Fase 2 nel database", () => {
  it("la scheda cliente funziona anche se la migration 132 o le viste bi_* non ci sono", async () => {
    risolvi = ({ tabella }) => {
      if (tabella === "v_clienti") return { data: { codice_cliente: "K1", ragione_sociale: "POLETTI srl", rivenditore: false } };
      if (tabella === "invii") return { data: [] };
      if (tabella === "rpc:campagne_assegnabili") return { data: [] };
      // tutto cio' che e' Fase 2 fallisce come su un database senza le viste
      return { error: { message: 'relation "public.bi_portafoglio" does not exist', code: "42P01" } };
    };
    const s = await schedaClienteCompleta("K1");
    expect(s.cliente.ragione_sociale).toBe("POLETTI srl");
    expect(s.ordini_aperti).toEqual([]);
    expect(s.anomalie).toEqual([]);
  });

  it("ordini aperti e da preparare tornano vuoti, non un'eccezione", async () => {
    risolvi = () => ({ error: { message: "function does not exist", code: "42883" } });
    expect(await ordiniApertiCliente("K1")).toEqual([]);
    expect(await elencoDaPreparare()).toEqual([]);
  });
});
