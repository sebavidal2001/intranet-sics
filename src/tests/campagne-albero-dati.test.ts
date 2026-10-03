import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/** Finto client Supabase (stesso schema degli altri test del portale). */
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
    from: (t: string) => catena(`public.${t}`),
    schema: () => ({
      from: (t: string) => catena(t),
      rpc: (nome: string, args: unknown) => catena(`rpc:${nome}`, [["rpc", [args]]]),
    }),
  }),
}));

const requireCampagne = vi.fn();
vi.mock("@/lib/portali/campagne/api-guard", () => ({ requireCampagne: (...a: unknown[]) => requireCampagne(...a) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { aggiornaCampagna, alberoArticoli, cercaArticoli, conteggioPromossi, creaCampagna } from "@/lib/portali/campagne/dati";
import { GET } from "@/app/api/portali/campagne/articoli/route";
import { POST } from "@/app/api/portali/campagne/articoli/conteggio/route";

const opsDi = (tabella: string, nome: string) =>
  chiamate.filter((c) => c.tabella === tabella).flatMap((c) => c.ops.filter(([n]) => n === nome).map(([, a]) => a));
const argsRpc = (nome: string) => opsDi(`rpc:${nome}`, "rpc")[0]?.[0] as Record<string, unknown>;

const F = "AIGNEP raccordi-tubi (53,5%)";

beforeEach(() => {
  chiamate.length = 0;
  risolvi = () => ({ data: null });
  requireCampagne.mockReset();
  requireCampagne.mockResolvedValue({ ok: true, user: { id: "admin1" }, ctx: { livello: "admin", ruoli: [] } });
});

describe("alberoArticoli", () => {
  it("passa al database il percorso, la ricerca e la pagina", async () => {
    risolvi = () => ({ data: [] });
    await alberoArticoli({ f: F, g: "COMPONENTI", q: "raccordo", limit: 100, offset: 200 });
    expect(argsRpc("albero_articoli")).toEqual({ p_f: F, p_g: "COMPONENTI", p_c: null, p_q: "raccordo", p_limit: 100, p_offset: 200 });
  });

  it("senza parametri chiede i fornitori; il totale e i conteggi tornano numeri anche se il database li manda come testo", async () => {
    risolvi = () => ({ data: [{ livello: "fornitore", valore: "SMC", descrizione: null, n: "385", totale: "503" }] });
    const r = await alberoArticoli({ limit: 100, offset: 0 });
    expect(argsRpc("albero_articoli")).toMatchObject({ p_f: null, p_g: null, p_c: null, p_q: null });
    expect(r).toEqual({ totale: 503, nodi: [{ livello: "fornitore", valore: "SMC", descrizione: null, n: 385 }] });
  });

  it("i caratteri che rompono i filtri non arrivano alla ricerca, ma il nome del fornitore resta esatto", async () => {
    risolvi = () => ({ data: [] });
    await alberoArticoli({ f: F, q: 'a,b(c)"d*', limit: 10, offset: 0 });
    const a = argsRpc("albero_articoli");
    expect(a.p_f).toBe(F);
    expect(a.p_q).not.toMatch(/[,()"*]/);
  });

  it("nessun risultato: elenco vuoto e totale zero", async () => {
    risolvi = () => ({ data: [] });
    expect(await alberoArticoli({ limit: 100, offset: 0 })).toEqual({ nodi: [], totale: 0 });
  });
});

describe("cercaArticoli e conteggioPromossi", () => {
  it("una ricerca più corta di due caratteri non interroga il database", async () => {
    expect(await cercaArticoli("a", 10)).toEqual({ articoli: [], totale: 0 });
    expect(opsDi("rpc:cerca_articoli", "rpc")).toHaveLength(0);
  });

  it("la ricerca restituisce gli articoli col percorso, senza la colonna di servizio", async () => {
    risolvi = () => ({ data: [{ codice: "1", descrizione: "A", fornitore: "F", gruppo: "G", categoria: "C", totale: "9" }] });
    const r = await cercaArticoli("raccordo", 8);
    expect(r.totale).toBe(9);
    expect(r.articoli[0]).toEqual({ codice: "1", descrizione: "A", fornitore: "F", gruppo: "G", categoria: "C" });
  });

  it("il conteggio ripulisce la selezione e non interroga il database se è vuota", async () => {
    expect(await conteggioPromossi([])).toEqual({ articoli: 0, venduti: 0 });
    expect(await conteggioPromossi([{ g: "senza fornitore" }])).toEqual({ articoli: 0, venduti: 0 });
    expect(opsDi("rpc:promossi_conteggio", "rpc")).toHaveLength(0);
  });

  it("il conteggio manda i selettori ripuliti e converte i numeri", async () => {
    risolvi = () => ({ data: [{ articoli: "780", venduti: "486" }] });
    const r = await conteggioPromossi([{ f: F, g: "COMPONENTI" }, { f: F }]);
    expect(argsRpc("promossi_conteggio")).toEqual({ p_sel: [{ f: F }] }); // il percorso più alto assorbe l'altro
    expect(r).toEqual({ articoli: 780, venduti: 486 });
  });
});

describe("la campagna salva l'albero ripulito", () => {
  const campagna = { id: "11111111-1111-4111-8111-111111111111", codice: "C", nome: "N", stato: "sospesa", articoli_promossi: [], promossi_albero: [], pubblico_id: "p", pubblico: null };
  const scenario = () =>
    (risolvi = ({ tabella }) => (tabella === "campagne" ? { data: campagna } : { data: null }));

  it("alla creazione", async () => {
    scenario();
    await creaCampagna(
      { codice: "C_05_26", nome: "Cinque", articolo_codice: "A", testo_riconoscimento: [], articoli_promossi: [], promossi_albero: [{ f: F, g: "G" }, { f: F }], stato: "sospesa", applica_pubblico: false },
      "u1"
    );
    expect((opsDi("campagne", "insert")[0][0] as Record<string, unknown>).promossi_albero).toEqual([{ f: F }]);
  });

  it("alla modifica, e se non c'è nel corpo non lo tocca", async () => {
    scenario();
    await aggiornaCampagna(campagna.id, { promossi_albero: [{ f: " X ", g: "G" }] }, "u1");
    expect(opsDi("campagne", "update")[0][0]).toEqual({ promossi_albero: [{ f: "X", g: "G" }] });
    chiamate.length = 0;
    await aggiornaCampagna(campagna.id, { nome: "Nuovo" }, "u1");
    expect(opsDi("campagne", "update")[0][0]).not.toHaveProperty("promossi_albero");
  });
});

describe("route /api/portali/campagne/articoli", () => {
  const get = (q: string) => GET(new NextRequest(`http://localhost/api/portali/campagne/articoli${q}`));

  it("solo admin: il back office è fermato prima di leggere l'anagrafica", async () => {
    requireCampagne.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "no" }, { status: 403 }) });
    expect((await get("")).status).toBe(403);
    const r = await POST(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ selettori: [] }) }));
    expect(r.status).toBe(403);
    expect(chiamate).toHaveLength(0);
  });

  it("un livello senza quelli sopra è un 400", async () => {
    expect((await get("?g=COMPONENTI")).status).toBe(400);
    expect((await get("?f=X&c=Y")).status).toBe(400);
    expect(chiamate).toHaveLength(0);
  });

  it("la ricerca libera chiede almeno due caratteri", async () => {
    expect((await get("?cerca=a")).status).toBe(400);
    risolvi = () => ({ data: [] });
    expect((await get("?cerca=raccordo")).status).toBe(200);
  });

  it("il livello dell'albero risponde con nodi e totale", async () => {
    risolvi = () => ({ data: [{ livello: "gruppo", valore: "COMPONENTI", descrizione: null, n: 780, totale: 1 }] });
    const r = await get(`?f=${encodeURIComponent(F)}`);
    expect(await r.json()).toEqual({ totale: 1, nodi: [{ livello: "gruppo", valore: "COMPONENTI", descrizione: null, n: 780 }] });
  });

  it("il conteggio rifiuta percorsi con buchi", async () => {
    const r = await POST(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ selettori: [{ g: "X" }] }), headers: { "Content-Type": "application/json" } }));
    expect(r.status).toBe(400);
  });
});
